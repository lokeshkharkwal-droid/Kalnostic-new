import { LabReportStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { LabReportService } from './lab-report.service';
import {
  LabReportNotFoundException,
  OrderReportsNotFoundException,
} from './exceptions/lab-report.exceptions';
import { RESULT_PENDING_TEXT } from './utils/print-visibility.util';

type Ctx = {
  variables: Record<string, string>;
  sections: { results: Array<Record<string, string>> };
};

/** A report as `buildPrintContext` reads it, in the given status, held by `branchId`. */
function reportIn(status: LabReportStatus, branchId = 'A') {
  return {
    id: 'r1',
    status,
    branchId,
    orderItemId: 'item1',
    orderItem: {
      direct: null,
      branchLabTest: { testName: 'Thyroid profile' },
      branchLabPanel: null,
      order: {
        id: 'o1',
        orderCode: 'ORD-1',
        orderDate: new Date('2026-10-01'),
        orderTime: null,
        // the order's creation instant: its printed date/time when no time was typed
        createdAt: new Date('2026-10-01T05:00:00.000Z'),
        externalOrderId: null,
        orderIdBarcode: null,
        orderIdQrCode: null,
        referredByDoctor: null,
        referralPanel: null,
        patient: {
          firstName: 'Rahul',
          middleName: null,
          lastName: 'Kumar',
          salutation: null,
          dateOfBirth: null,
          age: 30,
          ageType: 'YEARS',
          gender: null,
          umId: null,
          mobile: null,
          addressLine1: null,
          photoUrl: null,
        },
      },
    },
    contentSections: {
      usefulFor: 'U-text',
      interpretation: 'I-text',
      limitations: 'L-text',
      remarks: 'R-text',
      references: 'F-text',
    },
    // a real "File +" upload (kind 'file'): without `kind`/`uploadedAt` neither
    // attachment tag would render anything, and the masking checks would be vacuous
    attachments: [
      {
        id: 'att1',
        kind: 'file',
        uploadedAt: new Date('2026-10-01T04:00:00.000Z'),
        fileName: 'x.pdf',
        fileUrl: 'http://f/x.pdf',
      },
    ],
    resultValues: [
      {
        resultParamId: 'p1',
        observed1: '12.5',
        observed2: null,
        unit: 'g/dL',
        methodology: null,
        referenceDisplay: '10-15',
      },
    ],
  };
}

function ctxFor(
  report: ReturnType<typeof reportIn>,
  opts: {
    allBranches?: boolean;
    callerBranch?: string | null;
    maskUnfinished?: boolean;
    /** The report's sample links, as the database returns them (oldest first). */
    sampleLinks?: unknown[];
    onSampleQuery?: (query: unknown) => void;
  } = {},
): Promise<Ctx> {
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    // the cancelled-order print check has its own spec (print-cancelled)
    assertReportOrderNotCancelledForPrint: jest
      .fn()
      .mockResolvedValue(undefined),
    assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
    loadReportDetail: jest.fn().mockResolvedValue(report),
    findById: jest.fn().mockResolvedValue(report),
    resolveStoredSignatories: jest.fn().mockResolvedValue([]),
    resolveApprovingDoctor: jest.fn().mockResolvedValue(null),
    siblingReportIds: jest.fn().mockResolvedValue(['r1']),
    requireBranch: (b: string) => b,
    tenantService: {
      getLocale: jest.fn().mockResolvedValue({
        timezone: 'Asia/Kolkata',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: 'HH:mm',
      }),
    },
    prisma: {
      orderSampleTest: {
        findMany: jest.fn().mockImplementation((query: unknown) => {
          opts.onSampleQuery?.(query);
          return Promise.resolve(opts.sampleLinks ?? []);
        }),
      },
      orderDiagnostics: { findUnique: jest.fn().mockResolvedValue(null) },
      labReport: {
        aggregate: jest.fn().mockResolvedValue({ _max: { approvedAt: null } }),
      },
      labReportNote: { findFirst: jest.fn().mockResolvedValue(null) },
      labTestResultParam: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            parameterName: 'TSH',
            groupName: null,
            sortOrder: 1,
            notes: null,
          },
        ]),
      },
      labReportOverallResult: { findMany: jest.fn().mockResolvedValue([]) },
    },
  });
  return svc.buildPrintContext(
    'r1',
    't1',
    opts.callerBranch === undefined ? 'A' : opts.callerBranch,
    opts.allBranches ?? false,
    { maskUnfinished: opts.maskUnfinished },
  ) as unknown as Promise<Ctx>;
}

describe('printing: unfinished results print as "Result pending"', () => {
  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
  ])(
    'an order-level document shows %s results as one pending line, with no values or findings',
    async (status) => {
      const ctx = await ctxFor(reportIn(status), { maskUnfinished: true });
      expect(ctx.sections.results).toHaveLength(1);
      expect(ctx.sections.results[0]).toMatchObject({
        parameter_name: 'Thyroid profile',
        observed1: RESULT_PENDING_TEXT,
        unit: '',
      });
      expect(JSON.stringify(ctx)).not.toContain('12.5');
      for (const k of [
        'useful_for',
        'interpretation',
        'limitations',
        'remarks',
        'references',
        'test_file_attachment',
        // the same uploads as appended pages: masked exactly like the inline one
        'test_file_attachment_without_header',
      ]) {
        expect(ctx.variables[k]).toBe('');
      }
      expect(ctx.variables.report_status).toBe('PENDING');
    },
  );

  it('a finished report still gets its File+ uploads, inline and as appended pages', async () => {
    const ctx = await ctxFor(reportIn(LabReportStatus.RESULT_DONE), {
      maskUnfinished: true,
    });
    expect(ctx.variables.test_file_attachment).not.toBe('');
    expect(ctx.variables.test_file_attachment_without_header).not.toBe('');
  });

  it('after an internal transfer the print uses the original sample of the sending branch (oldest first), so a transferred test keeps its dates', async () => {
    let query: { where?: Record<string, unknown>; orderBy?: unknown } = {};
    const original = {
      collectedAt: new Date('2026-10-01T04:00:00.000Z'),
      receivedAt: new Date('2026-10-01T05:00:00.000Z'),
      sampleType: 'Serum',
      barcode: 'BC-1',
    };
    // the receiver's copy carries the same barcode but no collection dates
    const copy = { ...original, collectedAt: null, receivedAt: null };
    const ctx = await ctxFor(reportIn(LabReportStatus.RESULT_DONE), {
      sampleLinks: [{ sample: original }, { sample: copy }],
      onSampleQuery: (q) => (query = q as typeof query),
    });
    expect(query.orderBy).toEqual({ sample: { createdAt: 'asc' } });
    expect(query.where).toMatchObject({
      orderItemId: 'item1',
      deletedAt: null,
    });
    expect(ctx.variables.sample_collected_date).not.toBe('');
    expect(ctx.variables.sample_received_date).not.toBe('');
    expect(ctx.variables.sample_type).toBe('Serum');
  });

  it('prints blank sample details when the report has no sample at all', async () => {
    const ctx = await ctxFor(reportIn(LabReportStatus.RESULT_DONE));
    expect(ctx.variables.sample_collected_date).toBe('');
    expect(ctx.variables.sample_type).toBe('');
  });

  it.each([
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])('signed-off results (%s) print in full', async (status) => {
    const ctx = await ctxFor(reportIn(status), { maskUnfinished: true });
    expect(ctx.sections.results[0]).toMatchObject({
      parameter_name: 'TSH',
      observed1: '12.5',
    });
    expect(ctx.variables.useful_for).toBe('U-text');
  });

  it('the holder printing its own draft is unchanged (technicians still print worksheets)', async () => {
    const ctx = await ctxFor(reportIn(LabReportStatus.SAVED), {
      callerBranch: 'A',
    });
    expect(ctx.sections.results[0]).toMatchObject({ observed1: '12.5' });
  });

  it('the order’s branch printing ONE report held elsewhere gets the placeholder, not the draft', async () => {
    const ctx = await ctxFor(reportIn(LabReportStatus.SAVED, 'B'), {
      allBranches: true,
      callerBranch: 'A',
    });
    expect(ctx.sections.results[0]?.observed1).toBe(RESULT_PENDING_TEXT);
  });

  it('...but a report the order’s branch holds itself is not masked on a single print', async () => {
    const ctx = await ctxFor(reportIn(LabReportStatus.SAVED, 'A'), {
      allBranches: true,
      callerBranch: 'A',
    });
    expect(ctx.sections.results[0]).toMatchObject({ observed1: '12.5' });
  });
});

describe('LabReportService.print - single print follows the same order-owner rule as Print All', () => {
  function build(owns: boolean) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    const buildPrintContext = jest.fn().mockResolvedValue({
      variables: {},
      sections: { results: [] },
    });
    Object.assign(svc, {
      // the cancelled-order print check has its own spec (print-cancelled)
      assertReportOrderNotCancelledForPrint: jest
        .fn()
        .mockResolvedValue(undefined),
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      referralCredit: {
        assertReportAccessAllowedByReportId: jest
          .fn()
          .mockResolvedValue(undefined),
      },
      ownsReportsOrder: jest.fn().mockResolvedValue(owns),
      buildPrintContext,
      resolvePrintTemplateId: jest.fn().mockResolvedValue('tpl'),
      getTestReportTemplateId: jest.fn().mockResolvedValue(null),
      buildTestLatteContext: jest.fn().mockReturnValue({}),
      pdfReportTemplateService: {
        generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      },
    });
    return { svc, buildPrintContext };
  }

  it('the order’s branch reads the report across branches', async () => {
    const { svc, buildPrintContext } = build(true);
    await svc.print('r1', 't1', 'A');
    expect(buildPrintContext).toHaveBeenCalledWith('r1', 't1', 'A', true, {
      maskUnfinished: false,
    });
  });

  it('any other branch keeps the branch-scoped read', async () => {
    const { svc, buildPrintContext } = build(false);
    await svc.print('r1', 't1', 'A');
    expect(buildPrintContext).toHaveBeenCalledWith('r1', 't1', 'A', false, {
      maskUnfinished: false,
    });
  });
});

describe('LabReportService.printAllForOrder - skips what it cannot show, masks what is unfinished', () => {
  async function onePage(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage();
    return Buffer.from(await doc.save());
  }

  async function build(rows: Array<{ id: string; branchId: string }>) {
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    const pdf = await onePage();
    const print = jest.fn((id: string) =>
      id === 'hidden'
        ? Promise.reject(new LabReportNotFoundException(id))
        : Promise.resolve(pdf),
    );
    Object.assign(svc, {
      // the cancelled-order print check has its own spec (print-cancelled)
      assertReportOrderNotCancelledForPrint: jest
        .fn()
        .mockResolvedValue(undefined),
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      prisma: {
        labReport: { findMany: jest.fn().mockResolvedValue(rows) },
        order: {
          findFirst: jest.fn().mockResolvedValue({ branchId: 'OWNER' }),
        },
      },
      referralCredit: {
        assertReportAccessAllowedByOrderId: jest
          .fn()
          .mockResolvedValue(undefined),
      },
      requireBranch: (b: string) => b,
      print,
    });
    return { svc, print };
  }

  it('a report the caller cannot read does not fail the whole document', async () => {
    const { svc, print } = await build([
      { id: 'r1', branchId: 'A' },
      { id: 'hidden', branchId: 'B' },
    ]);
    const out = await svc.printAllForOrder('o1', 't1', 'A');
    expect(print).toHaveBeenCalledTimes(2);
    const merged = await PDFDocument.load(out);
    expect(merged.getPageCount()).toBe(1); // only the readable one
  });

  it('when nothing can be shown it is "no reports", not a crash', async () => {
    const { svc } = await build([{ id: 'hidden', branchId: 'B' }]);
    await expect(svc.printAllForOrder('o1', 't1', 'A')).rejects.toBeInstanceOf(
      OrderReportsNotFoundException,
    );
  });

  it('every report is printed with unfinished results masked', async () => {
    const { svc, print } = await build([{ id: 'r1', branchId: 'A' }]);
    await svc.printAllForOrder('o1', 't1', 'A');
    const args = print.mock.calls[0] as unknown as unknown[];
    expect(args[6]).toBe(true); // maskUnfinished
  });
});

describe('LabReportService.getShareInfo - how many tests are still pending', () => {
  it('counts the tests whose results are not signed off, over the whole order', async () => {
    const count = jest
      .fn()
      .mockResolvedValueOnce(3) // total reports on the order
      .mockResolvedValueOnce(2); // validated / approved / published
    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      // the cancelled-order print check has its own spec (print-cancelled)
      assertReportOrderNotCancelledForPrint: jest
        .fn()
        .mockResolvedValue(undefined),
      assertOrderNotCancelledForPrint: jest.fn().mockResolvedValue(undefined),
      prisma: {
        order: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'o1',
            orderCode: 'ORD-1',
            patient: {
              id: 'p1',
              firstName: 'Rahul',
              lastName: 'Kumar',
              email: null,
              mobile: null,
              whatsappNumber: null,
            },
          }),
        },
        labReport: { count },
      },
      shareService: { getChannelInfo: jest.fn().mockResolvedValue([]) },
    });
    const info = await svc.getShareInfo('o1', 't1', 'A');
    expect(info.totalReportCount).toBe(3);
    expect(info.pendingReportCount).toBe(1);
    const readyWhere = (
      count.mock.calls[1] as [{ where: { status: { in: string[] } } }]
    )[0].where;
    expect([...readyWhere.status.in].sort()).toEqual(
      ['APPROVED', 'PUBLISHED', 'RESULT_DONE'].sort(),
    );
  });
});
