import { LabReportService } from './lab-report.service';

/**
 * Phase 2: once a report was sent to another branch, THAT branch's Lab Test List entry (`performingEntry`)
 * decides the report template and the department/category that pick the approval signatories. Until then
 * (performingEntry null) the order line's entry applies, exactly as before.
 */
type Svc = {
  getTestReportTemplateId: (
    reportId: string,
    tenantId: string,
  ) => Promise<string | null>;
  resolveReportClassificationIds: (
    id: string,
    tenantId: string,
    branchId: string,
  ) => Promise<{
    departmentId: string | null;
    categoryId: string | null;
    subCategoryId: string | null;
  }>;
};

function service(report: unknown, sourceTemplate: string | null = null): Svc {
  const svc = Object.create(LabReportService.prototype) as { prisma: unknown };
  svc.prisma = {
    labReport: { findFirst: jest.fn().mockResolvedValue(report) },
    labTest: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ reportTemplateId: sourceTemplate }),
    },
  };
  return svc as unknown as Svc;
}

const lineTest = { reportTemplateId: 'tpl-A', sourceLabTestId: 'srcA' };

describe('report template follows the branch that holds the report', () => {
  it("uses the order line's mapping until the report is sent to another branch", async () => {
    const s = service({
      performingEntry: null,
      orderItem: { branchLabTest: lineTest },
    });
    await expect(s.getTestReportTemplateId('r', 't')).resolves.toBe('tpl-A');
  });

  it("uses the holding branch's own mapping once it holds the report", async () => {
    const s = service({
      performingEntry: { reportTemplateId: 'tpl-B', sourceLabTestId: 'srcB' },
      orderItem: { branchLabTest: lineTest },
    });
    await expect(s.getTestReportTemplateId('r', 't')).resolves.toBe('tpl-B');
  });

  it("falls back to the holding branch's source (tenant) mapping when its entry has none - never to A's", async () => {
    const s = service(
      {
        performingEntry: { reportTemplateId: null, sourceLabTestId: 'srcB' },
        orderItem: { branchLabTest: lineTest },
      },
      'tpl-tenant',
    );
    await expect(s.getTestReportTemplateId('r', 't')).resolves.toBe(
      'tpl-tenant',
    );
  });

  it('a panel item keeps its no-per-test-template behaviour', async () => {
    const s = service({
      performingEntry: { reportTemplateId: 'tpl-B', sourceLabTestId: 'srcB' },
      orderItem: { branchLabTest: null },
    });
    await expect(s.getTestReportTemplateId('r', 't')).resolves.toBeNull();
  });
});

describe('approval signatories follow the holding branch department / category', () => {
  const line = {
    branchLabTest: {
      departmentId: 'depA',
      categoryId: 'catA',
      subCategoryId: 'subA',
    },
    branchLabPanel: null,
  };

  it("uses the order line's classification until the report is sent to another branch", async () => {
    const s = service({
      branchId: 'A',
      performingEntry: null,
      orderItem: line,
    });
    await expect(
      s.resolveReportClassificationIds('r', 't', 'A'),
    ).resolves.toMatchObject({
      departmentId: 'depA',
      categoryId: 'catA',
      subCategoryId: 'subA',
    });
  });

  it("uses the holding branch's entry, including an entry with no department (never A's)", async () => {
    const s = service({
      branchId: 'B',
      performingEntry: {
        departmentId: null,
        categoryId: 'catB',
        subCategoryId: null,
      },
      orderItem: line,
    });
    await expect(
      s.resolveReportClassificationIds('r', 't', 'B'),
    ).resolves.toMatchObject({
      departmentId: null,
      categoryId: 'catB',
      subCategoryId: null,
    });
  });
});
