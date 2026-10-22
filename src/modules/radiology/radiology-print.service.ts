import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import {
  NoRadiologyReportTemplateException,
  RadiologyStudyNotFoundException,
} from './exceptions/radiology.exceptions';
import {
  isoDate,
  narrativeBodyHtml,
  patientVariables,
  reportingDoctorVariables,
  type PatientTagSource,
  type ReportingDoctorTagSource,
} from './radiology-report-tags.util';

/** The config slot / template type a radiology report renders through. */
const RADIOLOGY_REPORT_SLOT = 'radiology_report';

/**
 * Renders a radiology study's report to PDF (Phase 3.5). Resolves the template
 * (study override → Configuration default → first active `radiology_report`
 * template) and builds the merge variables from the study + its order/patient,
 * then delegates to the shared `PdfReportTemplateService.generatePdf` engine —
 * mirroring the lab-report print path for the flat radiology model.
 *
 * The tag set mirrors the lab report: patient + reporting-doctor (incl. the
 * uploaded signature image) + full billing figures (reused from
 * `OrderService.getBillVariables`) + a `certificate_body` tag that embeds the
 * study's issued certificate HTML in full (the report's single source of truth),
 * falling back to a findings/impression narrative block when none is issued.
 */
@Injectable()
export class RadiologyPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfTemplates: PdfReportTemplateService,
    private readonly pdfConfig: PdfTemplateConfigService,
    // forwardRef: OrderModule ↔ RadiologyModule form a cycle (order → radiology
    // study handoff, radiology → OrderService for billing tags).
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
  ) {}

  /**
   * Generate the PDF for one radiology study. `pickedTemplateId` is the template
   * chosen in the FE print picker (the "Print Report" flow); when omitted (the
   * picker's "Skip Selection") the template is resolved centrally (study override
   * → Configuration default → first active `radiology_report`).
   * @throws RadiologyStudyNotFoundException / NoRadiologyReportTemplateException
   */
  async generateStudyPdf(
    id: string,
    tenantId: string,
    branchId: string | null,
    pickedTemplateId?: string,
  ): Promise<Buffer> {
    const study = await this.prisma.radiologyStudy.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!study) {
      throw new RadiologyStudyNotFoundException(id);
    }
    const order = await this.prisma.order.findFirst({
      where: { id: study.orderId, tenantId, deletedAt: null },
      select: { orderCode: true, orderDate: true, patientId: true },
    });
    const patient = order?.patientId
      ? await this.prisma.patient.findFirst({
          where: { id: order.patientId, tenantId, deletedAt: null },
          select: PATIENT_SELECT,
        })
      : null;
    const doctor = study.reportingDoctorId
      ? await this.prisma.radiologyReportingDoctor.findFirst({
          where: { id: study.reportingDoctorId, tenantId, deletedAt: null },
          select: REPORTING_DOCTOR_SELECT,
        })
      : null;

    const templateId = await this.resolveTemplateId(
      pickedTemplateId ?? study.reportTemplateId,
      tenantId,
      study.branchId ?? branchId,
    );

    // The embedded certificate body — the latest issued certificate's HTML (the
    // report's single source of truth), else a narrative fallback.
    const certificateBody = await this.resolveCertificateBody(tenantId, study);

    // Billing figures — reuse the order bill context so radiology money tags
    // agree with the Billings screen. Non-fatal: a study without a resolvable
    // bill still prints with empty billing tags.
    const billing = study.orderId
      ? await this.safeBillVariables(study.orderId, tenantId)
      : {};

    const variables = this.buildVariables(
      study,
      order,
      patient,
      doctor,
      certificateBody,
      billing,
    );
    return this.pdfTemplates.generatePdf(templateId, tenantId, { variables });
  }

  /** study override → Configuration default → first active template → throw. */
  private async resolveTemplateId(
    studyTemplateId: string | null,
    tenantId: string,
    branchId: string | null,
  ): Promise<string> {
    if (studyTemplateId) {
      const t = await this.prisma.pdfReportTemplate.findFirst({
        where: {
          id: studyTemplateId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (t) {
        return t.id;
      }
    }
    const configured = await this.pdfConfig.resolveConfiguredTemplateId(
      tenantId,
      branchId,
      RADIOLOGY_REPORT_SLOT,
    );
    if (configured) {
      return configured;
    }
    const first = await this.prisma.pdfReportTemplate.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        type: RADIOLOGY_REPORT_SLOT,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (first) {
      return first.id;
    }
    throw new NoRadiologyReportTemplateException();
  }

  /**
   * The study's embedded report body: the newest issued certificate's edited
   * HTML (the single source of truth), else a Findings/Impression/Recommendation
   * narrative block.
   */
  private async resolveCertificateBody(
    tenantId: string,
    study: {
      id: string;
      findings: string | null;
      impression: string | null;
      recommendation: string | null;
    },
  ): Promise<string> {
    const latest = await this.prisma.radiologyCertificateIssued.findFirst({
      where: { tenantId, studyId: study.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    if (latest?.content && latest.content.trim()) {
      return latest.content;
    }
    return narrativeBodyHtml(study);
  }

  /** Billing variables, swallowing any resolution error (empty on failure). */
  private async safeBillVariables(
    orderId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.orderService.getBillVariables(orderId, tenantId);
    } catch {
      return {};
    }
  }

  /** The `{placeholder}` merge variables for a radiology report template. */
  private buildVariables(
    study: {
      studyNo: string;
      radiologyTestName: string | null;
      modality: string | null;
      bodyPart: string | null;
      view: string | null;
      findings: string | null;
      impression: string | null;
      recommendation: string | null;
      publishedAt: Date | null;
      reportedAt: Date | null;
    },
    order: { orderCode: string; orderDate: Date | null } | null,
    patient: PatientTagSource | null,
    doctor: ReportingDoctorTagSource | null,
    certificateBody: string,
    billing: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      // Billing figures first so the explicit study/patient/doctor tags below
      // win on any key overlap (e.g. order_code / order_date_time).
      ...billing,
      study_no: study.studyNo,
      test_name: study.radiologyTestName ?? '',
      modality: study.modality ?? '',
      body_part: study.bodyPart ?? '',
      view: study.view ?? '',
      findings: study.findings ?? '',
      impression: study.impression ?? '',
      recommendation: study.recommendation ?? '',
      order_code: order?.orderCode ?? '',
      order_date: isoDate(order?.orderDate),
      report_date: isoDate(study.publishedAt ?? study.reportedAt),
      ...patientVariables(patient),
      ...reportingDoctorVariables(doctor),
      // The whole issued certificate HTML, injected verbatim (registered as a
      // RICH_TEXT key in template-render.service.ts so it is NOT escaped).
      certificate_body: certificateBody,
    };
  }
}

/** Patient columns the report tags need. */
const PATIENT_SELECT = {
  salutation: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  bloodGroup: true,
  dateOfBirth: true,
  age: true,
  mobile: true,
  addressLine1: true,
  umId: true,
} as const;

/** Reporting-doctor columns the report tags need. */
const REPORTING_DOCTOR_SELECT = {
  doctorType: true,
  salutation: true,
  firstName: true,
  lastName: true,
  gender: true,
  registrationNo: true,
  signatoryDesignation: true,
  signatureImagePath: true,
} as const;
