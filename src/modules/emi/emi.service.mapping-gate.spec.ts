import { LabAdapter } from '@prisma/client';
import { EmiService } from './emi.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdapterLogsService } from '../adapter-logs/adapter-logs.service';
import { SubmitResultBody } from './dto/submit-result.dto';
import {
  BRANCH_NOT_LINKED_MESSAGE,
  TEST_NOT_LINKED_MESSAGE,
} from './entities/emi-response.entity';

/**
 * Validation gates for the LIS (EMI) endpoints: before `GET /emi/orders` exposes
 * an order or `POST /emi/submitResult` fills a result, the branch and lab test
 * must be mapped to THE AUTHENTICATING ADAPTER (`LabAdapterBranch` /
 * `LabAdapterTest`). When nothing on the scanned order is authorised, the request
 * is rejected up-front with a clear error (HTTP `400`) and — critically — NO
 * records are created, modified, or updated (not even the `AdapterResult` audit
 * row). A request with ≥1 valid mapping is preserved: it proceeds and the per-test
 * loop still skips the unmapped remainder (partial order).
 *
 * The decisive rule is the one in the spec: validation is based on the mappings
 * configured for the specific adapter and the branch currently processing the
 * test, not on the order's originating branch.
 */
describe('EmiService — branch + lab-test mapping gates', () => {
  const BR = 'br1'; // the branch the order is processed at
  const BR_OTHER = 'br-x'; // a branch the adapter is NOT linked to

  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
  } as unknown as LabAdapter;

  interface Test {
    blt: string;
    src: string;
    name: string;
    code: string;
  }
  const GLU: Test = {
    blt: 'blt-glu',
    src: 'lt-glu',
    name: 'Glucose',
    code: 'GLU',
  };
  const CHOL: Test = {
    blt: 'blt-chol',
    src: 'lt-chol',
    name: 'Cholesterol',
    code: 'CHOL',
  };
  const OTHER: Test = {
    blt: 'blt-other',
    src: 'lt-other',
    name: 'Other',
    code: 'OTH',
  };

  interface Opts {
    /** Branches the adapter is linked to (`LabAdapterBranch`). */
    adapterBranchIds: string[];
    /** The adapter's mapped `BranchLabTest`s (`LabAdapterTest`). */
    mapped: Test[];
    /** Tests present on the order (each an item + its PENDING report at `BR`). */
    orderTests: Test[];
  }

  const buildOrderItem = (t: Test, i: number) => ({
    id: `oi${i}`,
    branchLabTestId: t.blt,
    branchLabPanelId: null,
    branchLabTest: {
      id: t.blt,
      testName: t.name,
      testCode: t.code,
      sourceLabTestId: t.src,
    },
    branchLabPanel: null,
    labReports: [
      {
        id: `rep${i}`,
        status: 'PENDING',
        isLocked: false,
        branchId: BR, // processed at BR
        labTestId: t.src,
        memberBranchLabTestId: null,
      },
    ],
  });

  const buildTx = (o: Opts) => ({
    labAdapterBranch: {
      findMany: jest
        .fn()
        .mockResolvedValue(o.adapterBranchIds.map((id) => ({ branchId: id }))),
    },
    labAdapterTest: {
      findMany: jest
        .fn()
        .mockResolvedValue(o.mapped.map((m) => ({ branchLabTestId: m.blt }))),
    },
    equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue(
        o.mapped.map((m) => ({
          id: m.blt,
          testName: m.name,
          testCode: m.code,
          sourceLabTestId: m.src,
        })),
      ),
    },
    orderSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          orderId: 'ord1',
          branchId: BR,
          status: 'ACCEPTED',
          tests: o.orderTests.map((t, i) => ({
            orderItemId: `oi${i}`,
            labTestId: t.src,
          })),
        },
      ]),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'ord1',
        orderCode: 'ORD-1',
        branchId: BR,
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
        items: o.orderTests.map((t, i) => buildOrderItem(t, i)),
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
    // No shared Tenant-MD provenance in these fixtures — identity is by
    // BranchLabTest id / source id, which is enough for same-branch mapping.
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

  const BARCODE = '10001';
  const SUBMIT_BODY: SubmitResultBody = {
    tube_no: BARCODE,
    test_results: [{ universal_test_id: 'GLU', test_result: '95' }],
  };

  describe('valid request — branch linked AND lab test mapped', () => {
    const opts: Opts = {
      adapterBranchIds: [BR],
      mapped: [GLU],
      orderTests: [GLU],
    };

    it('getOrders exposes the test', async () => {
      const res = await makeService(buildTx(opts)).getOrders(
        adapter,
        BARCODE,
        null,
      );
      expect(res.s).toBe('200');
      expect(res.orders?.[0]?.ut_ids).toEqual(['Glucose']);
    });

    it('submitResult fills the report and writes the audit row', async () => {
      const tx = buildTx(opts);
      const res = await makeService(tx).submitResult(
        adapter,
        SUBMIT_BODY,
        null,
      );
      expect(res.s).toBe('200');
      expect(res.test_status).toBe('1 test updated');
      expect(tx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
      expect(tx.labReport.update).toHaveBeenCalledTimes(1);
      expect(tx.adapterResult.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('lab test NOT mapped — branch linked, test missing from adapter', () => {
    // Adapter is linked to BR and maps a DIFFERENT test, so the order's Glucose
    // is unmapped.
    const opts: Opts = {
      adapterBranchIds: [BR],
      mapped: [OTHER],
      orderTests: [GLU],
    };

    it('getOrders is rejected with a lab-test error and exposes no order', async () => {
      const res = await makeService(buildTx(opts)).getOrders(
        adapter,
        BARCODE,
        null,
      );
      expect(res.s).toBe('400');
      expect(res.m).toBe(TEST_NOT_LINKED_MESSAGE);
      expect(res.orders).toBeUndefined();
    });

    it('submitResult is rejected and writes NO records', async () => {
      const tx = buildTx(opts);
      const res = await makeService(tx).submitResult(
        adapter,
        SUBMIT_BODY,
        null,
      );
      expect(res.s).toBe('400');
      expect(res.m).toBe(TEST_NOT_LINKED_MESSAGE);
      expect(tx.adapterResult.create).not.toHaveBeenCalled();
      expect(tx.labReportResultValue.upsert).not.toHaveBeenCalled();
      expect(tx.labReport.update).not.toHaveBeenCalled();
    });
  });

  describe('branch NOT linked — adapter linked to another branch only', () => {
    // The adapter maps the exact test, but is linked to a DIFFERENT branch than
    // the one processing it, so the request must be rejected (a mapping for
    // another branch must not authorise this one).
    const opts: Opts = {
      adapterBranchIds: [BR_OTHER],
      mapped: [GLU],
      orderTests: [GLU],
    };

    it('getOrders is rejected with a branch error and exposes no order', async () => {
      const res = await makeService(buildTx(opts)).getOrders(
        adapter,
        BARCODE,
        null,
      );
      expect(res.s).toBe('400');
      expect(res.m).toBe(BRANCH_NOT_LINKED_MESSAGE);
      expect(res.orders).toBeUndefined();
    });

    it('submitResult is rejected and writes NO records', async () => {
      const tx = buildTx(opts);
      const res = await makeService(tx).submitResult(
        adapter,
        SUBMIT_BODY,
        null,
      );
      expect(res.s).toBe('400');
      expect(res.m).toBe(BRANCH_NOT_LINKED_MESSAGE);
      expect(tx.adapterResult.create).not.toHaveBeenCalled();
      expect(tx.labReportResultValue.upsert).not.toHaveBeenCalled();
      expect(tx.labReport.update).not.toHaveBeenCalled();
    });
  });

  describe('partial order — one mapped test + one unmapped test', () => {
    // Both tests are processed at the linked branch, but only Glucose is mapped.
    // The request is authorised (≥1 valid mapping) and proceeds; the unmapped
    // Cholesterol is silently skipped by the per-test loop.
    const opts: Opts = {
      adapterBranchIds: [BR],
      mapped: [GLU],
      orderTests: [GLU, CHOL],
    };

    it('getOrders exposes only the mapped test', async () => {
      const res = await makeService(buildTx(opts)).getOrders(
        adapter,
        BARCODE,
        null,
      );
      expect(res.s).toBe('200');
      expect(res.orders?.[0]?.ut_ids).toEqual(['Glucose']);
    });

    it('submitResult fills only the mapped test', async () => {
      const tx = buildTx(opts);
      const res = await makeService(tx).submitResult(
        adapter,
        SUBMIT_BODY,
        null,
      );
      expect(res.s).toBe('200');
      expect(res.test_status).toBe('1 test updated');
      expect(tx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
      expect(tx.labReport.update).toHaveBeenCalledTimes(1);
    });
  });
});
