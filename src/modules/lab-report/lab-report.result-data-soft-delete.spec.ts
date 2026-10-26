import { LabReportService } from './lab-report.service';
import { LabReportAttachmentService } from './lab-report-attachment.service';
import { LAB_REPORT_DETAIL_INCLUDE } from './entities/lab-report.entity';

/**
 * A test sent back for a repeat soft-deletes the result-related data the branch
 * recorded (overall results, technician notes, attachments). Every reader must
 * filter those rows out, and saving an overall result again must revive its row.
 */

/** The first argument of a mock's first call, typed (jest mocks are `any`). */
function firstArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0]?.[0] as T;
}

type WithWhere = { where: Record<string, unknown> };

describe('detail include', () => {
  it('only loads live notes, attachments and multi-step process', () => {
    expect(LAB_REPORT_DETAIL_INCLUDE.notes.where).toEqual({ deletedAt: null });
    expect(LAB_REPORT_DETAIL_INCLUDE.attachments.where).toEqual({
      deletedAt: null,
    });
    expect(LAB_REPORT_DETAIL_INCLUDE.multiStepProcess.where).toEqual({
      deletedAt: null,
    });
  });
});

interface AttachmentPrismaMock {
  labReport: { findFirst: jest.Mock };
  orderSampleTest: { findFirst: jest.Mock; findMany: jest.Mock };
  labReportAttachment: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
  withTenant: jest.Mock;
}

describe('LabReportAttachmentService readers', () => {
  function build() {
    const prisma: AttachmentPrismaMock = {
      // 1st: the branch lookup; 2nd: the cancelled-order probe (none); then the
      // sent-out check reads the report's keys.
      labReport: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'r1' })
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            branchId: 'b1',
            orderItemId: 'i1',
            memberBranchLabTestId: null,
            labTestId: null,
          }),
      },
      orderSampleTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      labReportAttachment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
      withTenant: jest.fn(
        (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
          fn(prisma),
      ),
    };
    return { prisma, service: new LabReportAttachmentService(prisma as never) };
  }

  it('lists only live attachments', async () => {
    const { prisma, service } = build();
    await service.listForReport('r1', 't1', 'b1');
    const { where } = firstArg<WithWhere>(prisma.labReportAttachment.findMany);
    expect(where).toMatchObject({ labReportId: 'r1', deletedAt: null });
  });

  it('cannot remove an attachment that is already hidden', async () => {
    const { prisma, service } = build();
    await expect(service.remove('r1', 'a1', 't1', 'b1')).rejects.toThrow();
    const { where } = firstArg<WithWhere>(prisma.labReportAttachment.findFirst);
    expect(where).toMatchObject({ id: 'a1', deletedAt: null });
    expect(prisma.labReportAttachment.delete).not.toHaveBeenCalled();
  });
});

describe('LabReportService readers', () => {
  interface Internals {
    prisma: unknown;
    requireReport: jest.Mock;
    siblingReportIds: jest.Mock;
    assertResultParamBelongsToReport: jest.Mock;
    technicianSettingsService: unknown;
    overallResultTemplateService: unknown;
  }
  interface ReaderPrismaMock {
    labReportNote: { findMany: jest.Mock };
    labReportOverallResult: { findUnique: jest.Mock; upsert: jest.Mock };
  }

  function build() {
    const prisma: ReaderPrismaMock = {
      labReportNote: { findMany: jest.fn().mockResolvedValue([]) },
      labReportOverallResult: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest
          .fn()
          .mockResolvedValue({ templateId: null, content: 'new text' }),
      },
    };
    const service = Object.create(
      LabReportService.prototype,
    ) as LabReportService;
    const internals = service as unknown as Internals;
    internals.prisma = prisma;
    internals.requireReport = jest.fn().mockResolvedValue({ id: 'r1' });
    internals.siblingReportIds = jest.fn().mockResolvedValue(['r1']);
    internals.assertResultParamBelongsToReport = jest
      .fn()
      .mockResolvedValue(undefined);
    internals.technicianSettingsService = {
      getForBranch: jest
        .fn()
        .mockResolvedValue({ isOverallResultEditable: true }),
    };
    internals.overallResultTemplateService = { findById: jest.fn() };
    return { prisma, service };
  }

  it.each([
    ['ORDER', true],
    ['SAMPLE', true],
    ['TECH', false],
  ])(
    'a %s note may be added while the sample is on Repeat: %s',
    async (category, allowed) => {
      const { prisma, service } = build();
      (prisma.labReportNote as unknown as { create: jest.Mock }).create = jest
        .fn()
        .mockResolvedValue({});
      await service.createNote('r1', 't1', 'b1', 'u1', {
        category,
        body: 'x',
      } as never);
      expect(
        (service as unknown as { requireReport: jest.Mock }).requireReport,
      ).toHaveBeenCalledWith('r1', 't1', 'b1', {
        allowAwaitingSample: allowed,
      });
    },
  );

  it('lists only live notes', async () => {
    const { prisma, service } = build();
    await service.findNotes('r1', 't1', 'b1', {});
    const { where } = firstArg<WithWhere>(prisma.labReportNote.findMany);
    expect(where).toMatchObject({ deletedAt: null });
  });

  it('treats a hidden overall result as absent when editing', async () => {
    const { prisma, service } = build();
    await service.updateOverallResult('r1', 't1', 'b1', 'p1', {
      content: 'new text',
    });
    const { where } = firstArg<WithWhere>(
      prisma.labReportOverallResult.findUnique,
    );
    expect(where).toMatchObject({ deletedAt: null });
  });

  it('saving an overall result again revives a hidden row', async () => {
    const { prisma, service } = build();
    await service.updateOverallResult('r1', 't1', 'b1', 'p1', {
      content: 'new text',
    });
    const { update } = firstArg<{ update: Record<string, unknown> }>(
      prisma.labReportOverallResult.upsert,
    );
    expect(update).toMatchObject({ content: 'new text', deletedAt: null });
  });
});
