import { Injectable, Logger } from '@nestjs/common';
import {
  LabAdapter,
  LabReportStatus,
  OrderStatus,
  Prisma,
  ResultValueSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitResultBody, EmiTestResult } from './dto/submit-result.dto';
import {
  EMI,
  EMI_STATUS,
  UPDATE_TEST_STATUS,
  EmiOrderRow,
  EmiOrdersResponse,
  EmiReportLog,
  EmiSubmitResponse,
} from './entities/emi-response.entity';
import {
  genderInitial,
  matchKey,
  parseResultDate,
  toEpochSeconds,
} from './util/emi-format';

/** Report statuses that may still be (re)filled by a machine. */
const FILLABLE_STATUSES: ReadonlySet<LabReportStatus> = new Set([
  LabReportStatus.PENDING,
  LabReportStatus.PARTIAL_PENDING,
  LabReportStatus.SAVED,
]);

/** The order graph the EMI endpoints need: patient, referring doctor, items. */
const ORDER_INCLUDE = {
  patient: {
    select: {
      id: true,
      umId: true,
      firstName: true,
      lastName: true,
      gender: true,
      dateOfBirth: true,
    },
  },
  referredByDoctor: { select: { firstName: true, lastName: true } },
  items: {
    where: { deletedAt: null },
    include: {
      branchLabTest: { select: { id: true, testName: true, testCode: true } },
      branchLabPanel: { select: { id: true, panelName: true } },
      labReport: true,
    },
  },
} satisfies Prisma.OrderInclude;

type EmiOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * The adapter's resolved integration context: which branches it serves and which
 * branch lab tests it reports (its "prefered tests").
 */
interface AdapterContext {
  branchIds: string[];
  /** Set of `BranchLabTest.id` the adapter is configured to report. */
  mappedTestIds: Set<string>;
  /** `{ branchLabTestId: testName }` — the legacy `prefered_test` map. */
  preferedTest: Record<string, string>;
  /** Equipment.code, echoed back as `adapter_code`. */
  equipmentCode: string | null;
}

/** A normalised analyte value extracted from the machine payload. */
interface SubmittedValue {
  uidKey: string;
  nameKey: string;
  displayKey: string;
  value: string;
  unit: string | null;
}

/**
 * EMI (External Machine Interface) service — the lab-analyzer compatibility layer
 * that reproduces the legacy EzHealthTrack `/emi` contract (CLAUDE.md: mirror the
 * reference implementation). A machine authenticates with a `TOKEN` header (an
 * active `LabAdapter.token`), which yields the tenant + branches + prefered tests;
 * there is no JWT, so all work runs inside `prisma.withTenant(adapter.tenantId)`.
 * Every submission is persisted as an `AdapterResult` audit row. Responses use the
 * flat legacy `{ s, m, … }` envelope (built by the controller via `@Res()`), never
 * the standard `{ success, data, meta }` wrapper.
 */
@Injectable()
export class EmiService {
  private readonly logger = new Logger(EmiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the authenticating adapter from the raw `TOKEN` header value. Because
   * `lab_adapters` is RLS-scoped and no tenant context exists yet, the lookup runs
   * in a transaction that sets `app.adapter_token` so the dedicated token-lookup
   * policy (prisma/rls.sql) makes exactly the matching row visible.
   * @param token the `TOKEN` header value (may be undefined/empty)
   * @returns the active adapter, or `null` when missing/unknown/inactive
   */
  async resolveAdapterByToken(
    token: string | undefined,
  ): Promise<LabAdapter | null> {
    const value = token?.trim();
    if (!value) {
      return null;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.adapter_token', ${value}, true)`;
        return tx.labAdapter.findFirst({
          where: { token: value, isActive: true, deletedAt: null },
        });
      });
    } catch (e) {
      this.logger.error(
        `Adapter token lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * `GET /emi/orders` — return the order + patient + pending-test info for a
   * scanned id. In our system the scanned `specimen_id` is the order's
   * `orderCode`.
   * @param adapter the authenticated adapter (tenant + branch scope)
   * @param specimenId the scanned id (= `Order.orderCode`)
   * @returns the legacy `{ s, orders: [...] }` envelope
   */
  async getOrders(
    adapter: LabAdapter,
    specimenId: string | undefined,
  ): Promise<EmiOrdersResponse> {
    const code = specimenId?.trim();
    if (!code) {
      return { s: EMI.BAD_REQUEST, m: 'Missing specimen id' };
    }

    return this.prisma.withTenant(adapter.tenantId, async (tx) => {
      const ctx = await this.resolveContext(tx, adapter);
      const order = await this.findOrder(tx, adapter.tenantId, code, ctx);
      if (!order) {
        return { s: EMI.BAD_REQUEST, m: 'Specimen id not found' };
      }

      const tenant = await tx.tenant.findUnique({
        where: { id: adapter.tenantId },
        select: { name: true },
      });

      // ut_ids: mapped + still-fillable tests on this order, by testCode.
      const utIds: string[] = [];
      for (const item of order.items) {
        if (
          !item.branchLabTestId ||
          !ctx.mappedTestIds.has(item.branchLabTestId)
        ) {
          continue;
        }
        const report = item.labReport;
        const fillable =
          !report || (FILLABLE_STATUSES.has(report.status) && !report.isLocked);
        const testCode = item.branchLabTest?.testCode;
        if (fillable && testCode && !utIds.includes(testCode)) {
          utIds.push(testCode);
        }
      }

      const doctor = order.referredByDoctor;
      const doctorName = doctor
        ? [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim()
        : '';

      const row: EmiOrderRow = {
        specimen_id: code,
        order_date: toEpochSeconds(order.orderDate),
        patient_id: order.patient.umId ?? order.patient.id,
        patient_name: order.patient.firstName,
        patient_surname: order.patient.lastName ?? '',
        birth_date: toEpochSeconds(order.patient.dateOfBirth),
        patient_gender: genderInitial(order.patient.gender),
        admission_number: order.orderCode,
        sender_organization: tenant?.name ?? '',
        sender_doctor: doctorName,
        ut_ids: utIds,
      };

      return { s: EMI.OK, orders: [row] };
    });
  }

  /**
   * `GET /emi/submitResult` — fill the machine's result values onto the order's
   * reports. Mirrors the legacy `AdapterResult::processAdapterResult`: only
   * fillable, adapter-mapped reports are updated (value written with
   * `source = ADAPTER`, report moved to `SAVED`); non-fillable/unmapped reports
   * are skipped with a `report_log` note. Never approves/publishes — human
   * sign-off is unchanged. Always writes an `AdapterResult` audit row.
   * @param adapter the authenticated adapter
   * @param body the (leniently parsed) machine payload
   * @param sourceIp the caller IP (for the audit row)
   * @returns the legacy submit envelope
   */
  async submitResult(
    adapter: LabAdapter,
    body: SubmitResultBody,
    sourceIp: string | null,
  ): Promise<EmiSubmitResponse> {
    const testResults = Array.isArray(body.test_results)
      ? body.test_results
      : [];
    const emiCode = this.emiStatusCode(body, testResults);

    return this.prisma.withTenant(adapter.tenantId, async (tx) => {
      const ctx = await this.resolveContext(tx, adapter);
      const code = body.tube_no?.trim() ?? '';
      const order = code
        ? await this.findOrder(tx, adapter.tenantId, code, ctx)
        : null;

      // Common audit-row writer (one row per submission).
      const writeAudit = (
        orderId: string | null,
        branchId: string | null,
        updateTestStatus: string | null,
      ): Promise<unknown> =>
        tx.adapterResult.create({
          data: {
            tenantId: adapter.tenantId,
            branchId,
            orderId,
            tokenId: adapter.token,
            adapterId: adapter.id,
            adapterCode: ctx.equipmentCode,
            equipmentId: adapter.equipmentId,
            tubeInformationId: body.tube_information_id ?? null,
            tubeNo: body.tube_no ?? null,
            originalTubeNo: body.original_tube_no ?? null,
            specimenType: body.specimen_type ?? null,
            resultDate: body.result_date ?? null,
            sent: body.sent ?? null,
            sentDate: body.sent_date ?? null,
            status: body.status ?? null,
            localDbStatus: body.local_db_status ?? null,
            comment: body.comment ?? null,
            testResults: testResults as unknown as Prisma.InputJsonValue,
            emiStatus: emiCode,
            updateTestStatus,
            sourceIp,
          },
        });

      // Order not found.
      if (!order) {
        await writeAudit(null, null, UPDATE_TEST_STATUS.ORDER_NOT_FOUND);
        return {
          s: EMI.OK,
          m: 'Result added successfully',
          emi_status: this.emiStatusLabel(emiCode),
          test_status: 'Order not found.',
          prefered_test: ctx.preferedTest,
          unique_test_ids: {},
        };
      }

      // Order already closed (our terminal state is CANCELLED; per-report
      // fillability guards the rest — a completed order's reports are APPROVED/
      // PUBLISHED and therefore not fillable below).
      if (order.status === OrderStatus.CANCELLED) {
        await writeAudit(
          order.id,
          order.branchId,
          UPDATE_TEST_STATUS.ALREADY_COMPLETE,
        );
        return {
          s: EMI.OK,
          m: 'Result added successfully',
          emi_status: this.emiStatusLabel(emiCode),
          test_status: 'Test already marked as complete',
          prefered_test: ctx.preferedTest,
          unique_test_ids: {},
        };
      }

      const submitted = this.normaliseSubmitted(testResults);
      if (submitted.length === 0) {
        await writeAudit(
          order.id,
          order.branchId,
          UPDATE_TEST_STATUS.MISSING_VALUES,
        );
        return {
          s: EMI.OK,
          m: 'Result added successfully',
          emi_status: this.emiStatusLabel(emiCode),
          test_status: 'No test result submitted',
          prefered_test: ctx.preferedTest,
          unique_test_ids: {},
        };
      }

      const now = new Date();
      const enteredAt = parseResultDate(body.result_date) ?? now;
      const log: EmiReportLog[] = [];
      let updatedCount = 0;

      for (const item of order.items) {
        const report = item.labReport;
        if (!report) {
          continue; // no reporting row yet (sample not accepted) → nothing to fill
        }
        const reportName =
          item.branchLabTest?.testName ?? item.branchLabPanel?.panelName ?? '';
        const base: EmiReportLog = {
          report_id: report.id,
          report_name: reportName,
          status: report.status,
          before_report_status: report.status,
          fill_status: '',
          available_branches: ctx.branchIds,
          branch_id: order.branchId,
        };

        // Not fillable (terminal status / locked).
        if (!FILLABLE_STATUSES.has(report.status) || report.isLocked) {
          log.push({
            ...base,
            fill_status: 'Not filled due to report status is not pending.',
          });
          continue;
        }

        // Not one of the adapter's prefered (mapped) tests.
        if (
          !item.branchLabTestId ||
          !ctx.mappedTestIds.has(item.branchLabTestId)
        ) {
          log.push({
            ...base,
            fill_status: `${reportName} Not in prefered test list`,
          });
          continue;
        }

        const params = await this.resolveParams(tx, report.labTestId, item);
        const matches = this.matchValues(params, submitted, item.branchLabTest);
        if (matches.length === 0) {
          log.push({
            ...base,
            fill_status: 'No matching result value for this report',
          });
          continue;
        }

        for (const match of matches) {
          await tx.labReportResultValue.upsert({
            where: {
              labReportId_resultParamId: {
                labReportId: report.id,
                resultParamId: match.resultParamId,
              },
            },
            create: {
              tenantId: adapter.tenantId,
              labReportId: report.id,
              resultParamId: match.resultParamId,
              observed1: match.value,
              unit: match.unit,
              source: ResultValueSource.ADAPTER,
              enteredAt,
              enteredBy: adapter.id,
            },
            update: {
              observed1: match.value,
              unit: match.unit,
              source: ResultValueSource.ADAPTER,
              enteredAt,
              enteredBy: adapter.id,
              deletedAt: null,
            },
          });
        }

        await tx.labReport.update({
          where: { id: report.id },
          data: {
            status: LabReportStatus.SAVED,
            savedAt: now,
            savedBy: adapter.id,
          },
        });

        updatedCount += 1;
        log.push({
          ...base,
          status: LabReportStatus.SAVED,
          fill_status: 'Report filled',
        });
      }

      const reportLog = {
        order_id: order.orderCode,
        datetime: this.formatDateTime(now),
        log,
      };

      if (updatedCount > 0) {
        // Success path: audit row with no error status.
        await writeAudit(order.id, order.branchId, null);
        return {
          s: EMI.OK,
          m: 'Result updated successfully',
          emi_status: this.emiStatusLabel(emiCode),
          test_status: `${updatedCount} test updated`,
          report_log: reportLog,
          prefered_test: ctx.preferedTest,
          unique_test_ids: {},
        };
      }

      await writeAudit(
        order.id,
        order.branchId,
        UPDATE_TEST_STATUS.TOKEN_MISMATCH,
      );
      return {
        s: EMI.OK,
        m: 'Result added successfully',
        emi_status: this.emiStatusLabel(emiCode),
        test_status: 'no test match found for requested token',
        report_log: reportLog,
        prefered_test: ctx.preferedTest,
        unique_test_ids: {},
      };
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /** Resolve the adapter's branches, mapped tests, and equipment code. */
  private async resolveContext(
    tx: Prisma.TransactionClient,
    adapter: LabAdapter,
  ): Promise<AdapterContext> {
    const [branchRows, testRows, equipment] = await Promise.all([
      tx.labAdapterBranch.findMany({
        where: {
          labAdapterId: adapter.id,
          tenantId: adapter.tenantId,
          deletedAt: null,
        },
        select: { branchId: true },
      }),
      tx.labAdapterTest.findMany({
        where: {
          labAdapterId: adapter.id,
          tenantId: adapter.tenantId,
          deletedAt: null,
        },
        select: { branchLabTestId: true },
      }),
      tx.equipment.findFirst({
        where: { id: adapter.equipmentId, deletedAt: null },
        select: { code: true },
      }),
    ]);

    const mappedTestIds = new Set(testRows.map((t) => t.branchLabTestId));
    const preferedTest: Record<string, string> = {};
    if (mappedTestIds.size > 0) {
      const tests = await tx.branchLabTest.findMany({
        where: {
          id: { in: [...mappedTestIds] },
          tenantId: adapter.tenantId,
          deletedAt: null,
        },
        select: { id: true, testName: true },
      });
      for (const t of tests) {
        preferedTest[t.id] = t.testName;
      }
    }

    return {
      branchIds: branchRows.map((b) => b.branchId),
      mappedTestIds,
      preferedTest,
      equipmentCode: equipment?.code ?? null,
    };
  }

  /** Find an order by `orderCode`, tenant-scoped and within the adapter's branches. */
  private async findOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderCode: string,
    ctx: AdapterContext,
  ): Promise<EmiOrder | null> {
    const where: Prisma.OrderWhereInput = {
      orderCode,
      tenantId,
      deletedAt: null,
    };
    if (ctx.branchIds.length > 0) {
      // Include tenant-level (null-branch) orders too, but restrict located
      // orders to the adapter's branches.
      where.OR = [{ branchId: { in: ctx.branchIds } }, { branchId: null }];
    }
    return tx.order.findFirst({ where, include: ORDER_INCLUDE });
  }

  /**
   * Resolve the result parameters of a report's test. For a single test this is
   * its `LabTestResultParam`s; for a panel report (no `labTestId`) it expands the
   * panel's member tests (mirrors `LabReportService.getResultParams`).
   */
  private async resolveParams(
    tx: Prisma.TransactionClient,
    labTestId: string | null,
    item: { branchLabPanelId: string | null },
  ): Promise<
    Array<{
      id: string;
      parameterName: string;
      parameterCode: string;
      reportingUnit: string | null;
    }>
  > {
    if (labTestId) {
      return tx.labTestResultParam.findMany({
        where: { labTestId, deletedAt: null },
        select: {
          id: true,
          parameterName: true,
          parameterCode: true,
          reportingUnit: true,
        },
        orderBy: { sortOrder: 'asc' },
      });
    }
    if (!item.branchLabPanelId) {
      return [];
    }
    const panelTests = await tx.branchLabPanelTest.findMany({
      where: { branchLabPanelId: item.branchLabPanelId, deletedAt: null },
      select: { branchLabTestId: true },
      orderBy: { sortOrder: 'asc' },
    });
    const branchLabTestIds = panelTests.map((t) => t.branchLabTestId);
    if (branchLabTestIds.length === 0) {
      return [];
    }
    const memberTests = await tx.branchLabTest.findMany({
      where: { id: { in: branchLabTestIds } },
      select: { sourceLabTestId: true },
    });
    const sourceLabTestIds = memberTests
      .map((t) => t.sourceLabTestId)
      .filter((id): id is string => id != null);
    if (sourceLabTestIds.length === 0) {
      return [];
    }
    return tx.labTestResultParam.findMany({
      where: { labTestId: { in: sourceLabTestIds }, deletedAt: null },
      select: {
        id: true,
        parameterName: true,
        parameterCode: true,
        reportingUnit: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Match submitted analyte values to a report's params. Matches a param by
   * `parameterCode`/`parameterName` against the machine's
   * `universal_test_id`/`test_name`; when the report has a single param and none
   * matched, falls back to a value whose id/name matches the TEST itself
   * (`testCode`/`testName`) — covering single-analyte tests where the machine
   * sends the test name as the universal id (e.g. glucose).
   */
  private matchValues(
    params: Array<{
      id: string;
      parameterName: string;
      parameterCode: string;
      reportingUnit: string | null;
    }>,
    submitted: SubmittedValue[],
    test: { testCode: string; testName: string } | null,
  ): Array<{ resultParamId: string; value: string; unit: string | null }> {
    const out: Array<{
      resultParamId: string;
      value: string;
      unit: string | null;
    }> = [];
    if (params.length === 0) {
      return out;
    }

    for (const param of params) {
      const codeKey = matchKey(param.parameterCode);
      const nameKey = matchKey(param.parameterName);
      const hit = submitted.find(
        (s) =>
          (s.uidKey && (s.uidKey === codeKey || s.uidKey === nameKey)) ||
          (s.nameKey && s.nameKey === nameKey) ||
          (s.displayKey && s.displayKey === nameKey),
      );
      if (hit) {
        out.push({
          resultParamId: param.id,
          value: hit.value,
          unit: hit.unit ?? param.reportingUnit,
        });
      }
    }

    if (out.length === 0 && params.length === 1 && test) {
      const testKeys = new Set([
        matchKey(test.testCode),
        matchKey(test.testName),
      ]);
      const hit = submitted.find(
        (s) =>
          testKeys.has(s.uidKey) ||
          testKeys.has(s.nameKey) ||
          testKeys.has(s.displayKey),
      );
      const only = params[0];
      if (hit && only) {
        out.push({
          resultParamId: only.id,
          value: hit.value,
          unit: hit.unit ?? only.reportingUnit,
        });
      }
    }

    return out;
  }

  /** Normalise the machine's `test_results[]` into comparable values. */
  private normaliseSubmitted(testResults: EmiTestResult[]): SubmittedValue[] {
    const out: SubmittedValue[] = [];
    for (const tr of testResults) {
      const value = tr.test_result ?? tr.original_test_result;
      if (value === undefined || value === null || `${value}` === '') {
        continue;
      }
      out.push({
        uidKey: matchKey(tr.universal_test_id),
        nameKey: matchKey(tr.test_name),
        displayKey: matchKey(tr.display_name),
        value: `${value}`,
        unit: typeof tr.unit === 'string' && tr.unit !== '' ? tr.unit : null,
      });
    }
    return out;
  }

  /** Legacy `getEMIStatus`: complete when at least one result + a tube number. */
  private emiStatusCode(
    body: SubmitResultBody,
    testResults: EmiTestResult[],
  ): string {
    return testResults.length > 0 && !!body.tube_no?.trim() ? '1' : '0';
  }

  /** Map the emi status code to the label the adapter app displays. */
  private emiStatusLabel(code: string): string {
    return code === '1' ? EMI_STATUS.COMPLETE : EMI_STATUS.INCOMPLETE;
  }

  /** Format a timestamp as the legacy `Y-m-d H:i:s` string. */
  private formatDateTime(date: Date): string {
    const pad = (n: number): string => `${n}`.padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }
}
