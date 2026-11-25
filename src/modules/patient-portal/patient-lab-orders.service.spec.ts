import { LabReportStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { ReferralReportCreditLimitException } from '../referral-credit/referral-credit.exceptions';
import { PatientLabOrdersService } from './patient-lab-orders.service';
import { PatientScopeService } from './patient-scope.service';
import {
  PatientLabOrderNotFoundException,
  PatientReportNotAvailableException,
} from './exceptions/patient-portal.exceptions';

/** The first argument of a mock's first call, typed (a bare `mock.calls[0][0]` is `any`). */
function firstCallArg<T>(fn: jest.Mock): T {
  const call = fn.mock.calls[0] as unknown[] | undefined;
  return call?.[0] as T;
}

const TENANT = 'tenant-1';
const PERSON = 'person-1';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';

type Report = {
  id: string;
  status: LabReportStatus;
  memberBranchLabTestId: string | null;
  publishedAt: Date | null;
};

const report = (
  status: LabReportStatus,
  memberBranchLabTestId: string | null = null,
  id = `r-${status}-${memberBranchLabTestId ?? 'x'}`,
): Report => ({
  id,
  status,
  memberBranchLabTestId,
  publishedAt:
    status === LabReportStatus.PUBLISHED
      ? new Date('2026-11-10T12:40:00.000Z')
      : null,
});

const testLine = (name: string, reports: Report[]) => ({
  id: `item-${name}`,
  direct: null,
  selectedMemberBranchLabTestIds: [] as string[],
  branchLabTest: { testName: name, testDisplayName: null },
  branchLabPanel: null,
  labReports: reports,
});

const panelLine = (
  panelId: string,
  name: string,
  reports: Report[],
  selected: string[] = [],
) => ({
  id: `item-${panelId}`,
  direct: null,
  selectedMemberBranchLabTestIds: selected,
  branchLabTest: null,
  branchLabPanel: { id: panelId, panelName: name },
  labReports: reports,
});

type Line = ReturnType<typeof testLine> | ReturnType<typeof panelLine>;

const orderRow = (
  items: Line[],
  over: Partial<{ status: OrderStatus; branchId: string | null }> = {},
) => ({
  id: ORDER_ID,
  orderCode: 'ORD-00001',
  externalOrderId: null as string | null,
  orderDate: new Date('2026-11-11T00:00:00.000Z'),
  orderTime: '10:30',
  status: over.status ?? OrderStatus.ORDER,
  billStatus: 'PARTIALLY_PAID',
  billId: 'DIG-001',
  branchId: over.branchId === undefined ? 'branch-1' : over.branchId,
  patientId: 'patient-1',
  patient: { firstName: 'Shivam', middleName: null, lastName: 'Dubey' },
  branch: { name: 'Testing Sub Branch Path', city: 'Kolkata' },
  referredByDoctor: null,
  items,
});

function build(opts: {
  scopeIds?: string[];
  order?: ReturnType<typeof orderRow> | null;
  orders?: ReturnType<typeof orderRow>[];
  panelLinks?: { branchLabPanelId: string; branchLabTestId: string }[];
  tests?: { id: string; testName: string; testDisplayName: string | null }[];
  reportRow?: { id: string } | null;
}) {
  const prisma = {
    order: {
      count: jest.fn().mockResolvedValue(opts.orders?.length ?? 0),
      findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.order ?? null),
    },
    branchLabPanelTest: {
      findMany: jest.fn().mockResolvedValue(opts.panelLinks ?? []),
    },
    branchLabTest: { findMany: jest.fn().mockResolvedValue(opts.tests ?? []) },
    labReport: {
      findFirst: jest.fn().mockResolvedValue(opts.reportRow ?? null),
    },
    qrCodeScanSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const scope = {
    resolveScopedPatientIds: jest
      .fn()
      .mockResolvedValue(opts.scopeIds ?? ['patient-1']),
  };
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD MMM YYYY',
      timeFormat: 'hh:mm A',
    }),
  };
  const labReport = {
    printAllForOrder: jest.fn().mockResolvedValue(Buffer.from('all')),
    print: jest.fn().mockResolvedValue(Buffer.from('one')),
  };
  const service = new PatientLabOrdersService(
    prisma as unknown as PrismaService,
    scope as unknown as PatientScopeService,
    tenantService as unknown as TenantService,
    labReport as unknown as LabReportService,
  );
  return { service, prisma, scope, labReport };
}

describe('PatientLabOrdersService', () => {
  describe('list', () => {
    it('returns an empty page without querying orders when the patient has no viewable records', async () => {
      const { service, prisma } = build({ scopeIds: [] });
      const res = await service.list(TENANT, PERSON, { page: 1, limit: 5 });
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 5 });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to the tenant, the viewable patients and the lab section', async () => {
      const { service, prisma, scope } = build({
        scopeIds: ['patient-1', 'patient-2'],
      });
      await service.list(TENANT, PERSON, { patientId: 'patient-2' });
      expect(scope.resolveScopedPatientIds).toHaveBeenCalledWith(
        TENANT,
        PERSON,
        'patient-2',
      );
      const { where } = firstCallArg<{ where: unknown }>(prisma.order.findMany);
      expect(where).toMatchObject({
        tenantId: TENANT,
        deletedAt: null,
        patientId: { in: ['patient-1', 'patient-2'] },
        diagnostics: { is: { deletedAt: null } },
        status: { in: [OrderStatus.ORDER, OrderStatus.CANCELLED] },
      });
    });

    it('shows the external order id when there is one, else the order code', async () => {
      const a = orderRow([]);
      const b = { ...orderRow([]), externalOrderId: 'EXT-9' };
      const { service } = build({ orders: [a, b] });
      const res = await service.list(TENANT, PERSON, {});
      expect(res.data.map((o) => o.orderNo)).toEqual(['ORD-00001', 'EXT-9']);
    });

    it('is COMPLETE when every line is approved or published, and offers the download', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
        testLine('TSH', [report(LabReportStatus.APPROVED)]),
      ]);
      const { service } = build({ orders: [row] });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('COMPLETE');
      expect(item?.reportStatus).toBe('PARTIALLY_PUBLISHED');
      expect(item?.canDownloadReports).toBe(true);
    });

    it('is PARTIALLY_COMPLETE when only some lines are finished', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
        testLine('TSH', [report(LabReportStatus.RESULT_DONE)]),
      ]);
      const { service } = build({ orders: [row] });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('PARTIALLY_COMPLETE');
    });

    it('counts a line with no report yet as unfinished (reports exist only after a sample is accepted)', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
        testLine('TSH', []),
      ]);
      const { service } = build({ orders: [row] });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('PARTIALLY_COMPLETE');
      expect(item?.reportStatus).toBe('PARTIALLY_PUBLISHED');
    });

    it('is IN_PROGRESS with an unfinished report and PENDING with none', async () => {
      const inProgress = orderRow([
        testLine('FSH', [report(LabReportStatus.PENDING)]),
      ]);
      const pending = orderRow([testLine('FSH', [])]);
      const { service } = build({ orders: [inProgress, pending] });
      const res = await service.list(TENANT, PERSON, {});
      expect(res.data.map((o) => o.status)).toEqual(['IN_PROGRESS', 'PENDING']);
    });

    it('is CANCELLED for a cancelled order and never offers its download', async () => {
      const row = orderRow(
        [testLine('FSH', [report(LabReportStatus.PUBLISHED)])],
        { status: OrderStatus.CANCELLED },
      );
      const { service } = build({ orders: [row] });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('CANCELLED');
      expect(item?.canDownloadReports).toBe(false);
    });

    it('does not call a panel complete until every member test it runs is finished', async () => {
      const panel = panelLine('panel-1', 'Lipid Profile', [
        report(LabReportStatus.PUBLISHED, 'hdl'),
      ]);
      const { service } = build({
        orders: [orderRow([panel])],
        panelLinks: [
          { branchLabPanelId: 'panel-1', branchLabTestId: 'hdl' },
          { branchLabPanelId: 'panel-1', branchLabTestId: 'ldl' },
        ],
        tests: [
          { id: 'hdl', testName: 'HDL Cholesterol', testDisplayName: null },
          { id: 'ldl', testName: 'LDL Cholesterol', testDisplayName: null },
        ],
      });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('IN_PROGRESS');
      expect(item?.reportStatus).toBe('PARTIALLY_PUBLISHED');
    });

    it('only expects the member tests the order actually selected', async () => {
      const panel = panelLine(
        'panel-1',
        'Lipid Profile',
        [report(LabReportStatus.PUBLISHED, 'hdl')],
        ['hdl'],
      );
      const { service } = build({
        orders: [orderRow([panel])],
        panelLinks: [
          { branchLabPanelId: 'panel-1', branchLabTestId: 'hdl' },
          { branchLabPanelId: 'panel-1', branchLabTestId: 'ldl' },
        ],
        tests: [
          { id: 'hdl', testName: 'HDL Cholesterol', testDisplayName: null },
          { id: 'ldl', testName: 'LDL Cholesterol', testDisplayName: null },
        ],
      });
      const [item] = (await service.list(TENANT, PERSON, {})).data;
      expect(item?.status).toBe('COMPLETE');
      expect(item?.reportStatus).toBe('PUBLISHED');
    });
  });

  describe('getDetail', () => {
    it('is a generic 404 when the order is outside the patient scope', async () => {
      const { service } = build({ order: null });
      await expect(
        service.getDetail(TENANT, PERSON, ORDER_ID),
      ).rejects.toBeInstanceOf(PatientLabOrderNotFoundException);
    });

    it('is a generic 404 and queries nothing when the patient has no viewable records', async () => {
      const { service, prisma } = build({ scopeIds: [] });
      await expect(
        service.getDetail(TENANT, PERSON, ORDER_ID),
      ).rejects.toBeInstanceOf(PatientLabOrderNotFoundException);
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });

    it('hands out a report id only for published reports and never exposes the internal status', async () => {
      const row = orderRow([
        testLine('HDL Cholesterol', [
          report(LabReportStatus.PUBLISHED, null, REPORT_ID),
        ]),
        testLine('LDL Cholesterol', [report(LabReportStatus.APPROVED)]),
      ]);
      const { service } = build({ order: row });
      const detail = await service.getDetail(TENANT, PERSON, ORDER_ID);
      expect(detail.testRows).toEqual([
        {
          reportId: REPORT_ID,
          testName: 'HDL Cholesterol',
          groupName: null,
          isPublished: true,
          publishedAt: '2026-11-10T12:40:00.000Z',
        },
        {
          reportId: null,
          testName: 'LDL Cholesterol',
          groupName: null,
          isPublished: false,
          publishedAt: null,
        },
      ]);
      expect(detail.billNo).toBe('DIG-001');
      expect(detail.referringDoctorName).toBeNull();
      expect(detail.locale.timeZone).toBe('Asia/Kolkata');
    });

    it('expands a panel into its member tests, including ones with no report yet', async () => {
      const panel = panelLine('panel-1', 'Lipid Profile', [
        report(LabReportStatus.PUBLISHED, 'hdl', REPORT_ID),
      ]);
      const { service } = build({
        order: orderRow([panel]),
        panelLinks: [
          { branchLabPanelId: 'panel-1', branchLabTestId: 'hdl' },
          { branchLabPanelId: 'panel-1', branchLabTestId: 'ldl' },
        ],
        tests: [
          { id: 'hdl', testName: 'HDL', testDisplayName: 'HDL Cholesterol' },
          { id: 'ldl', testName: 'LDL', testDisplayName: null },
        ],
      });
      const detail = await service.getDetail(TENANT, PERSON, ORDER_ID);
      expect(
        detail.testRows.map((r) => [r.testName, r.groupName, r.isPublished]),
      ).toEqual([
        ['HDL Cholesterol', 'Lipid Profile', true],
        ['LDL', 'Lipid Profile', false],
      ]);
    });

    it('gives no report ids for a cancelled order', async () => {
      const row = orderRow(
        [testLine('FSH', [report(LabReportStatus.PUBLISHED, null, REPORT_ID)])],
        { status: OrderStatus.CANCELLED },
      );
      const { service } = build({ order: row });
      const detail = await service.getDetail(TENANT, PERSON, ORDER_ID);
      expect(detail.testRows[0]?.reportId).toBeNull();
    });
  });

  describe('getAllReportsPdf', () => {
    it('asks the print pipeline for PUBLISHED reports only', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
      ]);
      const { service, labReport } = build({ order: row });
      const res = await service.getAllReportsPdf(TENANT, PERSON, ORDER_ID);
      expect(res.fileName).toBe('reports-ORD-00001.pdf');
      expect(labReport.printAllForOrder).toHaveBeenCalledWith(
        ORDER_ID,
        TENANT,
        'branch-1',
        undefined,
        undefined,
        undefined,
        true,
      );
    });

    it('refuses with the neutral message when nothing is published, without rendering', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.APPROVED)]),
      ]);
      const { service, labReport } = build({ order: row });
      await expect(
        service.getAllReportsPdf(TENANT, PERSON, ORDER_ID),
      ).rejects.toBeInstanceOf(PatientReportNotAvailableException);
      expect(labReport.printAllForOrder).not.toHaveBeenCalled();
    });

    it('refuses a cancelled order', async () => {
      const row = orderRow(
        [testLine('FSH', [report(LabReportStatus.PUBLISHED)])],
        { status: OrderStatus.CANCELLED },
      );
      const { service, labReport } = build({ order: row });
      await expect(
        service.getAllReportsPdf(TENANT, PERSON, ORDER_ID),
      ).rejects.toBeInstanceOf(PatientReportNotAvailableException);
      expect(labReport.printAllForOrder).not.toHaveBeenCalled();
    });

    it("hides the referrer's credit figures behind the neutral message (decision: the credit rule applies to patients)", async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
      ]);
      const { service, labReport } = build({ order: row });
      labReport.printAllForOrder.mockRejectedValue(
        new ReferralReportCreditLimitException('Dr Sharma', 60000, 50000),
      );
      const err: unknown = await service
        .getAllReportsPdf(TENANT, PERSON, ORDER_ID)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PatientReportNotAvailableException);
      const body = JSON.stringify(
        (err as PatientReportNotAvailableException).getResponse(),
      );
      expect(body).toContain('Report not available. Please contact the lab.');
      expect(body).not.toContain('60000');
      expect(body).not.toContain('50000');
      expect(body).not.toContain('Dr Sharma');
    });

    it('rethrows an unexpected failure untouched', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED)]),
      ]);
      const { service, labReport } = build({ order: row });
      const boom = new Error('boom');
      labReport.printAllForOrder.mockRejectedValue(boom);
      await expect(
        service.getAllReportsPdf(TENANT, PERSON, ORDER_ID),
      ).rejects.toBe(boom);
    });
  });

  describe('getReportPdf', () => {
    it('only prints a PUBLISHED report that sits on this order', async () => {
      const row = orderRow([
        testLine('FSH', [report(LabReportStatus.PUBLISHED, null, REPORT_ID)]),
      ]);
      const { service, prisma, labReport } = build({
        order: row,
        reportRow: { id: REPORT_ID },
      });
      await service.getReportPdf(TENANT, PERSON, ORDER_ID, REPORT_ID);
      expect(
        firstCallArg<{ where: unknown }>(prisma.labReport.findFirst).where,
      ).toMatchObject({
        id: REPORT_ID,
        tenantId: TENANT,
        status: LabReportStatus.PUBLISHED,
        orderItem: { orderId: ORDER_ID, deletedAt: null },
      });
      expect(labReport.print).toHaveBeenCalledWith(
        REPORT_ID,
        TENANT,
        'branch-1',
        undefined,
        'lab_report',
        true,
        false,
      );
    });

    it("refuses a report id that is unpublished or belongs to another patient's order, without rendering", async () => {
      const row = orderRow([testLine('FSH', [])]);
      const { service, labReport } = build({ order: row, reportRow: null });
      await expect(
        service.getReportPdf(TENANT, PERSON, ORDER_ID, REPORT_ID),
      ).rejects.toBeInstanceOf(PatientReportNotAvailableException);
      expect(labReport.print).not.toHaveBeenCalled();
    });

    it('is a generic 404 when the order itself is outside the scope', async () => {
      const { service, labReport } = build({ order: null });
      await expect(
        service.getReportPdf(TENANT, PERSON, ORDER_ID, REPORT_ID),
      ).rejects.toBeInstanceOf(PatientLabOrderNotFoundException);
      expect(labReport.print).not.toHaveBeenCalled();
    });
  });
});
