import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { IssueRadiologyCertificateDto } from './dto/issue-radiology-certificate.dto';
import { UpdateIssuedRadiologyCertificateDto } from './dto/update-issued-radiology-certificate.dto';
import {
  RadiologyCertificateIssuedEntity,
  RadiologyCertificatePreview,
} from './entities/radiology-certificate-issued.entity';
import {
  RadiologyCertificateIssuedNotFoundException,
  RadiologyCertificateTemplateNotFoundException,
  RadiologyReportNotFilledException,
  RadiologyStudyNotFoundException,
} from './exceptions/radiology.exceptions';

/** The study + order context the certificate renderer needs (patient comes from the order). */
interface CertificateContext {
  study: {
    id: string;
    orderId: string;
    branchId: string | null;
    reportingDoctorId: string | null;
    studyNo: string;
    modality: string | null;
    bodyPart: string | null;
    view: string | null;
    findings: string | null;
    impression: string | null;
    recommendation: string | null;
    publishedAt: Date | null;
    reportedAt: Date | null;
  };
  patientId: string;
  orderCode: string | null;
  orderDate: Date | null;
}

/**
 * The radiology-certificate ISSUE tier (ported from EzHealthTrack's
 * `RadiologyController` + `rad_certificate_history`). A `RadiologyCertificate`
 * template is picked for a study, its `{placeholder}`s are filled from the
 * patient/study context (mirroring `RadMedicalNote::getCert`), optionally edited,
 * then saved as a `RadiologyCertificateIssued` row attached to the patient's
 * study — and printed to PDF via the shared Puppeteer `PdfService`.
 *
 * Reads/writes are tenant-scoped (RLS also enforces it) and, when a branch is
 * active, branch-scoped; a tenant-level admin (no active branch) sees all.
 */
@Injectable()
export class RadiologyCertificateIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /** List the certificates issued against a study (newest first) — the history. */
  async listForStudy(
    tenantId: string,
    branchId: string | null,
    studyId: string,
  ): Promise<RadiologyCertificateIssuedEntity[]> {
    await this.loadContext(tenantId, branchId, studyId);
    return this.prisma.radiologyCertificateIssued.findMany({
      where: { tenantId, studyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Render a template against the study WITHOUT saving — returns the resolved
   * HTML for the doctor to review/edit before issuing.
   */
  async preview(
    tenantId: string,
    branchId: string | null,
    studyId: string,
    certificateId: string,
    reportingDoctorId?: string,
  ): Promise<RadiologyCertificatePreview> {
    const ctx = await this.loadContext(tenantId, branchId, studyId);
    // Resolve the doctor placeholders against the doctor chosen in the modal
    // (may precede/override the study's saved reportingDoctorId).
    if (reportingDoctorId) {
      ctx.study.reportingDoctorId = reportingDoctorId;
    }
    const { template, content } = await this.renderTemplate(
      tenantId,
      certificateId,
      ctx,
    );
    return {
      certificateId: template.id,
      certificateName: template.name,
      groupName: template.groupName ?? null,
      content,
    };
  }

  /**
   * Issue (save) a certificate against a study. `content` is the final edited
   * HTML; when omitted the template is rendered fresh. Snapshots the template's
   * name/group and links the study/order/patient.
   */
  async issue(
    tenantId: string,
    branchId: string | null,
    studyId: string,
    personId: string,
    dto: IssueRadiologyCertificateDto,
  ): Promise<RadiologyCertificateIssuedEntity> {
    const ctx = await this.loadContext(tenantId, branchId, studyId);
    const { template, content } = await this.renderTemplate(
      tenantId,
      dto.certificateId,
      ctx,
    );
    return this.prisma.radiologyCertificateIssued.create({
      data: {
        tenantId,
        branchId: ctx.study.branchId,
        certificateId: template.id,
        certificateName: template.name,
        groupName: template.groupName,
        studyId: ctx.study.id,
        orderId: ctx.study.orderId,
        patientId: ctx.patientId,
        issuedBy: personId,
        content: dto.content ?? content,
        createdBy: personId,
        updatedBy: personId,
      },
    });
  }

  /** Fetch one issued certificate (tenant/branch-scoped). */
  async getIssued(
    tenantId: string,
    branchId: string | null,
    id: string,
  ): Promise<RadiologyCertificateIssuedEntity> {
    const row = await this.prisma.radiologyCertificateIssued.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
    });
    if (!row) {
      throw new RadiologyCertificateIssuedNotFoundException(id);
    }
    return row;
  }

  /** Re-edit an issued certificate's HTML. */
  async updateIssued(
    tenantId: string,
    branchId: string | null,
    id: string,
    personId: string,
    dto: UpdateIssuedRadiologyCertificateDto,
  ): Promise<RadiologyCertificateIssuedEntity> {
    await this.getIssued(tenantId, branchId, id);
    return this.prisma.radiologyCertificateIssued.update({
      where: { id },
      data: { content: dto.content, updatedBy: personId },
    });
  }

  /** Soft-delete (revoke) an issued certificate. */
  async removeIssued(
    tenantId: string,
    branchId: string | null,
    id: string,
    personId: string,
  ): Promise<RadiologyCertificateIssuedEntity> {
    await this.getIssued(tenantId, branchId, id);
    return this.prisma.radiologyCertificateIssued.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: personId },
    });
  }

  /** Render an issued certificate's saved HTML to a PDF. Blocked until the study's
   *  report is filled — a certificate can't be printed for an unreported study
   *  (even one that somehow has an issued row). */
  async printIssued(
    tenantId: string,
    branchId: string | null,
    id: string,
  ): Promise<Buffer> {
    const row = await this.getIssued(tenantId, branchId, id);
    await this.assertReportFilled(tenantId, branchId, row.studyId);
    return this.pdf.htmlToPdf(this.wrapHtml(row.certificateName, row.content));
  }

  /**
   * Render the CURRENT edited certificate HTML to a PDF WITHOUT saving — the
   * report modal's "Print Certificate" action. The certificate is the single
   * source of truth, so `content` (the doctor's visually-edited document) is
   * printed verbatim — no placeholder re-resolution. `certificateId` only titles
   * the PDF. Scope is still validated against the study. No
   * `RadiologyCertificateIssued` row is written.
   */
  async renderUnsaved(
    tenantId: string,
    branchId: string | null,
    studyId: string,
    content: string,
    certificateId?: string,
  ): Promise<{ name: string; pdf: Buffer }> {
    const ctx = await this.loadContext(tenantId, branchId, studyId);
    // A certificate can only be printed once the report is filled.
    if (!ctx.study.reportedAt) {
      throw new RadiologyReportNotFilledException(studyId);
    }
    let name = 'Certificate';
    if (certificateId) {
      const tpl = await this.prisma.radiologyCertificate.findFirst({
        where: { id: certificateId, tenantId, deletedAt: null },
        select: { name: true },
      });
      name = tpl?.name ?? name;
    }
    const pdf = await this.pdf.htmlToPdf(this.wrapHtml(name, content));
    return { name, pdf };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** Throw unless the study's report is filled (has a `reportedAt`). Guards the
   *  certificate print paths so an unfilled certificate can never be printed. */
  private async assertReportFilled(
    tenantId: string,
    branchId: string | null,
    studyId: string,
  ): Promise<void> {
    const study = await this.prisma.radiologyStudy.findFirst({
      where: {
        id: studyId,
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      select: { reportedAt: true },
    });
    if (!study) {
      throw new RadiologyStudyNotFoundException(studyId);
    }
    if (!study.reportedAt) {
      throw new RadiologyReportNotFilledException(studyId);
    }
  }

  /** Load the study + its order (patientId/orderCode/orderDate), tenant/branch-scoped. */
  private async loadContext(
    tenantId: string,
    branchId: string | null,
    studyId: string,
  ): Promise<CertificateContext> {
    const study = await this.prisma.radiologyStudy.findFirst({
      where: {
        id: studyId,
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        orderId: true,
        branchId: true,
        reportingDoctorId: true,
        studyNo: true,
        modality: true,
        bodyPart: true,
        view: true,
        findings: true,
        impression: true,
        recommendation: true,
        publishedAt: true,
        reportedAt: true,
      },
    });
    if (!study) {
      throw new RadiologyStudyNotFoundException(studyId);
    }
    const order = await this.prisma.order.findFirst({
      where: { id: study.orderId, tenantId, deletedAt: null },
      select: { patientId: true, orderCode: true, orderDate: true },
    });
    return {
      study,
      patientId: order?.patientId ?? '',
      orderCode: order?.orderCode ?? null,
      orderDate: order?.orderDate ?? null,
    };
  }

  /**
   * Resolve a certificate template + fill its `{placeholder}`s from the study's
   * patient / order / reporting-doctor context (EzHealthTrack `getCert`).
   */
  private async renderTemplate(
    tenantId: string,
    certificateId: string,
    ctx: CertificateContext,
  ): Promise<{
    template: { id: string; name: string; groupName: string | null };
    content: string;
  }> {
    const template = await this.prisma.radiologyCertificate.findFirst({
      where: { id: certificateId, tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true, groupName: true, content: true },
    });
    if (!template) {
      throw new RadiologyCertificateTemplateNotFoundException(certificateId);
    }
    const placeholders = await this.buildPlaceholders(tenantId, ctx);
    const content = this.resolvePlaceholders(
      template.content ?? '',
      placeholders,
    );
    return {
      template: {
        id: template.id,
        name: template.name,
        groupName: template.groupName,
      },
      content,
    };
  }

  /** Build the `{placeholder}` → value map from the study + order/patient/doctor. */
  private async buildPlaceholders(
    tenantId: string,
    ctx: CertificateContext,
  ): Promise<Record<string, string>> {
    const patient = ctx.patientId
      ? await this.prisma.patient.findFirst({
          where: { id: ctx.patientId, tenantId, deletedAt: null },
          select: {
            salutation: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            age: true,
            umId: true,
          },
        })
      : null;
    const doctor = ctx.study.reportingDoctorId
      ? await this.prisma.radiologyReportingDoctor.findFirst({
          where: {
            id: ctx.study.reportingDoctorId,
            tenantId,
            deletedAt: null,
          },
          select: {
            salutation: true,
            firstName: true,
            lastName: true,
            registrationNo: true,
            signatoryName: true,
            signatoryDesignation: true,
          },
        })
      : null;

    const patientName = patient
      ? [patient.salutation, patient.firstName, patient.lastName]
          .filter((p): p is string => Boolean(p))
          .join(' ')
      : '';
    const age =
      patient?.age != null
        ? String(patient.age)
        : patient?.dateOfBirth
          ? String(
              Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(patient.dateOfBirth).getTime()) /
                    (365.25 * 24 * 3600 * 1000),
                ),
              ),
            )
          : '';
    const fmt = (d: Date | null | undefined): string =>
      d ? new Date(d).toISOString().slice(0, 10) : '';
    const doctorName = doctor
      ? [doctor.salutation, doctor.firstName, doctor.lastName]
          .filter((p): p is string => Boolean(p))
          .join(' ')
      : '';
    const signatory = doctor
      ? [doctor.signatoryName || doctorName, doctor.signatoryDesignation]
          .filter((p): p is string => Boolean(p))
          .join(', ')
      : '';

    return {
      // EzHealthTrack legacy placeholder names (preserve exactly).
      display_name: patientName,
      age,
      gender: patient?.gender ?? '',
      signature: signatory,
      date: fmt(new Date()),
      diagnosis: ctx.study.impression ?? '',
      // Radiology-specific extras (align with the report-template variables).
      patient_name: patientName,
      patient_age: age,
      patient_gender: patient?.gender ?? '',
      um_id: patient?.umId ?? '',
      study_no: ctx.study.studyNo,
      modality: ctx.study.modality ?? '',
      body_part: ctx.study.bodyPart ?? '',
      view: ctx.study.view ?? '',
      findings: ctx.study.findings ?? '',
      impression: ctx.study.impression ?? '',
      recommendation: ctx.study.recommendation ?? '',
      order_code: ctx.orderCode ?? '',
      order_date: fmt(ctx.orderDate),
      report_date: fmt(ctx.study.publishedAt ?? ctx.study.reportedAt),
      doctor_name: doctorName,
      doctor_reg_no: doctor?.registrationNo ?? '',
    };
  }

  /** Replace every `{token}` with its mapped value; unknown tokens are left intact. */
  private resolvePlaceholders(
    html: string,
    map: Record<string, string>,
  ): string {
    return html.replace(/\{([a-z_]+)\}/g, (match: string, key: string) => {
      const value = map[key];
      return value ?? match;
    });
  }

  /** Wrap certificate HTML in a minimal printable A4 document. */
  private wrapHtml(title: string, body: string): string {
    const safeTitle = title.replace(/[<>&]/g, '');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; line-height: 1.5; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
</style></head><body>${body}</body></html>`;
  }
}
