import { Injectable } from '@nestjs/common';
import { LabReportAttachment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLabReportAttachmentDto } from './dto/create-lab-report-attachment.dto';
import { LabReportNotFoundException } from './exceptions/lab-report.exceptions';

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
   * Attach an already-uploaded file to a report.
   * @param reportId the lab report id
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); the report must belong to it
   * @param dto kind + fileUrl + fileName + optional notes
   * @param actorId person id recorded as `uploadedBy`
   * @throws LabReportNotFoundException if the report is missing/other tenant/branch
   */
  async addAttachment(
    reportId: string,
    tenantId: string,
    branchId: string | null,
    dto: CreateLabReportAttachmentDto,
    actorId: string,
  ): Promise<LabReportAttachment> {
    await this.requireReport(reportId, tenantId, branchId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.labReportAttachment.create({
        data: {
          tenantId,
          labReportId: reportId,
          kind: dto.kind,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          notes: dto.notes ?? null,
          uploadedBy: actorId,
        },
      }),
    );
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
    await this.requireReport(reportId, tenantId, branchId);
    return this.prisma.labReportAttachment.findMany({
      where: { labReportId: reportId, tenantId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Remove one attachment (hard delete — the model has no soft-delete column).
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
        where: { id: attachmentId, labReportId: reportId, tenantId },
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
   * Ensure the report exists within the caller's tenant + active branch.
   * @throws LabReportNotFoundException otherwise
   */
  private async requireReport(
    reportId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<void> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!report) {
      throw new LabReportNotFoundException(reportId);
    }
  }
}
