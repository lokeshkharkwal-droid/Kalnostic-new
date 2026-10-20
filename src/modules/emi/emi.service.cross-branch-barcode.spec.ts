import { LabAdapter } from '@prisma/client';
import { EmiService } from './emi.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdapterLogsService } from '../adapter-logs/adapter-logs.service';
import { SubmitResultBody } from './dto/submit-result.dto';

/**
 * Regression for the "create at Branch A → transfer to Branch B → accept + assign a
 * NEW barcode at Branch B → scan the clone's own barcode" workflow.
 *
 * After an internal transfer accept, RULE 1 clones the sample into Branch B and
 * rehomes the report's branch to Branch B. The technician then assigns a fresh
 * barcode to the Branch B clone and the analyzer scans THAT barcode. This exercises
 * a different `findOrderByBarcode` row than the origin-barcode path: the scanned
 * sample is the clone (branchId = Branch B, status ACCEPTED), its order is the
 * original order (created at Branch A), and the report now lives at Branch B.
 *
 * The order item still carries BRANCH A's `BranchLabTest` id + Branch-A Master Data
 * `sourceLabTestId` (`srcA`), while the adapter at Branch B is mapped on Branch B's
 * `BranchLabTest` (`blt-B` / `srcB`). These never match by id, and - crucially here -
 * the two branches' test NAMES/CODES are DIFFERENT. The only thing that identifies
 * them as the same logical test cross-branch is the shared Tenant Master Data
 * provenance (`sourceMasterLabTestId = 'TMD'`), which both per-branch MD copies carry.
 *
 * Fixtures model exactly that, so these tests prove the fill lands on the Branch B
 * report (and is blocked for a Branch-A-only adapter), matched purely by provenance.
 */
describe('EmiService — cross-branch clone barcode (Tenant-MD provenance match)', () => {
  const BR_A = 'br-a'; // origin branch (order created here)
  const BR_B = 'br-b'; // processing branch (specimen transferred here)

  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
  } as unknown as LabAdapter;

  interface Opts {
    /** Branches the adapter is linked to. */
    adapterBranchIds: string[];
    /** The adapter's mapped BranchLabTest (Branch B's row, with a DIFFERENT name). */
    mapped: {
      branchLabTestId: string;
      sourceLabTestId: string;
      testName: string;
      testCode: string;
    };
  }

  // The order item (created at Branch A) and its report (rehomed to Branch B).
  const ORDER_ITEM = {
    id: 'oi1',
    branchLabTestId: 'blt-A',
    branchLabPanelId: null,
    branchLabTest: {
      id: 'blt-A',
      testName: 'Glucose (Branch A label)',
      testCode: 'GLU-A',
      sourceLabTestId: 'srcA',
    },
    branchLabPanel: null,
    labReports: [
      {
        id: 'repB',
        status: 'PENDING',
        isLocked: false,
        branchId: BR_B, // rehomed to Branch B by the transfer accept
        labTestId: 'srcA', // Branch A Master Data test id
        memberBranchLabTestId: null,
      },
    ],
  };

  const buildTx = (o: Opts) => ({
    labAdapterBranch: {
      findMany: jest
        .fn()
        .mockResolvedValue(o.adapterBranchIds.map((id) => ({ branchId: id }))),
    },
    labAdapterTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ branchLabTestId: o.mapped.branchLabTestId }]),
    },
    equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: o.mapped.branchLabTestId,
          testName: o.mapped.testName,
          testCode: o.mapped.testCode,
          sourceLabTestId: o.mapped.sourceLabTestId,
        },
      ]),
    },
    // Both per-branch MD copies (srcA + the mapped srcB) share the Tenant-MD source
    // 'TMD' — the reliable cross-branch identity. Returned for any id query.
    labTest: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'srcA', sourceMasterLabTestId: 'TMD' },
        { id: o.mapped.sourceLabTestId, sourceMasterLabTestId: 'TMD' },
      ]),
    },
    // The scanned barcode is the CLONE's own barcode → the clone sample at Branch B.
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderId: 'ord1',
          branchId: BR_B,
          status: 'ACCEPTED',
          tests: [{ orderItemId: 'oi1', labTestId: 'srcA' }],
        },
      ]),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ord1',
        orderCode: 'ORD-A-1',
        branchId: BR_A, // order was CREATED at Branch A
        status: 'ORDER',
        orderDate: new Date('2026-01-01T00:00:00Z'),
        patient: {
          id: 'p1',
          umId: 'UM1',
          firstName: 'Ravi',
          lastName: 'Kumar',
          gender: 'MALE',
          dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        },
        referredByDoctor: null,
        items: [ORDER_ITEM],
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

  const CLONE_BARCODE = 'BR-B-20001';
  const submitBody: SubmitResultBody = {
    tube_no: CLONE_BARCODE,
    test_results: [{ universal_test_id: 'GLU', test_result: '101' }],
  };

  // Adapter linked to Branch B, mapped on Branch B's test (DIFFERENT name/code).
  const BRANCH_B_ADAPTER: Opts = {
    adapterBranchIds: [BR_B],
    mapped: {
      branchLabTestId: 'blt-B',
      sourceLabTestId: 'srcB',
      testName: 'Glucose (Branch B label)',
      testCode: 'GLU-B',
    },
  };

  // Adapter linked to Branch A only, mapped on Branch A's own test.
  const BRANCH_A_ADAPTER: Opts = {
    adapterBranchIds: [BR_A],
    mapped: {
      branchLabTestId: 'blt-A',
      sourceLabTestId: 'srcA',
      testName: 'Glucose (Branch A label)',
      testCode: 'GLU-A',
    },
  };

  it('getOrders at Branch B exposes the test (matched by shared Tenant-MD provenance, names differ)', async () => {
    const tx = buildTx(BRANCH_B_ADAPTER);
    const res = await makeService(tx).getOrders(adapter, CLONE_BARCODE, null);

    expect(res.s).toBe('200');
    expect(res.orders?.[0]?.specimen_id).toBe(CLONE_BARCODE);
    // The test is visible even though blt/src ids AND names differ across branches.
    expect(res.orders?.[0]?.ut_ids).toContain('Glucose');
  });

  it('submitResult fills the Branch B report (correct test, provenance match)', async () => {
    const tx = buildTx(BRANCH_B_ADAPTER);
    const res = await makeService(tx).submitResult(adapter, submitBody, null);

    expect(res.s).toBe('200');
    expect(res.test_status).toBe('1 test updated');
    expect(res.report_log?.log[0]?.fill_status).toBe('Report filled');

    // Value written against EXACTLY the Branch B report, once.
    expect(tx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    const upsertCalls = tx.labReportResultValue.upsert.mock
      .calls as unknown as Array<
      [{ where: { labReportId_resultParamId: { labReportId: string } } }]
    >;
    expect(
      upsertCalls[0]?.[0].where.labReportId_resultParamId.labReportId,
    ).toBe('repB');

    expect(tx.labReport.update).toHaveBeenCalledTimes(1);
    const updateCalls = tx.labReport.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { status: string } }]
    >;
    expect(updateCalls[0]?.[0].where.id).toBe('repB');
    expect(updateCalls[0]?.[0].data.status).toBe('SAVED');
  });

  it('ISOLATION: a Branch-A-only adapter cannot fill the test now processed at Branch B', async () => {
    const tx = buildTx(BRANCH_A_ADAPTER);
    const res = await makeService(tx).submitResult(adapter, submitBody, null);

    expect(res.s).toBe('200');
    expect(res.test_status).toBe('no test match found for requested token');
    expect(res.report_log?.log[0]?.fill_status).toMatch(
      /not processed at a branch linked to this adapter/,
    );
    // Nothing written to the report — the Branch-A adapter is blocked by the branch
    // gate even though it "knows" this test (same srcA), because processing moved to
    // Branch B.
    expect(tx.labReportResultValue.upsert).not.toHaveBeenCalled();
    expect(tx.labReport.update).not.toHaveBeenCalled();
  });

  it('ISOLATION: getOrders for a Branch-A-only adapter returns an empty test list', async () => {
    const tx = buildTx(BRANCH_A_ADAPTER);
    const res = await makeService(tx).getOrders(adapter, CLONE_BARCODE, null);

    expect(res.s).toBe('200');
    expect(res.orders?.[0]?.ut_ids).toEqual([]);
  });
});
