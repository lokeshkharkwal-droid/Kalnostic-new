import { LabReportStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { deriveReportStatus } from '../../../common/utils/derive-report-status.util';
import type { OrderReportStatus } from '../../../common/utils/derive-report-status.util';
import type { ResolvedSampleFilters } from './sample-filters.util';
import { reportForSample, type OverviewReportRef } from './order-overview.util';
import { loadSampleReportLinks } from './sample-report-links.util';

/** The filters that need an extra query before the list query (see {@link ResolvedSampleFilters}). */
export interface AsyncSampleFilters {
  categoryId?: string;
  subCategoryId?: string;
  reportStatus?: LabReportStatus;
  orderStatus?: OrderReportStatus;
}

/**
 * The filters a plain relation condition cannot express (see {@link ResolvedSampleFilters}),
 * resolved with one tenant-scoped query each. Shared by the In-House list and the transfer
 * queues so a filter means the same thing on every screen.
 * @param prisma the Prisma service (`withTenant` sets the RLS tenant)
 * @param tenantId tenant scope
 * @param filters the filters asked for (any subset)
 * @param sampleScope which samples the screen can show; limits the reports / orders that are
 *   read (In-House: this branch's samples; a transfer queue: samples with a transfer in it)
 */
export async function resolveAsyncSampleFilters(
  prisma: Pick<PrismaService, 'withTenant'>,
  tenantId: string,
  filters: AsyncSampleFilters,
  sampleScope: Prisma.OrderSampleWhereInput,
): Promise<ResolvedSampleFilters> {
  const resolved: ResolvedSampleFilters = {};
  if (filters.categoryId || filters.subCategoryId) {
    resolved.labTestIds = await labTestIdsInClassification(
      prisma,
      tenantId,
      filters.categoryId,
      filters.subCategoryId,
    );
  }
  if (filters.reportStatus) {
    resolved.reportStatusSampleIds = await sampleIdsWithReportStatus(
      prisma,
      tenantId,
      sampleScope,
      filters.reportStatus,
    );
  }
  if (filters.orderStatus) {
    resolved.orderStatusOrderIds = await orderIdsWithOrderStatus(
      prisma,
      tenantId,
      sampleScope,
      filters.orderStatus,
    );
  }
  return resolved;
}

/**
 * Ids of the orders (that have a sample in `sampleScope`) whose overall report status
 * is `status` - the Order Console's "Order Status". The rule is `deriveReportStatus`
 * itself, run over each candidate order, instead of a second hand-written copy that
 * could drift (it needs each panel's real member count, which no relation filter
 * can express). Bill-only items never enter the lab workflow, so - as in the Order
 * Console - they are left out of the derivation.
 */
async function orderIdsWithOrderStatus(
  prisma: Pick<PrismaService, 'withTenant'>,
  tenantId: string,
  sampleScope: Prisma.OrderSampleWhereInput,
  status: OrderReportStatus,
): Promise<string[]> {
  return prisma.withTenant(tenantId, async (tx) => {
    const candidates = await tx.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        orderSamples: { some: sampleScope },
      },
      select: {
        id: true,
        items: {
          where: { deletedAt: null },
          select: {
            branchLabTest: { select: { isBillOnlyTest: true } },
            branchLabPanel: { select: { id: true, isBillOnlyTest: true } },
            labReports: {
              where: { deletedAt: null },
              select: { status: true, memberBranchLabTestId: true },
            },
          },
        },
      },
    });
    const workflowItems = (c: (typeof candidates)[number]) =>
      c.items.filter(
        (it) =>
          !it.branchLabTest?.isBillOnlyTest &&
          !it.branchLabPanel?.isBillOnlyTest,
      );
    const panelIds = [
      ...new Set(
        candidates
          .flatMap((c) => workflowItems(c).map((it) => it.branchLabPanel?.id))
          .filter((id): id is string => id != null),
      ),
    ];
    const panelMemberCounts = new Map<string, number>();
    if (panelIds.length > 0) {
      const members = await tx.branchLabPanelTest.findMany({
        where: { branchLabPanelId: { in: panelIds }, deletedAt: null },
        select: { branchLabPanelId: true },
      });
      for (const m of members) {
        panelMemberCounts.set(
          m.branchLabPanelId,
          (panelMemberCounts.get(m.branchLabPanelId) ?? 0) + 1,
        );
      }
    }
    return candidates
      .filter(
        (c) =>
          deriveReportStatus(workflowItems(c), panelMemberCounts) === status,
      )
      .map((c) => c.id);
  });
}

/**
 * Ids of the tests (`LabTest.id`, which is what a sample keeps in `labTestId`) that
 * sit in the chosen category / subcategory. A test's classification lives on the
 * tenant test AND on each branch's copy (and may differ), so both are read: a test
 * counts when either says it belongs. An empty list means no such test.
 */
async function labTestIdsInClassification(
  prisma: Pick<PrismaService, 'withTenant'>,
  tenantId: string,
  categoryId?: string,
  subCategoryId?: string,
): Promise<string[]> {
  const classification = {
    ...(categoryId ? { categoryId } : {}),
    ...(subCategoryId ? { subCategoryId } : {}),
  };
  return prisma.withTenant(tenantId, async (tx) => {
    const [tenantTests, branchCopies] = await Promise.all([
      tx.labTest.findMany({
        where: { tenantId, deletedAt: null, ...classification },
        select: { id: true },
      }),
      tx.branchLabTest.findMany({
        where: {
          tenantId,
          deletedAt: null,
          sourceLabTestId: { not: null },
          ...classification,
        },
        select: { sourceLabTestId: true },
      }),
    ]);
    return [
      ...new Set([
        ...tenantTests.map((t) => t.id),
        ...branchCopies.map((b) => b.sourceLabTestId as string),
      ]),
    ];
  });
}

/**
 * Ids of the samples (within `sampleScope`) whose report has `status`. A report belongs to an order
 * line (a whole test) or, for a panel, to one member test of it, and the sample of that member must
 * match ITS OWN report - two columns a relation filter cannot compare - so the matching reports are
 * read first and each candidate sample is matched to them in code (`reportForSample`). A sample that
 * was sent on is matched through the chain of its copies too: the report follows the test to the
 * receiving branch and is re-pointed at that branch's own copy of the test, so the sender's sample
 * alone would no longer find it. A sample with no report yet matches none.
 */
async function sampleIdsWithReportStatus(
  prisma: Pick<PrismaService, 'withTenant'>,
  tenantId: string,
  sampleScope: Prisma.OrderSampleWhereInput,
  status: LabReportStatus,
): Promise<string[]> {
  return prisma.withTenant(tenantId, async (tx) => {
    const ownSample = { is: sampleScope };
    const reports: OverviewReportRef[] = await tx.labReport.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status,
        orderItem: {
          orderSampleTests: {
            some: { deletedAt: null, sample: ownSample },
          },
        },
      },
      select: {
        id: true,
        status: true,
        branchId: true,
        orderItemId: true,
        labTestId: true,
        memberBranchLabTestId: true,
      },
    });
    if (reports.length === 0) return [];

    // the samples in scope that sit on a reported order line
    const candidates = await tx.orderSampleTest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        orderItemId: { in: [...new Set(reports.map((r) => r.orderItemId))] },
        sample: ownSample,
      },
      select: { sampleId: true },
    });
    const candidateIds = [...new Set(candidates.map((c) => c.sampleId))];
    const { linksBySample } = await loadSampleReportLinks(
      tx,
      tenantId,
      candidateIds,
    );
    return candidateIds.filter(
      (id) =>
        reportForSample(linksBySample.get(id) ?? [], reports, null) !== null,
    );
  });
}
