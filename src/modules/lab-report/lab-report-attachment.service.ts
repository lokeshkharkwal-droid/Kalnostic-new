import { Injectable } from '@nestjs/common';
import { LabReportAttachment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertReportWritable } from './utils/sent-out-report.util';
import { CreateLabReportAttachmentDto } from './dto/create-lab-report-attachment.dto';
import {
  LabReportNotFoundException,
  TestFileAttachmentsTooLargeException,
  TooManyTestFileAttachmentsException,
} from './exceptions/lab-report.exceptions';

/** The Test Entry "File +" bucket (PDFs + images the print tag renders). */
const FILE_KIND = 'file';
/** Max "File +" attachments per report. */
const MAX_FILE_ATTACHMENTS = 10;
/** Max combined size of a report's "File +" attachments (25 MB). */
const MAX_FILE_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * Attachments for a technician report — images / documents / files linked to a
 * `LabReport` (LABORATORY.docx §4.4). URL-only: the bytes are already in S3 (via
 * `POST /uploads/attachment`); this stores the URL + metadata. The same table
 * also holds analyzer histogram images written by the EMI submit flow, so the
 * Technician Reporting screen shows both machine- and human-uploaded files.
 */
@Injectable()
export class LabReportAttachmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attach an already-uploaded file to a report. For "File +" uploads
   * (`kind === 'file'`) the per-report count and total-size limits are enforced
   * inside the transaction (so two concurrent adds can't both slip past), and
   * the server-measured `fileSizeBytes` is recorded for the total.
   * @param reportId the lab report id
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); the report must belong to it
   * @param dto kind + fileUrl + fileName + optional notes + optional fileSizeBytes
   * @param actorId person id recorded as `uploadedBy`
   * @throws LabReportNotFoundException if the report is missing/other tenant/branch
   * @throws TooManyTestFileAttachmentsException if the File+ count limit is reached
   * @throws TestFileAttachmentsTooLargeException if the File+ total-size limit is exceeded
   */
  async addAttachment(
    reportId: string,
    tenantId: string,
    branchId: string | null,
    dto: CreateLabReportAttachmentDto,
    actorId: string,
  ): Promise<LabReportAttachment> {
    await this.requireReport(reportId, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.kind === FILE_KIND) {
        const existing = await tx.labReportAttachment.findMany({
          // Not-deleted only: a Repeat/return hides (soft-deletes) the old attachments,
          // and files nobody can see must not count toward the limits.
          where: {
            labReportId: reportId,
            tenantId,
            kind: FILE_KIND,
            deletedAt: null,
          },
          select: { fileSizeBytes: true },
        });
        if (existing.length >= MAX_FILE_ATTACHMENTS) {
          throw new TooManyTestFileAttachmentsException(
            reportId,
            MAX_FILE_ATTACHMENTS,
          );
        }
        const total =
          existing.reduce((sum, a) => sum + (a.fileSizeBytes ?? 0), 0) +
          (dto.fileSizeBytes ?? 0);
        if (total > MAX_FILE_ATTACHMENT_TOTAL_BYTES) {
          throw new TestFileAttachmentsTooLargeException(
            reportId,
            MAX_FILE_ATTACHMENT_TOTAL_BYTES,
          );
        }
      }
      return tx.labReportAttachment.create({
        data: {
          tenantId,
          labReportId: reportId,
          kind: dto.kind,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          notes: dto.notes ?? null,
          fileSizeBytes: dto.fileSizeBytes ?? null,
          uploadedBy: actorId,
        },
      });
    });
  }

  /**
   * List a report's attachments (newest first) — includes EMI-uploaded histograms.
   * @throws LabReportNotFoundException if the report is missing/other tenant/branch
   */
  async listForReport(
    reportId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<LabReportAttachment[]> {
    await this.requireReport(reportId, tenantId, branchId, { forRead: true });
    return this.prisma.labReportAttachment.findMany({
      where: { labReportId: reportId, tenantId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Remove one attachment (a user's explicit delete is a hard delete; a repeat's
   * reset soft-deletes via `deletedAt`).
   * @throws LabReportNotFoundException if the report is missing/other tenant/branch
   */
  async remove(
    reportId: string,
    attachmentId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<{ id: string }> {
    await this.requireReport(reportId, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.labReportAttachment.findFirst({
        where: {
          id: attachmentId,
          labReportId: reportId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new LabReportNotFoundException(attachmentId);
      }
      await tx.labReportAttachment.delete({ where: { id: existing.id } });
      return { id: existing.id };
    });
  }

  /**
   * Ensure the report exists within the caller's tenant + active branch. Writes
   * are also refused while the report's sample is sent to another branch
   * (view-only); `forRead` skips only that lock.
   * @throws LabReportNotFoundException if the report is not in this branch
   * @throws LabReportSentOutException for a write on a sent-out report
   */
  private async requireReport(
    reportId: string,
    tenantId: string,
    branchId: string | null,
    opts: { forRead?: boolean } = {},
  ): Promise<void> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!report) {
      throw new LabReportNotFoundException(reportId);
    }
    if (!opts.forRead) {
      await assertReportWritable(this.prisma, tenantId, reportId);
    }
  }
}
