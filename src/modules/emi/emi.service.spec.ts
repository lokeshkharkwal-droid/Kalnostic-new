import { LabAdapter } from '@prisma/client';
import { EmiService } from './emi.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdapterLogsService } from '../adapter-logs/adapter-logs.service';
import { SubmitResultBody } from './dto/submit-result.dto';

/**
 * Regression coverage for the panel-barcode path of the EMI (lab-analyzer)
 * endpoints. A lab **panel** is stored as one `OrderItem` with
 * `branchLabPanelId` set and `branchLabTestId = NULL`; its member tests live one
 * level down as `LabReport.memberBranchLabTestId` (each a `BranchLabTest.id`, the
 * key the adapter is mapped on). Before the fix, both endpoints gated a test on
 * `OrderItem.branchLabTestId` — NULL for a panel — so a scanned panel-member
 * barcode produced empty `ut_ids` (orders) and filled nothing (submitResult).
 */
describe('EmiService — panel-member barcode', () => {
  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
    isActive: true,
  } as unknown as LabAdapter;

  /** A minimal Prisma transaction client whose methods the EMI service calls. */
  const makeTx = () => ({
    labAdapterBranch: {
      findMany: jest.fn().mockResolvedValue([{ branchId: 'br1' }]),
    },
    // Adapter is mapped on the panel MEMBER test's BranchLabTest id.
    labAdapterTest: {
      findMany: jest.fn().mockResolvedValue([{ branchLabTestId: 'blt-hb' }]),
    },
    equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
    branchLabTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'blt-hb', testName: 'Hemoglobin Test' }]),
    },
    // The scanned barcode carries the panel item's member test (labTestId = the
    // member's sourceLabTestId, as accession records it on OrderSampleTest).
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderId: 'ord1',
          tests: [{ orderItemId: 'oi1', labTestId: 'lt-hb' }],
        },
      ]),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ord1',
        orderCode: 'ORD-1',
        branchId: 'br1',
        status: 'REGISTERED',
        orderDate: new Date('2026-01-01T00:00:00Z'),
        patient: {
          id: 'p1',
          umId: 'UM1',
          firstName: 'John',
          lastName: 'Doe',
          gender: 'MALE',
          dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        },
        referredByDoctor: null,
        items: [
          {
            id: 'oi1',
            branchLabTestId: null,
            branchLabPanelId: 'blp1',
            branchLabTest: null,
            branchLabPanel: { id: 'blp1', panelName: 'CBC' },
            labReports: [
              {
                id: 'rep1',
                status: 'PENDING',
                isLocked: false,
                labTestId: 'lt-hb',
                memberBranchLabTestId: 'blt-hb',
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
          id: 'prm-hb',
          parameterName: 'Hemoglobin',
          parameterCode: 'HB',
          reportingUnit: 'g/dL',
        },
      ]),
    },
    branchLabPanelTest: { findMany: jest.fn().mockResolvedValue([]) },
    adapterResult: { create: jest.fn().mockResolvedValue({}) },
    labReportResultValue: { upsert: jest.fn().mockResolvedValue({}) },
    labReport: { update: jest.fn().mockResolvedValue({}) },
  });

  const makeService = (tx: ReturnType<typeof makeTx>) => {
    const prisma = {
      withTenant: jest.fn((_tid: string, cb: (t: unknown) => unknown) =>
        cb(tx),
      ),
    } as unknown as PrismaService;
    const uploads = {} as unknown as UploadsService;
    const adapterLogs = { record: jest.fn() } as unknown as AdapterLogsService;
    return new EmiService(prisma, uploads, adapterLogs);
  };

  it('getOrders returns the panel member test name + its params as ut_ids', async () => {
    const tx = makeTx();
    const service = makeService(tx);

    const res = await service.getOrders(adapter, '10001', null);

    expect(res.s).toBe('200');
    expect(res.orders).toHaveLength(1);
    expect(res.orders?.[0]?.ut_ids).toEqual(['Hemoglobin Test', 'Hemoglobin']);
  });

  it('submitResult fills the panel member report', async () => {
    const tx = makeTx();
    const service = makeService(tx);

    const body: SubmitResultBody = {
      tube_no: '10001',
      test_results: [{ universal_test_id: 'HB', test_result: '13.5' }],
    };

    const res = await service.submitResult(adapter, body, null);

    expect(res.test_status).toBe('1 test updated');
    expect(tx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    // Cast `.mock.calls` to a typed shape (project pattern — see
    // accession-sample.service.spec.ts) so the assertion stays no-unsafe-any.
    const updateCalls = tx.labReport.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { status: string } }]
    >;
    expect(updateCalls[0]?.[0].where).toEqual({ id: 'rep1' });
    expect(updateCalls[0]?.[0].data.status).toBe('SAVED');
  });
});

/**
 * Regression guard: the standalone-test path (an `OrderItem` with
 * `branchLabTestId` set and a single `memberBranchLabTestId: null` report) must
 * keep working exactly as before the panel fix.
 */
describe('EmiService — standalone-test barcode', () => {
  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
    isActive: true,
  } as unknown as LabAdapter;

  const makeTx = () => ({
    labAdapterBranch: {
      findMany: jest.fn().mockResolvedValue([{ branchId: 'br1' }]),
    },
    labAdapterTest: {
      findMany: jest.fn().mockResolvedValue([{ branchLabTestId: 'blt-glu' }]),
    },
    equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
    branchLabTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'blt-glu', testName: 'Glucose' }]),
    },
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderId: 'ord1',
          tests: [{ orderItemId: 'oi1', labTestId: 'lt-glu' }],
        },
      ]),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ord1',
        orderCode: 'ORD-1',
        branchId: 'br1',
        status: 'REGISTERED',
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
        items: [
          {
            id: 'oi1',
            branchLabTestId: 'blt-glu',
            branchLabPanelId: null,
            branchLabTest: {
              id: 'blt-glu',
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
    adapterResult: { create: jest.fn().mockResolvedValue({}) },
    labReportResultValue: { upsert: jest.fn().mockResolvedValue({}) },
    labReport: { update: jest.fn().mockResolvedValue({}) },
  });

  const makeService = (tx: ReturnType<typeof makeTx>) => {
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

  it('getOrders still returns the standalone test + params as ut_ids', async () => {
    const tx = makeTx();
    const res = await makeService(tx).getOrders(adapter, '10001', null);
    expect(res.orders?.[0]?.ut_ids).toEqual(['Glucose']);
  });

  it('submitResult still fills the standalone report', async () => {
    const tx = makeTx();
    const body: SubmitResultBody = {
      tube_no: '10001',
      test_results: [{ universal_test_id: 'GLU', test_result: '95' }],
    };
    const res = await makeService(tx).submitResult(adapter, body, null);
    expect(res.test_status).toBe('1 test updated');
    expect(tx.labReport.update).toHaveBeenCalledTimes(1);
  });
});
