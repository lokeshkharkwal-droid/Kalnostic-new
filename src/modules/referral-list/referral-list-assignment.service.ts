import { Injectable } from '@nestjs/common';
import { ReferralListAssignment, ReferralType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ResolveListsQueryDto } from './dto/resolve-lists-query.dto';
import {
  LabListRef,
  ReferralListAssignmentView,
  ReferralListSelection,
  ResolvedLists,
} from './entities/referral-list.entity';

/** The branch's default (Walk-in) pricing list ids (lab + radiology). */
type DefaultListIds = {
  testListId: string | null;
  panelListId: string | null;
  radiologyTestListId: string | null;
  radiologyPanelListId: string | null;
};

/**
 * Referral (type, id) steps checked AFTER the B2B panel and PT category, in
 * priority order: referred-by doctor → internal → external.
 */
const RESOLVE_ORDER: Array<{
  type: ReferralType;
  key: keyof ResolveListsQueryDto;
}> = [
  { type: 'DOCTOR', key: 'referredByDoctorId' },
  { type: 'INTERNAL', key: 'internalReferralId' },
  { type: 'EXTERNAL', key: 'externalReferralId' },
];

/**
 * Per-branch referral → pricing-list mapping. A referral registry is shared across
 * the tenant, but each branch chooses which Lab Test / Lab Panel List applies to
 * that referral. `upsert` is called by the four referral services on create/update;
 * `resolve` is used by the Create-Order form (via the resolve endpoint) and by
 * `OrderService`. Tenant-scoped + branch-level (CLAUDE.md §4.7). Shared service —
 * injected via DI, never imported directly (rule #3).
 */
@Injectable()
export class ReferralListAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ptCategoryService: PtCategoryService,
  ) {}

  /**
   * Create or update the active branch's list assignment for a referral. Passing
   * all four list ids as null/undefined clears the assignment (soft-deletes it) so
   * the referral falls back to the default Walk-in lists. Carries both the Lab
   * Test / Lab Panel lists and the Radiology Test / Radiology Panel lists.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param referralType which referral kind
   * @param referralId the referral row id
   * @param selection the chosen list ids (any may be null)
   */
  async upsert(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    referralType: ReferralType,
    referralId: string,
    selection: ReferralListSelection,
  ): Promise<void> {
    const testListId = selection.branchLabTestListId ?? null;
    const panelListId = selection.branchLabPanelListId ?? null;
    const radiologyTestListId = selection.branchRadiologyTestListId ?? null;
    const radiologyPanelListId = selection.branchRadiologyPanelListId ?? null;
    const isEmpty =
      testListId === null &&
      panelListId === null &&
      radiologyTestListId === null &&
      radiologyPanelListId === null;
    const existing = await this.prisma.referralListAssignment.findFirst({
      where: { tenantId, branchId, referralType, referralId },
    });

    if (existing) {
      await this.prisma.referralListAssignment.update({
        where: { id: existing.id },
        data: {
          branchLabTestListId: testListId,
          branchLabPanelListId: panelListId,
          branchRadiologyTestListId: radiologyTestListId,
          branchRadiologyPanelListId: radiologyPanelListId,
          deletedAt: isEmpty ? new Date() : null,
          updatedBy: actorId,
        },
      });
      return;
    }
    if (isEmpty) {
      return;
    }
    await this.prisma.referralListAssignment.create({
      data: {
        tenantId,
        branchId,
        referralType,
        referralId,
        branchLabTestListId: testListId,
        branchLabPanelListId: panelListId,
        branchRadiologyTestListId: radiologyTestListId,
        branchRadiologyPanelListId: radiologyPanelListId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /**
   * Fetch the active branch's assignment for a single referral (or null).
   * Used by the referral services to prefill a form on `GET /:id`.
   */
  async getAssignment(
    tenantId: string,
    branchId: string,
    referralType: ReferralType,
    referralId: string,
  ): Promise<ReferralListAssignment | null> {
    return this.prisma.referralListAssignment.findFirst({
      where: { tenantId, branchId, referralType, referralId, deletedAt: null },
    });
  }

  /**
   * Bulk-fetch the active branch's list assignments for many referrals at once,
   * resolving each assigned list's display name too — used by each referral
   * type's list endpoint to enrich a page of rows in a fixed number of extra
   * queries (never one per row). Referrals with no assignment (or a null
   * `branchId`/empty `referralIds`) are simply absent from the returned map.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); null → returns an empty map
   * @param referralType which referral kind
   * @param referralIds the current page's referral ids
   */
  async getAssignmentsWithListNames(
    tenantId: string,
    branchId: string | null,
    referralType: ReferralType,
    referralIds: string[],
  ): Promise<Map<string, ReferralListAssignmentView>> {
    if (!branchId || referralIds.length === 0) {
      return new Map();
    }

    const assignments = await this.prisma.referralListAssignment.findMany({
      where: {
        tenantId,
        branchId,
        referralType,
        referralId: { in: referralIds },
        deletedAt: null,
      },
    });
    if (assignments.length === 0) {
      return new Map();
    }

    const uniqueIds = (
      pick: (a: ReferralListAssignment) => string | null,
    ): string[] => [
      ...new Set(assignments.map(pick).filter((v): v is string => !!v)),
    ];
    const testListIds = uniqueIds((a) => a.branchLabTestListId);
    const panelListIds = uniqueIds((a) => a.branchLabPanelListId);
    const radiologyTestListIds = uniqueIds((a) => a.branchRadiologyTestListId);
    const radiologyPanelListIds = uniqueIds(
      (a) => a.branchRadiologyPanelListId,
    );

    const [testLists, panelLists, radiologyTestLists, radiologyPanelLists] =
      await Promise.all([
        testListIds.length
          ? this.prisma.branchLabTestList.findMany({
              where: { id: { in: testListIds }, tenantId, deletedAt: null },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        panelListIds.length
          ? this.prisma.branchLabPanelList.findMany({
              where: { id: { in: panelListIds }, tenantId, deletedAt: null },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        radiologyTestListIds.length
          ? this.prisma.branchRadiologyTestList.findMany({
              where: {
                id: { in: radiologyTestListIds },
                tenantId,
                deletedAt: null,
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        radiologyPanelListIds.length
          ? this.prisma.branchRadiologyPanelList.findMany({
              where: {
                id: { in: radiologyPanelListIds },
                tenantId,
                deletedAt: null,
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
    const testNameById = new Map(testLists.map((l) => [l.id, l.name]));
    const panelNameById = new Map(panelLists.map((l) => [l.id, l.name]));
    const radiologyTestNameById = new Map(
      radiologyTestLists.map((l) => [l.id, l.name]),
    );
    const radiologyPanelNameById = new Map(
      radiologyPanelLists.map((l) => [l.id, l.name]),
    );

    const toRef = (
      id: string | null,
      nameById: Map<string, string>,
    ): LabListRef | null => (id ? { id, name: nameById.get(id) ?? '' } : null);

    const result = new Map<string, ReferralListAssignmentView>();
    for (const a of assignments) {
      result.set(a.referralId, {
        labTestList: toRef(a.branchLabTestListId, testNameById),
        labPanelList: toRef(a.branchLabPanelListId, panelNameById),
        radiologyTestList: toRef(
          a.branchRadiologyTestListId,
          radiologyTestNameById,
        ),
        radiologyPanelList: toRef(
          a.branchRadiologyPanelListId,
          radiologyPanelNameById,
        ),
      });
    }
    return result;
  }

  /**
   * Resolve the pricing lists for an order. Walks the priority chain — B2B panel
   * → PT category → referred-by doctor → internal → external — and the first
   * applicable configuration wins. The PT category (slot 2) resolves to its
   * mapped Lab Test / Lab Panel's own pricing lists; the referral steps use the
   * branch's `ReferralListAssignment`. Each unset list on the winning result
   * falls back to the branch's default Walk-in list, as does the whole result
   * when nothing matches.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param query the selected referral / PT category ids
   */
  async resolve(
    tenantId: string,
    branchId: string,
    query: ResolveListsQueryDto,
  ): Promise<ResolvedLists> {
    const defaults = await this.getDefaultListIds(tenantId, branchId);

    // 1. Referral Panel (B2B) — highest priority.
    const panel = await this.resolveReferralAssignment(
      tenantId,
      branchId,
      'PANEL',
      query.referralPanelId,
      defaults,
    );
    if (panel) {
      return panel;
    }

    // 2. PT (Patient) Category — its mapped items' pricing lists.
    if (query.ptCategoryId) {
      const listIds = await this.ptCategoryService.getResolvedListIds(
        tenantId,
        branchId,
        query.ptCategoryId,
      );
      if (
        listIds &&
        (listIds.branchLabTestListId || listIds.branchLabPanelListId)
      ) {
        return {
          branchLabTestListId:
            listIds.branchLabTestListId ?? defaults.testListId,
          branchLabPanelListId:
            listIds.branchLabPanelListId ?? defaults.panelListId,
          // PT category maps lab items only; radiology falls back to defaults.
          branchRadiologyTestListId: defaults.radiologyTestListId,
          branchRadiologyPanelListId: defaults.radiologyPanelListId,
          source: 'PT_CATEGORY',
        };
      }
    }

    // 3-5. Referred-by doctor → internal → external.
    for (const { type, key } of RESOLVE_ORDER) {
      const resolved = await this.resolveReferralAssignment(
        tenantId,
        branchId,
        type,
        query[key],
        defaults,
      );
      if (resolved) {
        return resolved;
      }
    }

    return {
      branchLabTestListId: defaults.testListId,
      branchLabPanelListId: defaults.panelListId,
      branchRadiologyTestListId: defaults.radiologyTestListId,
      branchRadiologyPanelListId: defaults.radiologyPanelListId,
      source: 'DEFAULT',
    };
  }

  /**
   * Resolve a single referral's list assignment to a `ResolvedLists`, or null
   * when there's no referral id or no active assignment with a list. Each unset
   * list falls back to the branch default.
   */
  private async resolveReferralAssignment(
    tenantId: string,
    branchId: string,
    type: ReferralType,
    referralId: string | undefined,
    defaults: DefaultListIds,
  ): Promise<ResolvedLists | null> {
    if (!referralId) {
      return null;
    }
    const assignment = await this.getAssignment(
      tenantId,
      branchId,
      type,
      referralId,
    );
    if (
      assignment &&
      (assignment.branchLabTestListId ||
        assignment.branchLabPanelListId ||
        assignment.branchRadiologyTestListId ||
        assignment.branchRadiologyPanelListId)
    ) {
      return {
        branchLabTestListId:
          assignment.branchLabTestListId ?? defaults.testListId,
        branchLabPanelListId:
          assignment.branchLabPanelListId ?? defaults.panelListId,
        branchRadiologyTestListId:
          assignment.branchRadiologyTestListId ?? defaults.radiologyTestListId,
        branchRadiologyPanelListId:
          assignment.branchRadiologyPanelListId ??
          defaults.radiologyPanelListId,
        source: type,
      };
    }
    return null;
  }

  /** Read the branch's default (Walk-in) list ids (null if not imported yet). */
  private async getDefaultListIds(
    tenantId: string,
    branchId: string,
  ): Promise<DefaultListIds> {
    const [testList, panelList, radiologyTestList, radiologyPanelList] =
      await Promise.all([
        this.prisma.branchLabTestList.findFirst({
          where: { tenantId, branchId, isDefault: true, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.branchLabPanelList.findFirst({
          where: { tenantId, branchId, isDefault: true, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.branchRadiologyTestList.findFirst({
          where: { tenantId, branchId, isDefault: true, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.branchRadiologyPanelList.findFirst({
          where: { tenantId, branchId, isDefault: true, deletedAt: null },
          select: { id: true },
        }),
      ]);
    return {
      testListId: testList?.id ?? null,
      panelListId: panelList?.id ?? null,
      radiologyTestListId: radiologyTestList?.id ?? null,
      radiologyPanelListId: radiologyPanelList?.id ?? null,
    };
  }
}
