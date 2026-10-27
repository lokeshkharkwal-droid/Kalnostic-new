import { LabAdapter } from '@prisma/client';
import { EmiService } from './emi.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdapterLogsService } from '../adapter-logs/adapter-logs.service';
import { SubmitResultBody } from './dto/submit-result.dto';
import { BRANCH_NOT_LINKED_MESSAGE } from './entities/emi-response.entity';

/**
 * Branch-based Lab Adapter mapping (business-admin › Lab Adapter) for the three
 * scenarios in the spec. The decisive rule is: **LIS access depends on the branch
 * CURRENTLY PROCESSING a test** — `LabReport.branchId`, which an internal transfer
 * rehomes to follow the specimen — not the branch the order was created at.
 *
 * Fixture: one standalone test "Glucose" (tenant source `LabTest` id `lt-glu`).
 * The collection center `cc` has the test as `BranchLabTest` `blt-cc`; Branch A
 * `ba` has the SAME logical test as a DIFFERENT `BranchLabTest` `blt-ba` (both
 * resolve to source `lt-glu`). An order is created at `cc`, so its item carries
 * `blt-cc` / `lt-glu`. After an internal transfer the report's branch is rehomed
 * to `ba`, and the analyzer scans the ACCEPTED sample being worked on at `ba`;
 * `reportBranchId` drives both in the fixture.
 *
 * The three cases assert that `GET /emi/orders` (test list) and
 * `POST /emi/submitResult` (fill) succeed iff the adapter is linked to the branch
 * processing the test — and are otherwise REJECTED up-front with a clear branch
 * error (no records written) — while the same logical test is still matched across
 * branches even though the order references the collection center's `BranchLabTest`.
 */
describe('EmiService — branch-based adapter mapping', () => {
  const CC = 'cc';
  const BA = 'ba';

  type MappedTest = {
    branchLabTestId: string;
    sourceLabTestId: string | null;
    testName: string;
    testCode: string;
  };
  const CC_TEST: MappedTest = {
    branchLabTestId: 'blt-cc',
    sourceLabTestId: 'lt-glu',
    testName: 'Glucose',
    testCode: 'GLU',
  };
  const BA_TEST: MappedTest = {
    branchLabTestId: 'blt-ba',
    sourceLabTestId: 'lt-glu',
    testName: 'Glucose',
    testCode: 'GLU',
  };

  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
  } as unknown as LabAdapter;

  interface ScenarioOpts {
    /** Branches the adapter is linked to (`LabAdapterBranch`). */
    adapterBranchIds: string[];
    /** The adapter's mapped `BranchLabTest`s (`LabAdapterTest` → auto-map per branch). */
    mapped: MappedTest[];
    /**
     * The branch currently processing the report (`LabReport.branchId`) — the
     * origin before a transfer, the destination after one. The analyzer scans the
     * barcode of the sample being worked on at THIS branch (ACCEPTED there), so the
     * scanned sample is modelled at this branch; the branch gate keys on it.
     */
    reportBranchId: string;
  }

  const buildTx = (o: ScenarioOpts) => ({
    labAdapterBranch: {
      findMany: jest
        .fn()
        .mockResolvedValue(o.adapterBranchIds.map((id) => ({ branchId: id }))),
    },
    labAdapterTest: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          o.mapped.map((m) => ({ branchLabTestId: m.branchLabTestId })),
        ),
    },
    equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue(
        o.mapped.map((m) => ({
          id: m.branchLabTestId,
          testName: m.testName,
          testCode: m.testCode,
          sourceLabTestId: m.sourceLabTestId,
        })),
      ),
    },
    // The scanned barcode is on the ACCEPTED sample currently being processed at
    // `reportBranchId` (the origin sample before a transfer, or the receiver's
    // clone after one). The branch gate keys on the report's branch, not this.
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderId: 'ord1',
          branchId: o.reportBranchId,
          status: 'ACCEPTED',
          tests: [{ orderItemId: 'oi1', labTestId: 'lt-glu' }],
        },
      ]),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ord1',
        orderCode: 'ORD-1',
        branchId: o.reportBranchId,
        status: 'ORDER',
        orderDate: new Date('2026-01-01T00:00:00Z'),
        patient: {
          id: 'p1',
          umId: 'UM1',
          firstName: 'Jane',
          lastName: 'Roe',
          gender: 'FEMALE',
          dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        },
        referredByDoctor: null,
        // Order created at the collection center → item/report carry `blt-cc`.
        items: [
          {
            id: 'oi1',
            branchLabTestId: 'blt-cc',
            branchLabPanelId: null,
            branchLabTest: {
              id: 'blt-cc',
              testName: 'Glucose',
              testCode: 'GLU',
              sourceLabTestId: 'lt-glu',
            },
            branchLabPanel: null,
            labReports: [
              {
                id: 'rep1',
                status: 'PENDING',
                isLocked: false,
                branchId: o.reportBranchId,
                labTestId: 'lt-glu',
                memberBranchLabTestId: null,
              },
            ],
          },
        ],
      }),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Lab' }) },
    labTestResultParam: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'prm-glu',
          parameterName: 'Glucose',
          parameterCode: 'GLU',
          reportingUnit: 'mg/dL',
        },
      ]),
    },
    branchLabPanelTest: { findMany: jest.fn().mockResolvedValue([]) },
    labTest: { findMany: jest.fn().mockResolvedValue([]) },
    // Not sent out (no pending internal transfer) → the fill path proceeds.
    orderSampleTest: { findFirst: jest.fn().mockResolvedValue(null) },
    adapterResult: { create: jest.fn().mockResolvedValue({}) },
    labReportResultValue: { upsert: jest.fn().mockResolvedValue({}) },
    labReport: { update: jest.fn().mockResolvedValue({}) },
  });

  const makeService = (tx: ReturnType<typeof buildTx>) => {
    const prisma = {
      withTenant: jest.fn((_tid: string, cb: (t: unknown) => unknown) =>
        cb(tx),
      ),
    } as unknown as PrismaService;
    return new EmiService(
      prisma,
      {} as unknown as UploadsService,
      { record: jest.fn() } as unknown as AdapterLogsService,
    );
  };

  const SUBMIT_BODY: SubmitResultBody = {
    tube_no: '10001',
    test_results: [{ universal_test_id: 'GLU', test_result: '95' }],
  };

  /** Assert that the LIS flow is OPEN for this scenario (orders + fill work). */
  const expectLisWorks = async (o: ScenarioOpts) => {
    const ordersTx = buildTx(o);
    const orders = await makeService(ordersTx).getOrders(
      adapter,
      '10001',
      null,
    );
    expect(orders.s).toBe('200');
    expect(orders.orders?.[0]?.ut_ids).toEqual(['Glucose']);

    const submitTx = buildTx(o);
    const submit = await makeService(submitTx).submitResult(
      adapter,
      SUBMIT_BODY,
      null,
    );
    expect(submit.test_status).toBe('1 test updated');
    expect(submitTx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    expect(submitTx.labReport.update).toHaveBeenCalledTimes(1);
  };

  /**
   * Assert the LIS flow is BLOCKED by the branch mapping gate: both endpoints
   * REJECT up-front with a clear branch error (HTTP `400`), and `submitResult`
   * writes NO records at all — not even the `AdapterResult` audit row — because
   * the processing branch isn't registered with the adapter.
   */
  const expectLisBlocked = async (o: ScenarioOpts) => {
    const ordersTx = buildTx(o);
    const orders = await makeService(ordersTx).getOrders(
      adapter,
      '10001',
      null,
    );
    // No order row is exposed — the request is rejected with a clear reason.
    expect(orders.s).toBe('400');
    expect(orders.m).toBe(BRANCH_NOT_LINKED_MESSAGE);
    expect(orders.orders).toBeUndefined();

    const submitTx = buildTx(o);
    const submit = await makeService(submitTx).submitResult(
      adapter,
      SUBMIT_BODY,
      null,
    );
    expect(submit.s).toBe('400');
    expect(submit.m).toBe(BRANCH_NOT_LINKED_MESSAGE);
    // Nothing is created, modified, or updated on a validation failure.
    expect(submitTx.adapterResult.create).not.toHaveBeenCalled();
    expect(submitTx.labReportResultValue.upsert).not.toHaveBeenCalled();
    expect(submitTx.labReport.update).not.toHaveBeenCalled();
  };

  describe('Case 1 — collection center linked, Branch A NOT linked', () => {
    const base = { adapterBranchIds: [CC], mapped: [CC_TEST] };

    it('works at the collection center (before transfer)', async () => {
      await expectLisWorks({
        ...base,
        reportBranchId: CC,
      });
    });

    it('is blocked once the test is processed at Branch A (after transfer)', async () => {
      await expectLisBlocked({
        ...base,
        reportBranchId: BA,
      });
    });
  });

  describe('Case 2 — collection center NOT linked, Branch A linked', () => {
    const base = { adapterBranchIds: [BA], mapped: [BA_TEST] };

    it('is blocked at the collection center (order created there, not linked)', async () => {
      await expectLisBlocked({
        ...base,
        reportBranchId: CC,
      });
    });

    it('works at Branch A after an internal transfer (cross-branch test identity)', async () => {
      // The order carries the collection center's `blt-cc`, but the adapter is
      // mapped on Branch A's `blt-ba`; they match via the shared source `lt-glu`.
      await expectLisWorks({
        ...base,
        reportBranchId: BA,
      });
    });
  });

  describe('Case 3 — both collection center and Branch A linked', () => {
    const base = { adapterBranchIds: [CC, BA], mapped: [CC_TEST, BA_TEST] };

    it('works at the collection center (before transfer)', async () => {
      await expectLisWorks({
        ...base,
        reportBranchId: CC,
      });
    });

    it('works at Branch A after an internal transfer', async () => {
      await expectLisWorks({
        ...base,
        reportBranchId: BA,
      });
    });
  });
});
