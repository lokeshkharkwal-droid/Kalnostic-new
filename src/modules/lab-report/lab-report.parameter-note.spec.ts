import { LabReportStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { LabReportParameterNoteNotEditableException } from './exceptions/lab-report.exceptions';
import { ValidationException } from '../../common/exceptions';

/**
 * The Note of ONE result parameter on one report (the Notes icon beside Sync on Patient Entry / Test Entry):
 *  - `PATCH /lab-reports/:id/parameter-note/:resultParamId` stores the technician's own text for this report,
 *    only while the report is Pending, Partial Pending or Saved, and never touches the parameter's configured Note;
 *  - `{result_note}` prints that text when the report has one, the configured Note otherwise.
 */
jest.setTimeout(30_000);

type Status = LabReportStatus;

function makeEditService(status: Status, freshStatus: Status = status) {
  const upsert = jest.fn().mockResolvedValue({});
  const paramUpdate = jest.fn();
  const tx = {
    labReport: {
      findFirst: jest.fn().mockResolvedValue({ status: freshStatus }),
    },
    labReportParameterNote: { upsert },
    labTestResultParam: { update: paramUpdate, updateMany: paramUpdate },
  };
  const lockReportForWrite = jest.fn().mockResolvedValue(undefined);
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    requireBranch: (b: string) => b,
    requireReport: jest.fn().mockResolvedValue({
      id: 'r1',
      status,
      labTestId: 'lt1',
      orderItemId: 'item1',
    }),
    getResultParams: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
    lockReportForWrite,
    prisma: {
      orderItem: {
        findUnique: jest.fn().mockResolvedValue({ branchLabPanelId: null }),
      },
      withTenant: (_tenantId: string, fn: (t: typeof tx) => Promise<void>) =>
        fn(tx),
    },
  });
  return { svc, upsert, paramUpdate, lockReportForWrite };
}

const save = (svc: LabReportService, content: string, paramId = 'p1') =>
  svc.updateParameterNote('r1', 't1', 'A', paramId, { content });

describe('LabReportService.updateParameterNote', () => {
  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.PARTIAL_PENDING,
    LabReportStatus.SAVED,
  ])("saves the technician's text while the report is %s", async (status) => {
    const { svc, upsert } = makeEditService(status);
    await expect(save(svc, '<p>Hemolysed</p>')).resolves.toEqual({
      resultParamId: 'p1',
      content: '<p>Hemolysed</p>',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        labReportId_resultParamId: { labReportId: 'r1', resultParamId: 'p1' },
      },
      create: {
        tenantId: 't1',
        labReportId: 'r1',
        resultParamId: 'p1',
        content: '<p>Hemolysed</p>',
      },
      update: { content: '<p>Hemolysed</p>', deletedAt: null },
    });
  });

  it.each([
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])('refuses once the report is %s, and writes nothing', async (status) => {
    const { svc, upsert } = makeEditService(status);
    await expect(save(svc, 'x')).rejects.toBeInstanceOf(
      LabReportParameterNoteNotEditableException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reads the status again after locking the row: a Submit that committed in between is not overwritten', async () => {
    const { svc, upsert, lockReportForWrite } = makeEditService(
      LabReportStatus.SAVED,
      LabReportStatus.VALIDATION_PENDING,
    );
    await expect(save(svc, 'x')).rejects.toBeInstanceOf(
      LabReportParameterNoteNotEditableException,
    );
    expect(lockReportForWrite).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("stores an empty text as it is: 'no note on this report' must not fall back to the default", async () => {
    const { svc, upsert } = makeEditService(LabReportStatus.SAVED);
    await save(svc, '');
    expect(
      (upsert.mock.calls[0] as [{ create: { content: string } }])[0].create
        .content,
    ).toBe('');
  });

  it("refuses a parameter that is not one of this report's own", async () => {
    const { svc, upsert } = makeEditService(LabReportStatus.SAVED);
    await expect(save(svc, 'x', 'other-test-param')).rejects.toBeInstanceOf(
      ValidationException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never writes the parameter's configured Note", async () => {
    const { svc, paramUpdate } = makeEditService(LabReportStatus.SAVED);
    await save(svc, '<p>mine</p>');
    expect(paramUpdate).not.toHaveBeenCalled();
  });
});

// ── print: {result_note} ────────────────────────────────────────────────────────

function printReport(
  status: Status,
  parameterNotes: Array<{ resultParamId: string; content: string }>,
) {
  return {
    id: 'r1',
    status,
    branchId: 'A',
    orderItemId: 'item1',
    memberBranchLabTestId: null,
    excludedNoteSections: [],
    orderItem: {
      direct: null,
      branchLabPanelId: null,
      branchLabTestId: 'test1',
      branchLabTest: { testName: 'LFT' },
      branchLabPanel: null,
      order: {
        id: 'o1',
        orderCode: 'ORD-1',
        orderDate: new Date('2026-10-01'),
        orderTime: null,
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
    parameterNotes,
    contentSections: {
      usefulFor: null,
      interpretation: null,
      limitations: null,
      remarks: null,
      references: null,
    },
    attachments: [],
    resultValues: [
      {
        resultParamId: 'p1',
        observed1: '1.2',
        observed2: null,
        unit: 'mg/dL',
        methodology: null,
        referenceRangeId: null,
        referenceDisplay: null,
      },
      {
        resultParamId: 'p2',
        observed1: '40',
        observed2: null,
        unit: 'U/L',
        methodology: null,
        referenceRangeId: null,
        referenceDisplay: null,
      },
    ],
  };
}

function makePrintService(rep: ReturnType<typeof printReport>) {
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, {
    loadReportDetail: jest.fn().mockResolvedValue(rep),
    findById: jest.fn().mockResolvedValue(rep),
    resolveStoredSignatories: jest.fn().mockResolvedValue([]),
    resolveApprovingDoctor: jest.fn().mockResolvedValue(null),
    siblingReportIds: jest.fn().mockResolvedValue(['r1']),
    requireBranch: (b: string) => b,
    technicianSettingsService: {
      getNotesPrintSwitches: jest
        .fn()
        .mockResolvedValue({ labTest: true, labPanel: true }),
    },
    tenantService: {
      getLocale: jest.fn().mockResolvedValue({
        timezone: 'Asia/Kolkata',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: 'HH:mm',
      }),
    },
    prisma: {
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
      orderDiagnostics: { findUnique: jest.fn().mockResolvedValue(null) },
      labReport: {
        aggregate: jest.fn().mockResolvedValue({ _max: { approvedAt: null } }),
      },
      labReportNote: { findFirst: jest.fn().mockResolvedValue(null) },
      labTestResultParam: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            parameterName: 'Bilirubin',
            groupName: null,
            sortOrder: 1,
            notes: 'Fasting <sample> needed',
            resultType: 'QUANTITATIVE',
          },
          {
            id: 'p2',
            parameterName: 'SGOT',
            groupName: null,
            sortOrder: 2,
            notes: null,
            resultType: 'QUANTITATIVE',
          },
        ]),
      },
      labReportOverallResult: { findMany: jest.fn().mockResolvedValue([]) },
    },
  });
  return svc;
}

async function rowNotes(rep: ReturnType<typeof printReport>) {
  const ctx = await makePrintService(rep).buildPrintContext(
    'r1',
    't1',
    'A',
    false,
  );
  const rows = (
    ctx as unknown as {
      sections: {
        results: Array<{ parameter_name: string; result_note: string }>;
      };
    }
  ).sections.results;
  return Object.fromEntries(rows.map((r) => [r.parameter_name, r.result_note]));
}

describe('print context: {result_note}', () => {
  it('a parameter the technician never edited prints the configured Note, escaped (it is plain text)', async () => {
    const notes = await rowNotes(printReport(LabReportStatus.APPROVED, []));
    expect(notes['Bilirubin']).toBe('Fasting &lt;sample&gt; needed');
    expect(notes['SGOT']).toBe('');
  });

  it("the technician's text for this report replaces the configured Note, as formatted HTML", async () => {
    const notes = await rowNotes(
      printReport(LabReportStatus.APPROVED, [
        { resultParamId: 'p1', content: '<p><strong>Hemolysed</strong></p>' },
      ]),
    );
    expect(notes['Bilirubin']).toBe('<p><strong>Hemolysed</strong></p>');
    expect(notes['SGOT']).toBe('');
  });

  it('a note the technician blanked prints nothing - the configured Note does not come back', async () => {
    const notes = await rowNotes(
      printReport(LabReportStatus.APPROVED, [
        { resultParamId: 'p1', content: '' },
      ]),
    );
    expect(notes['Bilirubin']).toBe('');
  });

  it('a note written for a parameter shows on that parameter only', async () => {
    const notes = await rowNotes(
      printReport(LabReportStatus.APPROVED, [
        { resultParamId: 'p2', content: '<p>Repeat</p>' },
      ]),
    );
    expect(notes['SGOT']).toBe('<p>Repeat</p>');
    expect(notes['Bilirubin']).toBe('Fasting &lt;sample&gt; needed');
  });
});
