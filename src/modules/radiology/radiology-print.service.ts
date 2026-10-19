import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import {
  NoRadiologyReportTemplateException,
  RadiologyStudyNotFoundException,
} from './exceptions/radiology.exceptions';

/** The config slot / template type a radiology report renders through. */
const RADIOLOGY_REPORT_SLOT = 'radiology_report';

/**
 * Renders a radiology study's report to PDF (Phase 3.5). Resolves the template
 * (study override → Configuration default → first active `radiology_report`
 * template) and builds the merge variables from the study + its order/patient,
 * then delegates to the shared `PdfReportTemplateService.generatePdf` engine —
 * mirroring the lab-report print path for the flat radiology model.
 */
@Injectable()
export class RadiologyPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfTemplates: PdfReportTemplateService,
    private readonly pdfConfig: PdfTemplateConfigService,
  ) {}

  /**
   * Generate the PDF for one radiology study.
   * @throws RadiologyStudyNotFoundException / NoRadiologyReportTemplateException
   */
  async generateStudyPdf(
    id: string,
    tenantId: string,
    branchId: string | null,
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
          select: {
            salutation: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
          },
        })
      : null;

    const templateId = await this.resolveTemplateId(
      study.reportTemplateId,
      tenantId,
      study.branchId ?? branchId,
    );

    const variables = this.buildVariables(study, order, patient);
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
    patient: {
      salutation: string | null;
      firstName: string;
      lastName: string | null;
      gender: string | null;
      dateOfBirth: Date | null;
    } | null,
  ): Record<string, string> {
    const patientName = patient
      ? [patient.salutation, patient.firstName, patient.lastName]
          .filter((p): p is string => Boolean(p))
          .join(' ')
      : '';
    const fmt = (d: Date | null | undefined): string =>
      d ? new Date(d).toISOString().slice(0, 10) : '';
    const age = patient?.dateOfBirth
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

    return {
      study_no: study.studyNo,
      test_name: study.radiologyTestName ?? '',
      modality: study.modality ?? '',
      body_part: study.bodyPart ?? '',
      view: study.view ?? '',
      findings: study.findings ?? '',
      impression: study.impression ?? '',
      recommendation: study.recommendation ?? '',
      order_code: order?.orderCode ?? '',
      order_date: fmt(order?.orderDate),
      report_date: fmt(study.publishedAt ?? study.reportedAt),
      patient_name: patientName,
      patient_age: age,
      patient_gender: patient?.gender ?? '',
    };
  }
}
