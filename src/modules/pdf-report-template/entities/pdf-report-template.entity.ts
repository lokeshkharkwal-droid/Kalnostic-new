import { PdfReportTemplate } from '@prisma/client';

/**
 * Domain/response shape for a PDF report template (the Prisma model is the DB
 * source of truth). The `meta` field is stored as JSON; its validated shape is
 * `PdfTemplateMetaDto`.
 */
export type PdfReportTemplateEntity = PdfReportTemplate;
