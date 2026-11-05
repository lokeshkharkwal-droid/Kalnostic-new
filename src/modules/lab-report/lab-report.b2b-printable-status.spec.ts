import { LabReportStatus } from '@prisma/client';
import {
  B2B_PRINTABLE_REPORT_STATUSES,
  LabReportService,
  applyB2bPrintableReportScope,
} from './lab-report.service';
import { tenantContext } from '../../prisma/tenant-context';
import {
  LabReportPrintNotApprovedForPanelException,
  OrderReportsNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * A B2B Referral Panel prints / downloads only finished reports (Approved or
 * Published). Every other session — the lab's own staff — is untouched and can
 * still print unfinished reports as "Result pending".
 */
describe('B2B panel — only Approved / Published reports can be printed', () => {
  const asPanel = <T>(fn: () => Promise<T>) =>
    tenantContext.run({ tenantId: 't1', referralPanelId: 'panel-A' }, fn);
  const asStaff = <T>(fn: () => Promise<T>) =>
    tenantContext.run({ tenantId: 't1' }, fn);

  describe('the printable statuses', () => {
    it('are exactly Approved and Published', () => {
      expect([...B2B_PRINTABLE_REPORT_STATUSES].sort()).toEqual(
        [LabReportStatus.APPROVED, LabReportStatus.PUBLISHED].sort(),
      );
    });
  });

  describe('applyB2bPrintableReportScope (report selection for Print All)', () => {
    it('adds the status filter for a panel session', async () => {
      const where: Record<string, unknown> = { tenantId: 't1' };
      await asPanel(() =>
        Promise.resolve(applyB2bPrintableReportScope(where, 'panel-A')),
      );
      expect(where.AND).toEqual([
        { status: { in: ['APPROVED', 'PUBLISHED'] } },
      ]);
    });

    it('keeps a filter that is already there (array or single)', () => {
      const withArray: Record<string, unknown> = {
        AND: [{ branchId: 'b1' }],
      };
      applyB2bPrintableReportScope(withArray, 'panel-A');
      expect(withArray.AND).toEqual([
        { branchId: 'b1' },
        { status: { in: ['APPROVED', 'PUBLISHED'] } },
      ]);

      const withObject: Record<string, unknown> = { AND: { branchId: 'b1' } };
      applyB2bPrintableReportScope(withObject, 'panel-A');
      expect(withObject.AND).toEqual([
        { branchId: 'b1' },
        { status: { in: ['APPROVED', 'PUBLISHED'] } },
      ]);
    });

    it('does nothing at all for a non-B2B session', () => {
      const where: Record<string, unknown> = { tenantId: 't1' };
      const before = JSON.stringify(where);
      applyB2bPrintableReportScope(where, undefined);
      expect(JSON.stringify(where)).toBe(before);
    });
  });

  describe('single report print — assertReportPrintableForPanel', () => {
    const prisma = { labReport: { findFirst: jest.fn() } };
    const service = Object.create(LabReportService.prototype) as Record<
      string,
      unknown
    >;
    service.prisma = prisma;
    const gate = (reportId: string) =>
      (
        service as unknown as {
          assertReportPrintableForPanel: (
            t: string,
            r: string,
          ) => Promise<void>;
        }
      ).assertReportPrintableForPanel('t1', reportId);

    beforeEach(() => jest.resetAllMocks());

    it.each([LabReportStatus.APPROVED, LabReportStatus.PUBLISHED])(
      'lets the panel print a %s report',
      async (status) => {
        prisma.labReport.findFirst.mockResolvedValue({ status });
        await expect(asPanel(() => gate('r1'))).resolves.toBeUndefined();
      },
    );

    it.each([
      LabReportStatus.PENDING,
      LabReportStatus.PARTIAL_PENDING,
      LabReportStatus.SAVED,
      LabReportStatus.VALIDATION_PENDING,
      LabReportStatus.RESULT_DONE,
      LabReportStatus.ERROR_REPORTED,
      LabReportStatus.RESULT_REJECTED,
    ])('refuses a %s report for the panel', async (status) => {
      prisma.labReport.findFirst.mockResolvedValue({ status });
      await expect(asPanel(() => gate('r1'))).rejects.toBeInstanceOf(
        LabReportPrintNotApprovedForPanelException,
      );
    });

    it('refuses an unknown report the same way', async () => {
      prisma.labReport.findFirst.mockResolvedValue(null);
      await expect(asPanel(() => gate('nope'))).rejects.toBeInstanceOf(
        LabReportPrintNotApprovedForPanelException,
      );
    });

    it('is a complete no-op for lab staff: an unfinished report still prints, no query is made', async () => {
      await expect(asStaff(() => gate('r1'))).resolves.toBeUndefined();
      expect(prisma.labReport.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('Print All — printAllForOrder / buildAllReportsContext', () => {
    const prisma = {
      labReport: {
        findMany: jest.fn<Promise<unknown[]>, [{ where: unknown }]>(),
      },
    };
    const service = Object.create(LabReportService.prototype) as Record<
      string,
      unknown
    >;
    service.prisma = prisma;
    service.requireBranch = (b: string | null) => b;
    service.assertOrderInActivePanel = jest.fn();
    service.assertOrderNotCancelledForPrint = jest.fn();
    service.canPrintWholeOrder = jest.fn().mockResolvedValue(true);
    service.referralCredit = {
      assertReportAccessAllowedByOrderId: jest.fn(),
    };
    service.pdfReportTemplateService = {
      getType: jest.fn().mockResolvedValue('lab_all_report'),
    };
    const printAll = (templateId?: string) =>
      (service as unknown as LabReportService).printAllForOrder(
        'o1',
        't1',
        'b1',
        templateId,
      );

    beforeEach(() => {
      prisma.labReport.findMany.mockReset();
      prisma.labReport.findMany.mockResolvedValue([]);
    });

    it('merge path: a panel only selects finished reports, and refuses clearly when none is', async () => {
      await expect(asPanel(() => printAll())).rejects.toBeInstanceOf(
        LabReportPrintNotApprovedForPanelException,
      );
      const where = prisma.labReport.findMany.mock.calls[0]![0].where;
      expect(JSON.stringify(where)).toContain(
        '"status":{"in":["APPROVED","PUBLISHED"]}',
      );
    });

    it('"Lab All Report" template path: same rule', async () => {
      await expect(asPanel(() => printAll('tpl'))).rejects.toBeInstanceOf(
        LabReportPrintNotApprovedForPanelException,
      );
      const where = prisma.labReport.findMany.mock.calls[0]![0].where;
      expect(JSON.stringify(where)).toContain(
        '"status":{"in":["APPROVED","PUBLISHED"]}',
      );
    });

    it('lab staff: no status filter is added, and an empty order keeps its old "no reports" error', async () => {
      await expect(asStaff(() => printAll())).rejects.toBeInstanceOf(
        OrderReportsNotFoundException,
      );
      const where = prisma.labReport.findMany.mock.calls[0]![0].where;
      expect(JSON.stringify(where)).not.toContain('APPROVED');
    });

    it('lab staff on the template path: unchanged as well', async () => {
      await expect(asStaff(() => printAll('tpl'))).rejects.toBeInstanceOf(
        OrderReportsNotFoundException,
      );
      const where = prisma.labReport.findMany.mock.calls[0]![0].where;
      expect(JSON.stringify(where)).not.toContain('APPROVED');
    });
  });
});
