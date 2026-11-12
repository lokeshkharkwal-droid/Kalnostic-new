import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LabReportStatus,
  Prisma,
  ReRunSampleMode,
  ReRunStatus,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { LAB_REPORT_ALLOWED_FROM } from '../lab-report/entities/lab-report.entity';
import { LabReportNotFoundException } from '../lab-report/exceptions/lab-report.exceptions';
import { OrderSampleService } from './accession-sample.service';
import { AccessionSettingsService } from './accession-settings.service';
import { clearBarcodeForRepeatInTx } from './utils/repeat-barcode.util';
import { ReRunFreshNotAllowedException } from './exceptions/accession.exceptions';
import type { ReRunFreshDto } from './dto/re-run-fresh.dto';

/** Where a test's sample is, which decides how the fresh sample is arranged. */
export type ReRunFreshKind = 'IN_HOUSE' | 'COPY' | 'OUTSOURCED';

/** One test of the group, with whether it can be re-run with a fresh sample now. */
export interface ReRunFreshTest {
  reportId: string;
  testName: string;
  reportStatus: LabReportStatus;
  isClicked: boolean;
  eligible: boolean;
  /** Why not, in words for the pop-up (null when eligible). */
  reason: string | null;
  kind: ReRunFreshKind | null;
  sampleIds: string[];
  sampleStatuses: SampleStatus[];
  barcode: string | null;
}

export interface ReRunFreshEligibility {
  /** The branch's configured repeat reasons (Accession settings), for the reason dropdown: the technician may not be allowed to read those settings. */
  repeatReasons: string[];
  orderId: string;
  orderCode: string;
  /** The barcode the clicked test's sample carries (the tests listed share it); null when it has none yet. */
  barcode: string | null;
  tests: ReRunFreshTest[];
}

export interface ReRunFreshResultItem {
  reportId: string;
  kind: ReRunFreshKind;
  sampleIds: string[];
  /** Always null: the new barcode is made when the repeated tube is collected again. */
  barcode: string | null;
}

export interface ReRunFreshResult {
  batchId: string;
  items: ReRunFreshResultItem[];
}

const RERUN_ALLOWED = LAB_REPORT_ALLOWED_FROM.reRun as readonly string[];

const REPORT_SELECT = {
  id: true,
  status: true,
  isLocked: true,
  branchId: true,
  orderItemId: true,
  memberBranchLabTestId: true,
  labTestId: true,
  orderItem: {
    select: {
      id: true,
      deletedAt: true,
      order: { select: { id: true, orderCode: true, status: true } },
      branchLabTest: { select: { testName: true } },
      branchLabPanel: { select: { panelName: true } },
      direct: true,
    },
  },
} satisfies Prisma.LabReportSelect;
type ReportRow = Prisma.LabReportGetPayload<{ select: typeof REPORT_SELECT }>;

const TUBE_SELECT = {
  id: true,
  status: true,
  barcode: true,
  branchId: true,
  orderId: true,
  sourceTransferId: true,
  tests: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.OrderSampleSelect;
type TubeRow = Prisma.OrderSampleGetPayload<{ select: typeof TUBE_SELECT }>;

/**
 * Re-run with a fresh sample (Technician + Accession).
 *
 * The technician redoes a test whose sample must be collected again. In ONE transaction this wipes the report(s), records the
 * Re-run request, and sends the test's tube(s) back for a fresh collection:
 *  - an in-house tube (Accepted) goes to REPEAT and loses its old barcode; Collect makes the new one (shared by the tubes
 *    re-run together); the report stays locked (a tube before Accept locks it) until the fresh tube is accepted;
 *  - a tube received from another branch (an accepted copy) is sent back to the branch that sent it, like Repeat on the copy:
 *    the copy is voided, the report returns to the sender, the transfer is closed as Repeat, and the sender confirms the
 *    Repeat on its original (whose new barcode is made at Collect);
 *  - an Outsourced tube: the outsource transfer is closed as Repeat; the sample stays Outsourced ("Outsourced – Repeated")
 *    and the report is view-only until the sender confirms the Repeat (or Retrieves).
 * Re-run is allowed only from Result Done, Result Rejected or Error Reported (the Re-run status rule). All-or-nothing.
 */
@Injectable()
export class ReRunFreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly samples: OrderSampleService,
    private readonly labReports: LabReportService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settings: AccessionSettingsService,
  ) {}

  // ── Eligibility (the pop-up) ───────────────────────────────────────────────

  /**
   * The tests that share the clicked test's tube (same barcode) at this branch, each with whether it can be re-run with a
   * fresh sample. The clicked test is always listed first.
   * A caller limited to some departments sees a same-barcode test of ANOTHER department greyed out ("not in your department":
   * the re-run would be refused for the whole request), and gets "not found" for a clicked report that is itself outside
   * their departments (they cannot see it, so nothing about it is revealed).
   * @throws LabReportNotFoundException when the report is not at the caller's branch or not in the caller's departments
   */
  async eligibility(
    tenantId: string,
    branchId: string,
    reportId: string,
    personId: string | null = null,
  ): Promise<ReRunFreshEligibility> {
    const { MasterData_RepeatReasons: repeatReasons } =
      await this.settings.resolve(tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const clicked = await this.loadReport(tx, tenantId, branchId, reportId);
      if (!clicked) throw new LabReportNotFoundException(reportId);
      const clickedTubes = await this.tubesOf(tx, tenantId, clicked);
      if (
        (
          await this.samples.findSamplesOutsideDepartmentScope(
            tenantId,
            personId,
            clickedTubes.map((t) => t.id),
          )
        ).length > 0
      ) {
        throw new LabReportNotFoundException(reportId);
      }
      const barcode =
        clickedTubes.map((t) => t.barcode).find((b): b is string => !!b) ??
        null;

      // The tests that share the barcode: the reports of this order, at this branch, whose own tube carries it.
      const mates = new Map<string, ReportRow>([[clicked.id, clicked]]);
      if (barcode) {
        const sharing = await tx.orderSample.findMany({
          where: {
            tenantId,
            deletedAt: null,
            branchId,
            orderId: clicked.orderItem.order.id,
            barcode,
          },
          select: {
            tests: {
              where: { deletedAt: null },
              select: { orderItemId: true, labTestId: true },
            },
          },
        });
        const itemIds = [
          ...new Set(sharing.flatMap((s) => s.tests.map((t) => t.orderItemId))),
        ];
        if (itemIds.length > 0) {
          const reports = await tx.labReport.findMany({
            where: {
              tenantId,
              branchId,
              deletedAt: null,
              orderItemId: { in: itemIds },
            },
            select: REPORT_SELECT,
            orderBy: { createdAt: 'asc' },
          });
          const tests = sharing.flatMap((s) => s.tests);
          for (const r of reports) {
            // a panel member is matched on its own test; a plain report on the order line
            const on = tests.some(
              (t) =>
                t.orderItemId === r.orderItemId &&
                (!r.memberBranchLabTestId || t.labTestId === r.labTestId),
            );
            if (on) mates.set(r.id, r);
          }
        }
      }

      const ordered = [
        clicked,
        ...[...mates.values()].filter((r) => r.id !== clicked.id),
      ];
      const tests: ReRunFreshTest[] = [];
      for (const r of ordered) {
        const tubes = await this.tubesOf(tx, tenantId, r);
        const outside =
          (
            await this.samples.findSamplesOutsideDepartmentScope(
              tenantId,
              personId,
              tubes.map((t) => t.id),
            )
          ).length > 0;
        const verdict = outside
          ? { reason: 'This test is not in your department.', kind: null }
          : this.evaluate(r, tubes);
        tests.push({
          reportId: r.id,
          testName: this.testName(r),
          reportStatus: r.status,
          isClicked: r.id === clicked.id,
          eligible: verdict.reason === null,
          reason: verdict.reason,
          kind: verdict.kind,
          sampleIds: tubes.map((t) => t.id),
          sampleStatuses: tubes.map((t) => t.status),
          barcode:
            tubes.map((t) => t.barcode).find((b): b is string => !!b) ?? null,
        });
      }
      return {
        repeatReasons,
        orderId: clicked.orderItem.order.id,
        orderCode: clicked.orderItem.order.orderCode,
        barcode,
        tests,
      };
    });
  }

  // ── The re-run ─────────────────────────────────────────────────────────────

  /**
   * Re-run the given tests with a fresh sample (all or nothing).
   * @throws LabReportNotFoundException a report is not at the caller's branch
   * @throws ReRunFreshNotAllowedException a test cannot be re-run now (the message says why)
   */
  async rerunFresh(
    tenantId: string,
    branchId: string,
    personId: string,
    dto: ReRunFreshDto,
  ): Promise<ReRunFreshResult> {
    const reportIds = [...new Set(dto.reportIds)].sort();
    const reason = dto.repeatReason.trim();
    if (!reason) {
      throw new ReRunFreshNotAllowedException([
        { reportId: reportIds[0]!, reason: 'A repeat reason is required.' },
      ]);
    }
    const notes = dto.notes?.trim() || undefined;
    const noteText = `Re-run with fresh sample${notes ? `: ${notes}` : ''}`;
    const batchId = randomUUID();

    // A cheap read first, so a refusal does not open a transaction and the department scope is checked up front.
    const pre = await this.prisma.withTenant(tenantId, async (tx) => {
      const reports = await this.loadReports(tx, tenantId, branchId, reportIds);
      const tubeIds: string[] = [];
      for (const r of reports) {
        for (const t of await this.tubesOf(tx, tenantId, r)) tubeIds.push(t.id);
      }
      return tubeIds;
    });
    await this.samples.assertSamplesInDepartmentScope(tenantId, personId, pre);

    const items = await this.prisma.withTenant(tenantId, async (tx) => {
      // 1. lock the reports, then judge them from what the rows are NOW (a report approved a moment ago is refused)
      await this.labReports.lockReports(tx, tenantId, reportIds);
      const reports = await this.loadReports(tx, tenantId, branchId, reportIds);
      this.assertSameOrder(reports);
      const plan: {
        report: ReportRow;
        kind: ReRunFreshKind;
        tubes: TubeRow[];
      }[] = [];
      const refusals: { reportId: string; reason: string }[] = [];
      for (const r of reports) {
        const tubes = await this.tubesOf(tx, tenantId, r);
        const v = this.evaluate(r, tubes);
        if (v.reason !== null || v.kind === null) {
          refusals.push({
            reportId: r.id,
            reason: `${this.testName(r)}: ${v.reason ?? 'cannot be re-run'}`,
          });
        } else plan.push({ report: r, kind: v.kind, tubes });
      }
      if (refusals.length > 0)
        throw new ReRunFreshNotAllowedException(refusals);

      // 2. wipe the reports (works from Result Done too) and record why
      await this.labReports.resetReportsForReturn(
        tx,
        tenantId,
        reportIds,
        personId,
      );
      const createRequest = (reportId: string) =>
        tx.reRunRequest.create({
          data: {
            tenantId,
            branchId,
            labReportId: reportId,
            status: ReRunStatus.PENDING,
            requestedBy: personId,
            requestNotes: notes ?? null,
            sampleMode: ReRunSampleMode.FRESH,
            repeatBatchId: batchId,
          },
        });
      for (const p of plan) {
        await this.labReports.recordFreshRerunInTx(
          tx,
          tenantId,
          p.report.id,
          p.report.status,
          personId,
          `${noteText} (reason: ${reason})`,
        );
        // A received copy's report is reset AGAIN when it goes back to the sender (returnCopyToOrigin), which clears the
        // request cycle, so its request is written after that step below.
        if (p.kind !== 'COPY') await createRequest(p.report.id);
      }

      // 3. send the tubes back, by where each one is (one tube may serve a test only; checked in evaluate)
      const inHouse = new Map<string, TubeRow>();
      const copies = new Map<string, TubeRow>();
      const outsourced = new Map<string, TubeRow>();
      for (const p of plan) {
        const bucket =
          p.kind === 'IN_HOUSE'
            ? inHouse
            : p.kind === 'COPY'
              ? copies
              : outsourced;
        for (const t of p.tubes) bucket.set(t.id, t);
      }

      for (const id of [...inHouse.keys()].sort()) {
        await this.samples.transitionInTx(
          tx,
          tenantId,
          personId,
          id,
          'repeat',
          () => ({ data: {}, reason }),
          { notes: noteText, freshRerun: true },
        );
      }
      // The old barcode comes off the repeated tubes; Collect makes their new one (one shared by this batch).
      await clearBarcodeForRepeatInTx(tx, {
        tenantId,
        personId,
        sampleIds: [...inHouse.keys()],
        batchId,
      });

      for (const id of [...copies.keys()].sort()) {
        const copy = copies.get(id)!;
        // the copy is voided, the report goes back to the sender and the sender's original stays Sent ("Sent – Repeated")
        await this.samples.returnCopyToOrigin(
          tx,
          tenantId,
          personId,
          id,
          reason,
          'repeat',
        );
        await tx.sampleTransfer.updateMany({
          where: {
            id: copy.sourceTransferId!,
            tenantId,
            deletedAt: null,
            transferStatus: TransferStatus.ACCEPTED,
          },
          data: {
            transferStatus: TransferStatus.REPEAT,
            repeatReason: reason,
            updatedBy: personId,
          },
        });
      }

      for (const p of plan) if (p.kind === 'COPY') await createRequest(p.report.id);

      for (const id of [...outsourced.keys()].sort()) {
        // the outsource transfer is closed as Repeat; the sample stays Outsourced until the sender confirms Repeat
        const transfer = await tx.sampleTransfer.findFirst({
          where: {
            sampleId: id,
            tenantId,
            kind: TransferKind.OUTSOURCE,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!transfer) {
          throw new ReRunFreshNotAllowedException([
            {
              reportId: reportIds[0]!,
              reason: 'The outsource transfer of this sample was not found.',
            },
          ]);
        }
        await tx.sampleTransfer.update({
          where: { id: transfer.id },
          data: {
            transferStatus: TransferStatus.REPEAT,
            repeatReason: reason,
            updatedBy: personId,
          },
        });
        await this.samples.recordNoteInTx(
          tx,
          tenantId,
          personId,
          id,
          're-run-fresh',
          {
            notes: `${noteText} (reason: ${reason}); the outsource transfer is closed as Repeat`,
          },
        );
      }

      return plan.map<ReRunFreshResultItem>((p) => ({
        reportId: p.report.id,
        kind: p.kind,
        sampleIds: p.tubes.map((t) => t.id),
        barcode: null, // made at Collect
      }));
    });

    // Fire-and-forget, like a normal Repeat: inform the order's referring panel (B2B); walk-in orders are skipped there.
    const inHouseIds = items
      .filter((i) => i.kind === 'IN_HOUSE')
      .flatMap((i) => i.sampleIds);
    if (inHouseIds.length > 0) {
      const rows = await this.prisma.withTenant(tenantId, (tx) =>
        tx.orderSample.findMany({
          where: { id: { in: inHouseIds }, tenantId },
          select: { id: true, branchId: true, orderId: true },
        }),
      );
      for (const s of rows) {
        void this.eventEmitter.emitAsync('accession.sample.repeat', {
          tenantId,
          branchId: s.branchId ?? null,
          sampleId: s.id,
          orderId: s.orderId,
        });
      }
    }
    return { batchId, items };
  }

  // ── Judging one test ───────────────────────────────────────────────────────

  /**
   * Whether a test can be re-run with a fresh sample now, and how its tubes are arranged. `reason` is null when it can.
   * @param report the report with its order line and order
   * @param tubes the report's live samples at the holder branch
   */
  private evaluate(
    report: ReportRow,
    tubes: TubeRow[],
  ): { reason: string | null; kind: ReRunFreshKind | null } {
    const no = (reason: string) => ({ reason, kind: null });
    if (report.orderItem.order.status === 'CANCELLED')
      return no('The order is cancelled.');
    if (report.orderItem.deletedAt)
      return no('The test was removed from the order.');
    if (!RERUN_ALLOWED.includes(report.status)) {
      return no(
        'A re-run is possible from Result Done, Result Rejected or Error Reported. Reject the result first (Validation Pending) or report an error first (Approved / Published).',
      );
    }
    if (report.isLocked) return no('The report is locked. Unlock it first.');
    if (tubes.length === 0)
      return no('No sample was found for this test at this branch.');
    if (tubes.some((t) => t.tests.length > 1)) {
      return no(
        'A sample here carries more than one test. Use Repeat in Accession.',
      );
    }
    const kinds = new Set<ReRunFreshKind>();
    for (const t of tubes) {
      if (t.status === SampleStatus.SENT_INTERNAL) {
        return no(
          'The sample was sent to another branch. Wait for the receiving branch, or retrieve it first.',
        );
      }
      if (t.status === SampleStatus.OUTSOURCED) kinds.add('OUTSOURCED');
      else if (t.status === SampleStatus.ACCEPTED) {
        kinds.add(t.sourceTransferId ? 'COPY' : 'IN_HOUSE');
      } else {
        return no(
          `The sample is ${this.sampleWord(t.status)}. It must be Accepted (or Outsourced) for a re-run with a fresh sample.`,
        );
      }
    }
    if (kinds.size > 1) {
      return no(
        'The samples of this test are in different places. Use Repeat in Accession.',
      );
    }
    return { reason: null, kind: [...kinds][0]! };
  }

  /** The sample status in words for a message. */
  private sampleWord(status: SampleStatus): string {
    return status.toLowerCase().replace(/_/g, ' ');
  }

  private testName(r: ReportRow): string {
    return (
      r.orderItem.branchLabTest?.testName ??
      r.orderItem.branchLabPanel?.panelName ??
      r.orderItem.direct ??
      'Test'
    );
  }

  /** The reports must belong to one order (one pop-up = one order). */
  private assertSameOrder(reports: ReportRow[]): void {
    const orders = new Set(reports.map((r) => r.orderItem.order.id));
    if (orders.size > 1) {
      throw new ReRunFreshNotAllowedException([
        {
          reportId: reports[0]!.id,
          reason: 'Select tests of one order only.',
        },
      ]);
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  private loadReport(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    reportId: string,
  ): Promise<ReportRow | null> {
    return tx.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      select: REPORT_SELECT,
    });
  }

  /** The reports at the caller's branch; a missing one is a not-found (never reveals another branch's report). */
  private async loadReports(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    reportIds: string[],
  ): Promise<ReportRow[]> {
    const rows = await tx.labReport.findMany({
      where: { id: { in: reportIds }, tenantId, branchId, deletedAt: null },
      select: REPORT_SELECT,
      orderBy: { id: 'asc' },
    });
    const found = new Set(rows.map((r) => r.id));
    const missing = reportIds.find((id) => !found.has(id));
    if (missing) throw new LabReportNotFoundException(missing);
    return rows;
  }

  /** The report's live samples at its holder branch: those serving its order line (and, for a panel member, its test). */
  private tubesOf(
    tx: Prisma.TransactionClient,
    tenantId: string,
    report: ReportRow,
  ): Promise<TubeRow[]> {
    return tx.orderSample.findMany({
      where: {
        tenantId,
        deletedAt: null,
        branchId: report.branchId,
        tests: {
          some: {
            orderItemId: report.orderItemId,
            deletedAt: null,
            ...(report.memberBranchLabTestId
              ? { labTestId: report.labTestId }
              : {}),
          },
        },
      },
      select: TUBE_SELECT,
      orderBy: { id: 'asc' },
    });
  }
}
