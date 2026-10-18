import { LabReportAttachmentService } from './lab-report-attachment.service';
import {
  TestFileAttachmentsTooLargeException,
  TooManyTestFileAttachmentsException,
} from './exceptions/lab-report.exceptions';

interface StoredAttachment {
  fileSizeBytes: number | null;
  deletedAt: Date | null;
}

const TENANT = 't1';
const FILE_DTO = {
  kind: 'file',
  fileUrl: 'https://files.example/new.pdf',
  fileName: 'new.pdf',
  fileSizeBytes: 1024,
} as never;

/**
 * A "File +" attachment is limited per report (10 files, 25 MB in total). A Repeat /
 * return hides the old attachments by soft-deleting them, so the limits must count
 * only the files that are still visible - otherwise a clean report refuses uploads
 * because of files nobody can see.
 */
function setup(stored: StoredAttachment[]) {
  const findMany = jest.fn(({ where }: { where: { deletedAt?: null } }) =>
    // Behave like the database: a `deletedAt: null` filter drops the hidden rows.
    Promise.resolve(
      stored.filter((r) =>
        where.deletedAt === null ? r.deletedAt === null : true,
      ),
    ),
  );
  const create = jest.fn().mockResolvedValue({ id: 'a-new' });
  const tx = { labReportAttachment: { findMany, create } };
  const prisma = {
    // The report lookup, and the write lock's "is its order cancelled?" probe (it is not).
    labReport: {
      findFirst: jest.fn(({ where }: { where: { orderItem?: unknown } }) =>
        Promise.resolve(
          where.orderItem
            ? null
            : {
                id: 'r1',
                branchId: null,
                orderItemId: 'oi1',
                memberBranchLabTestId: null,
                labTestId: null,
              },
        ),
      ),
    },
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const svc = new LabReportAttachmentService(prisma as never);
  return { svc, findMany, create };
}

const visible = (n: number, size = 1024): StoredAttachment[] =>
  Array.from({ length: n }, () => ({ fileSizeBytes: size, deletedAt: null }));
const hidden = (n: number, size = 1024): StoredAttachment[] =>
  Array.from({ length: n }, () => ({
    fileSizeBytes: size,
    deletedAt: new Date(),
  }));

describe('LabReportAttachmentService.addAttachment - File + limits', () => {
  it('counts only attachments that are not deleted', async () => {
    const { svc, findMany } = setup(visible(1));
    await svc.addAttachment('r1', TENANT, 'b1', FILE_DTO, 'u1');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      labReportId: 'r1',
      tenantId: TENANT,
      kind: 'file',
      deletedAt: null,
    });
  });

  it('hidden (soft-deleted) files do not use up the limit after a repeat', async () => {
    // Nine files were hidden by the return; one is visible. A tenth upload is fine.
    const { svc, create } = setup([...hidden(9), ...visible(1)]);
    await svc.addAttachment('r1', TENANT, 'b1', FILE_DTO, 'u1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('hidden files do not use up the size limit either', async () => {
    const big = 10 * 1024 * 1024;
    const { svc, create } = setup([...hidden(2, big), ...visible(1, 1024)]);
    await svc.addAttachment('r1', TENANT, 'b1', FILE_DTO, 'u1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('still refuses the 11th visible file', async () => {
    const { svc, create } = setup(visible(10));
    await expect(
      svc.addAttachment('r1', TENANT, 'b1', FILE_DTO, 'u1'),
    ).rejects.toBeInstanceOf(TooManyTestFileAttachmentsException);
    expect(create).not.toHaveBeenCalled();
  });

  it('still refuses a file that pushes the visible total over 25 MB', async () => {
    const { svc, create } = setup(visible(1, 25 * 1024 * 1024));
    await expect(
      svc.addAttachment('r1', TENANT, 'b1', FILE_DTO, 'u1'),
    ).rejects.toBeInstanceOf(TestFileAttachmentsTooLargeException);
    expect(create).not.toHaveBeenCalled();
  });
});
