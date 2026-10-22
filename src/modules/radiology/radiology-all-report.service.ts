import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { code128DataUri } from '../../common/utils/barcode-image.util';
import { OrderService } from '../order/order.service';
import { GeneratePdfDto } from '../pdf-report-template/dto/generate-pdf.dto';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import {
  NoRadiologyAllReportTemplateException,
  NoRadiologyStudiesSelectedException,
} from './exceptions/radiology.exceptions';
import {
  isoDate,
  narrativeBodyHtml,
  patientAge,
  patientFullName,
  reportingDoctorObject,
  type PatientTagSource,
  type ReportingDoctorTagSource,
} from './radiology-report-tags.util';

/** The config slot / template type a combined radiology report renders through. */
const RADIOLOGY_ALL_REPORT_SLOT = 'radiology_all_report';

/** Stringify a possibly-absent bill-variable value ('' for null/undefined or a
 *  non-primitive — bill variables are only ever strings/numbers). */
const str = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

/** The study columns the combined-report builder reads. */
interface StudyRow {
  id: string;
  orderId: string;
  branchId: string | null;
  reportingDoctorId: string | null;
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
}

/**
 * Renders several radiology studies into ONE combined PDF (`radiology_all_report`)
 * — the worklist's multi-select "Print Report" action. Mirrors the lab
 * `printAllForOrder` / `buildAllReportsContext` pattern on a Latte template, but
 * keyed on an arbitrary list of **study ids** (which may span different orders /
 * patients) rather than a single order.
 *
 * Each selected study becomes one entry in the `reports` collection the template
 * iterates; its `body_html` is the study's latest issued certificate HTML (the
 * report's single source of truth), falling back to a findings/impression
 * narrative block. Every entry also carries its OWN patient / order / billing /
 * reporting-doctor tags so a cross-order selection resolves correctly, and a
 * top-level `header_fields` block (built from the first study's order) mirrors the
 * lab all-report header for single-order selections.
 */
@Injectable()
export class RadiologyAllReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfTemplates: PdfReportTemplateService,
    private readonly pdfConfig: PdfTemplateConfigService,
    // forwardRef: OrderModule ↔ RadiologyModule cycle (see radiology.module.ts).
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
  ) {}

  /**
   * Generate the combined PDF for the given studies (preserving the caller's
   * order). `pickedTemplateId` comes from the FE picker; when omitted ("Skip
   * Selection") the template is resolved centrally (Configuration default → first
   * active `radiology_all_report`).
   * @throws NoRadiologyStudiesSelectedException if none of the ids resolve
   * @throws NoRadiologyAllReportTemplateException if no template is available
   */
  async generateAllStudiesPdf(
    studyIds: string[],
    tenantId: string,
    branchId: string | null,
    pickedTemplateId?: string,
  ): Promise<Buffer> {
    const found = (await this.prisma.radiologyStudy.findMany({
      where: {
        id: { in: studyIds },
        tenantId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      select: STUDY_SELECT,
    })) as StudyRow[];
    if (found.length === 0) {
      throw new NoRadiologyStudiesSelectedException();
    }
    // Preserve the order the user selected the studies in.
    const byId = new Map(found.map((s) => [s.id, s]));
    const ordered = studyIds
      .map((id) => byId.get(id))
      .filter((s): s is StudyRow => Boolean(s));

    const templateId = await this.resolveTemplateId(
      pickedTemplateId,
      tenantId,
      ordered[0]!.branchId ?? branchId,
    );

    // Per-order caches so studies sharing an order don't re-query / re-compute.
    const billCache = new Map<string, Record<string, unknown>>();
    const orderCache = new Map<
      string,
      {
        orderCode: string;
        externalOrderId: string | null;
        patientId: string | null;
      } | null
    >();
    const patientCache = new Map<string, PatientTagSource | null>();
    const doctorCache = new Map<string, ReportingDoctorTagSource | null>();

    const getBill = async (
      orderId: string,
    ): Promise<Record<string, unknown>> => {
      const hit = billCache.get(orderId);
      if (hit) return hit;
      let vars: Record<string, unknown> = {};
      try {
        vars = await this.orderService.getBillVariables(orderId, tenantId);
      } catch {
        vars = {};
      }
      billCache.set(orderId, vars);
      return vars;
    };
    const getOrder = async (
      orderId: string,
    ): Promise<{
      orderCode: string;
      externalOrderId: string | null;
      patientId: string | null;
    } | null> => {
      if (orderCache.has(orderId)) return orderCache.get(orderId)!;
      const order = await this.prisma.order.findFirst({
        where: { id: orderId, tenantId, deletedAt: null },
        select: { orderCode: true, externalOrderId: true, patientId: true },
      });
      orderCache.set(orderId, order);
      return order;
    };
    const getPatient = async (
      patientId: string | null,
    ): Promise<PatientTagSource | null> => {
      if (!patientId) return null;
      if (patientCache.has(patientId)) return patientCache.get(patientId)!;
      const patient = (await this.prisma.patient.findFirst({
        where: { id: patientId, tenantId, deletedAt: null },
        select: PATIENT_SELECT,
      })) as PatientTagSource | null;
      patientCache.set(patientId, patient);
      return patient;
    };
    const getDoctor = async (
      doctorId: string | null,
    ): Promise<ReportingDoctorTagSource | null> => {
      if (!doctorId) return null;
      if (doctorCache.has(doctorId)) return doctorCache.get(doctorId)!;
      const doctor = (await this.prisma.radiologyReportingDoctor.findFirst({
        where: { id: doctorId, tenantId, deletedAt: null },
        select: REPORTING_DOCTOR_SELECT,
      })) as ReportingDoctorTagSource | null;
      doctorCache.set(doctorId, doctor);
      return doctor;
    };

    const reports = await Promise.all(
      ordered.map(async (study) => {
        const order = await getOrder(study.orderId);
        const patient = await getPatient(order?.patientId ?? null);
        const bill = await getBill(study.orderId);
        const doctor = await getDoctor(study.reportingDoctorId);
        const body = await this.resolveBody(tenantId, study);
        return {
          // The study's report body — issued certificate HTML, else narrative.
          body_html: body,
          study_no: study.studyNo,
          test_name: study.radiologyTestName ?? '',
          modality: study.modality ?? '',
          body_part: study.bodyPart ?? '',
          view: study.view ?? '',
          findings: study.findings ?? '',
          impression: study.impression ?? '',
          recommendation: study.recommendation ?? '',
          report_date: isoDate(study.publishedAt ?? study.reportedAt),
          // This study's own patient (selection may span patients).
          patient: {
            full_name: patientFullName(patient),
            salutation: patient?.salutation ?? '',
            age: patientAge(patient),
            gender: patient?.gender ?? '',
            phone: patient?.mobile ?? '',
            uhid: patient?.umId ?? '',
          },
          order_code: order?.orderCode ?? '',
          external_order_id: order?.externalOrderId ?? '',
          order_date_time: str(bill.order_date_time),
          order_id_barcode: code128DataUri(order?.orderCode),
          refer_by_name: str(bill.referred_by) || ' -- ',
          referring_panel_name: str(bill.referral_panel) || ' -- ',
          // Full billing figures (same values as the Billings screen / bill PDF).
          gross_amount: str(bill.gross_amount),
          discount_amount: str(bill.discount_amount),
          net_amount: str(bill.net_amount),
          paid_amount: str(bill.paid_amount),
          balance_amount: str(bill.balance_amount),
          reporting_doctor: reportingDoctorObject(doctor),
        };
      }),
    );

    // Two DISTINCT, self-contained body tags — each renders EVERY selected
    // study's report body in one token, no `{foreach}` authoring needed:
    //  • `reports_body`       — all bodies flowing continuously (no forced breaks).
    //  • `reports_body_paged` — every study on a NEW page. Uses `page-break-before`
    //    on all but the first study so there is no trailing blank page.
    const reportsBody = reports.map((r) => r.body_html).join('\n');
    const reportsBodyPaged = reports
      .map(
        (r, i) =>
          `<div${i > 0 ? ' style="page-break-before: always;"' : ''}>${r.body_html}</div>`,
      )
      .join('\n');

    // Top-level header block — from the FIRST study's order (lab parity, handy
    // for single-order selections).
    const first = reports[0]!;
    const headerFields = {
      header_image: '',
      patient: {
        salutation: first.patient.salutation,
        full_name: first.patient.full_name,
      },
      client_age: first.patient.age,
      client_gender: first.patient.gender
        ? String(first.patient.gender).charAt(0).toUpperCase()
        : '',
      client_phone: first.patient.phone,
      client_uhid: first.patient.uhid,
      order_code: first.order_code,
      external_order_id: first.external_order_id,
      sample_source_label: '',
      refer_by_name: first.refer_by_name,
      referring_panel_name: first.referring_panel_name,
      order_date_time: first.order_date_time,
      order_id_barcode: first.order_id_barcode,
    };

    const latteContext: Record<string, unknown> = {
      // Primary collection the body tags iterate (`{foreach $reports as $report}`).
      reports,
      // Lab-parity alias so `{foreach $report_tests->tests as $report}` also works.
      report_tests: { groups: [], tests: reports },
      header_fields: headerFields,
      // Root alias so a bare `{order_code}` resolves in a Latte body too.
      order_code: headerFields.order_code,
      // The two one-shot body tags (`{$reports_body|noescape}` /
      // `{$reports_body_paged|noescape}`).
      reports_body: reportsBody,
      reports_body_paged: reportsBodyPaged,
    };

    // Flat-engine fallback — for a `radiology_all_report` authored in the flat
    // `{{#each reports}}{body_html}{{/each}}` syntax rather than Latte.
    const firstBill = await getBill(ordered[0]!.orderId);
    const flatContext: GeneratePdfDto = {
      variables: {
        ...firstBill,
        report_count: String(reports.length),
        // Same two one-shot body tags for a flat-authored template
        // (`{reports_body}` / `{reports_body_paged}`) — registered as RICH_TEXT
        // keys so they render as HTML, not escaped.
        reports_body: reportsBody,
        reports_body_paged: reportsBodyPaged,
      },
      sections: { reports },
    };

    return this.pdfTemplates.generateLattePdf(
      templateId,
      tenantId,
      latteContext,
      flatContext,
    );
  }

  /** picked → Configuration default → first active `radiology_all_report` → throw. */
  private async resolveTemplateId(
    pickedTemplateId: string | undefined,
    tenantId: string,
    branchId: string | null,
  ): Promise<string> {
    if (pickedTemplateId) {
      const t = await this.prisma.pdfReportTemplate.findFirst({
        where: {
          id: pickedTemplateId,
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
      RADIOLOGY_ALL_REPORT_SLOT,
    );
    if (configured) {
      return configured;
    }
    const first = await this.prisma.pdfReportTemplate.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        type: RADIOLOGY_ALL_REPORT_SLOT,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (first) {
      return first.id;
    }
    throw new NoRadiologyAllReportTemplateException();
  }

  /** A study's report body: newest issued certificate HTML, else narrative. */
  private async resolveBody(
    tenantId: string,
    study: StudyRow,
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
}

/** Study columns the combined report reads. */
const STUDY_SELECT = {
  id: true,
  orderId: true,
  branchId: true,
  reportingDoctorId: true,
  studyNo: true,
  radiologyTestName: true,
  modality: true,
  bodyPart: true,
  view: true,
  findings: true,
  impression: true,
  recommendation: true,
  publishedAt: true,
  reportedAt: true,
} as const;

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
