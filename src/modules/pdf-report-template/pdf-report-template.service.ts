import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PDFOptions } from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { PdfService } from '../pdf/pdf.service';
import { TemplateRenderService } from './services/template-render.service';
import { CreatePdfReportTemplateDto } from './dto/create-pdf-report-template.dto';
import { UpdatePdfReportTemplateDto } from './dto/update-pdf-report-template.dto';
import { GeneratePdfDto } from './dto/generate-pdf.dto';
import { PdfTemplateMetaDto } from './dto/pdf-template-meta.dto';
import { PdfReportTemplateEntity } from './entities/pdf-report-template.entity';
import {
  DEFAULT_PDF_REPORT_TEMPLATE_TYPE,
  isPdfReportTemplateType,
  PdfReportTemplateType,
} from './constants/pdf-report-template-types.constant';
import {
  PdfTemplateMeta,
  PDF_TEMPLATE_META_DEFAULTS,
} from './constants/pdf-template-meta.constant';
import {
  InvalidPdfReportTemplateTypeException,
  PdfGenerationFailedException,
  PdfReportTemplateNameConflictException,
  PdfReportTemplateNotFoundException,
} from './exceptions/pdf-report-template.exceptions';
import type { AdvanceDocument } from './advance/types';
import {
  buildAdvancePdfRender,
  renderAdvanceDocumentToHtml,
} from './advance/renderer';
import {
  defaultDocument,
  sampleContext,
  toAdvanceContextType,
} from './advance/sample-context';

/**
 * PDF report template management. Tenant-scoped, branch-level (CLAUDE.md §4.6).
 * Every query carries `tenantId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows. Page + section settings live in the `meta` JSON,
 * always persisted complete (client partial merged over defaults). PDF rendering
 * delegates to `TemplateRenderService` (placeholders) + `PdfService` (Puppeteer).
 */
@Injectable()
export class PdfReportTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
    private readonly pdfService: PdfService,
    private readonly renderService: TemplateRenderService,
  ) {}

  /**
   * Create a PDF report template in a tenant. The `branchId` (if supplied) is
   * validated against the caller's tenant first (§4.7); `meta` is merged over
   * the defaults so the stored blob is always complete.
   * @param tenantId owning tenant
   * @param dto validated payload (no `tenantId` — from context)
   * @returns the created template
   * @throws BranchNotFoundException if `branchId` isn't an active branch of the tenant
   * @throws PdfReportTemplateNameConflictException if the name is already used by
   *   an active template in this tenant
   */
  async create(
    tenantId: string,
    dto: CreatePdfReportTemplateDto,
  ): Promise<PdfReportTemplateEntity> {
    const type = this.assertType(dto.type ?? DEFAULT_PDF_REPORT_TEMPLATE_TYPE);
    if (dto.branchId) {
      await this.branchService.findById(dto.branchId, tenantId);
    }
    const meta = this.normalizeMeta(dto.meta);
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.pdfReportTemplate.create({
          data: {
            tenantId,
            branchId: dto.branchId ?? null,
            type,
            name: dto.name.trim(),
            isActive: dto.isActive ?? true,
            meta: meta,
            doc: dto.doc ? (dto.doc as Prisma.InputJsonValue) : undefined,
          },
        }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * List active PDF report templates for a tenant (offset pagination).
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (name), `type`,
   *   active/inactive `status`, and `branchId` filters
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      type?: PdfReportTemplateType;
      status?: 'ACTIVE' | 'INACTIVE';
      branchId?: string;
    } = {},
  ): Promise<PaginatedResult<PdfReportTemplateEntity>> {
    const where: Prisma.PdfReportTemplateWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const data = await this.prisma.pdfReportTemplate.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.pdfReportTemplate.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active template scoped to its tenant.
   * @param id template id
   * @param tenantId tenant scope
   * @throws PdfReportTemplateNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<PdfReportTemplateEntity> {
    const template = await this.prisma.pdfReportTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!template) {
      throw new PdfReportTemplateNotFoundException(id);
    }
    return template;
  }

  /**
   * Update a template. A supplied `branchId` is re-validated against the tenant;
   * a supplied `meta` REPLACES the stored blob (re-merged over defaults).
   * @param id template id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   * @throws BranchNotFoundException if a new `branchId` isn't an active branch of the tenant
   * @throws PdfReportTemplateNameConflictException on a name collision
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdatePdfReportTemplateDto,
  ): Promise<PdfReportTemplateEntity> {
    await this.findById(id, tenantId);
    if (dto.branchId) {
      await this.branchService.findById(dto.branchId, tenantId);
    }
    const data: Prisma.PdfReportTemplateUpdateInput = {};
    if (dto.type !== undefined) data.type = this.assertType(dto.type);
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.meta !== undefined) {
      data.meta = this.normalizeMeta(dto.meta);
    }
    if (dto.doc !== undefined) {
      data.doc = dto.doc as Prisma.InputJsonValue;
    }
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.pdfReportTemplate.update({ where: { id }, data }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a template (sets `deletedAt`; the row is preserved).
   * @param id template id
   * @param tenantId tenant scope
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<PdfReportTemplateEntity> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.pdfReportTemplate.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /**
   * Render a template to a PDF buffer: interpolate the supplied context into the
   * header/body/footer HTML (placeholders, images, repeating sections, signing
   * authority tags), then print to PDF with page settings from `meta`.
   * @param id template id
   * @param tenantId tenant scope
   * @param context render data (variables, images, sections, signatories)
   * @returns the generated PDF bytes
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   * @throws PdfGenerationFailedException if rendering fails
   */
  async generatePdf(
    id: string,
    tenantId: string,
    context: GeneratePdfDto,
  ): Promise<Buffer> {
    const template = await this.findById(id, tenantId);
    const meta = this.readMeta(template.meta);
    const html = this.renderService.render(meta, context);
    try {
      return await this.pdfService.htmlToPdf(html, this.metaToPdfOptions(meta));
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  // ── SITE_ADMIN global templates (tenant_id NULL) ─────────────────────────────
  // Global templates are shared across tenants and managed by SiteAdmin. They
  // carry no tenant and no branch, so writes go through the plain Prisma client
  // (no `withTenant` GUC) — the RLS `WITH CHECK` permits NULL-tenant rows only
  // when the connection has no tenant set (mirrors the categories pattern).

  /**
   * Create a global (SITE_ADMIN) PDF report template. `branchId` is forced null
   * (global templates are never branch-scoped); `meta` is merged over defaults.
   * @param dto validated payload
   * @returns the created global template
   * @throws PdfReportTemplateNameConflictException on a name collision
   */
  async createGlobalTemplate(
    dto: CreatePdfReportTemplateDto,
  ): Promise<PdfReportTemplateEntity> {
    const type = this.assertType(dto.type ?? DEFAULT_PDF_REPORT_TEMPLATE_TYPE);
    const meta = this.normalizeMeta(dto.meta);
    try {
      return await this.prisma.pdfReportTemplate.create({
        data: {
          tenantId: null,
          branchId: null,
          type,
          name: dto.name.trim(),
          isActive: dto.isActive ?? true,
          meta: meta,
          doc: dto.doc ? (dto.doc as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * List active global (SITE_ADMIN) templates (offset pagination).
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (name), `type`, `status`
   */
  async findAllGlobal(
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      type?: PdfReportTemplateType;
      status?: 'ACTIVE' | 'INACTIVE';
    } = {},
  ): Promise<PaginatedResult<PdfReportTemplateEntity>> {
    const where: Prisma.PdfReportTemplateWhereInput = {
      tenantId: null,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    const data = await this.prisma.pdfReportTemplate.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.pdfReportTemplate.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one active global (SITE_ADMIN) template.
   * @param id template id
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   */
  async findGlobalById(id: string): Promise<PdfReportTemplateEntity> {
    const template = await this.prisma.pdfReportTemplate.findFirst({
      where: { id, tenantId: null, deletedAt: null },
    });
    if (!template) {
      throw new PdfReportTemplateNotFoundException(id);
    }
    return template;
  }

  /**
   * Update a global (SITE_ADMIN) template. A supplied `meta` REPLACES the stored
   * blob (re-merged over defaults); `branchId` is ignored (always null).
   * @param id template id
   * @param dto partial update
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   * @throws PdfReportTemplateNameConflictException on a name collision
   */
  async updateGlobal(
    id: string,
    dto: UpdatePdfReportTemplateDto,
  ): Promise<PdfReportTemplateEntity> {
    await this.findGlobalById(id);
    const data: Prisma.PdfReportTemplateUpdateInput = {};
    if (dto.type !== undefined) data.type = this.assertType(dto.type);
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.meta !== undefined) {
      data.meta = this.normalizeMeta(dto.meta);
    }
    if (dto.doc !== undefined) {
      data.doc = dto.doc as Prisma.InputJsonValue;
    }
    try {
      return await this.prisma.pdfReportTemplate.update({
        where: { id },
        data,
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a global (SITE_ADMIN) template.
   * @param id template id
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   */
  async removeGlobal(id: string): Promise<PdfReportTemplateEntity> {
    await this.findGlobalById(id);
    return this.prisma.pdfReportTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Render a global (SITE_ADMIN) template to a PDF buffer (see `generatePdf`).
   * @param id template id
   * @param context render data (variables, images, sections, signatories)
   * @returns the generated PDF bytes
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   * @throws PdfGenerationFailedException if rendering fails
   */
  async generateGlobalPdf(
    id: string,
    context: GeneratePdfDto,
  ): Promise<Buffer> {
    const template = await this.findGlobalById(id);
    const meta = this.readMeta(template.meta);
    const html = this.renderService.render(meta, context);
    try {
      return await this.pdfService.htmlToPdf(html, this.metaToPdfOptions(meta));
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  // ── Advance (block-based) rendering ──────────────────────────────────────────
  // Block templates store an `AdvanceDocument` in the `doc` column and are
  // rendered by the ported block renderer against SAMPLE context data (site-admin
  // previews are never bound to a real order). `preview-html` feeds the editor
  // iframe; `renderDocPdf` powers "Open PDF" / the listing preview.

  /**
   * Render a tenant template's block document to preview HTML (sample data).
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   */
  async renderDocHtml(id: string, tenantId: string): Promise<string> {
    const template = await this.findById(id, tenantId);
    return renderAdvanceDocumentToHtml({
      doc: this.readDoc(template.doc),
      context: sampleContext(toAdvanceContextType(template.type)),
    });
  }

  /**
   * Render a tenant template's block document to a PDF buffer (sample data).
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   * @throws PdfGenerationFailedException if rendering fails
   */
  async renderDocPdf(id: string, tenantId: string): Promise<Buffer> {
    const template = await this.findById(id, tenantId);
    return this.docToPdf(id, template.doc, template.type);
  }

  /**
   * Render a global (SITE_ADMIN) template's block document to preview HTML.
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   */
  async renderGlobalDocHtml(id: string): Promise<string> {
    const template = await this.findGlobalById(id);
    return renderAdvanceDocumentToHtml({
      doc: this.readDoc(template.doc),
      context: sampleContext(toAdvanceContextType(template.type)),
    });
  }

  /**
   * Render a global (SITE_ADMIN) template's block document to a PDF buffer.
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted/not global
   * @throws PdfGenerationFailedException if rendering fails
   */
  async renderGlobalDocPdf(id: string): Promise<Buffer> {
    const template = await this.findGlobalById(id);
    return this.docToPdf(id, template.doc, template.type);
  }

  /** Shared block-doc → PDF path (HTML build + Puppeteer via `PdfService`). */
  private async docToPdf(
    id: string,
    docJson: Prisma.JsonValue,
    type: string,
  ): Promise<Buffer> {
    const { html, options } = buildAdvancePdfRender({
      doc: this.readDoc(docJson),
      context: sampleContext(toAdvanceContextType(type)),
    });
    try {
      return await this.pdfService.htmlToPdf(html, options);
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  /**
   * Coerce the stored `doc` JSON back into an `AdvanceDocument`, falling back to
   * the seed document when null/absent (e.g. a classic HTML template opened in
   * the block editor).
   */
  private readDoc(docJson: Prisma.JsonValue): AdvanceDocument {
    if (docJson && typeof docJson === 'object' && !Array.isArray(docJson)) {
      return docJson as unknown as AdvanceDocument;
    }
    return defaultDocument();
  }

  /**
   * Merge a client's partial `meta` over the defaults so the persisted blob
   * always has every key. Undefined values are dropped so they can't clobber a
   * default.
   */
  private normalizeMeta(meta?: PdfTemplateMetaDto): PdfTemplateMeta {
    const provided = Object.fromEntries(
      Object.entries(meta ?? {}).filter(([, v]) => v !== undefined),
    );
    return { ...PDF_TEMPLATE_META_DEFAULTS, ...provided };
  }

  /** Coerce a stored JSON meta value back into a complete meta object. */
  private readMeta(meta: Prisma.JsonValue): PdfTemplateMeta {
    const stored =
      meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    return { ...PDF_TEMPLATE_META_DEFAULTS, ...stored };
  }

  /** Map the template's page settings to Puppeteer PDF options. */
  private metaToPdfOptions(meta: PdfTemplateMeta): PDFOptions {
    return {
      format: meta.page_size as PDFOptions['format'],
      landscape: meta.orientation === 'L',
      printBackground: true,
      margin: {
        top: `${meta.margin_top}mm`,
        right: `${meta.margin_right}mm`,
        bottom: `${meta.margin_bottom}mm`,
        left: `${meta.margin_left}mm`,
      },
    };
  }

  /**
   * Defence-in-depth check that `type` is a supported key (the DTO's `@IsIn`
   * already covers the request path).
   * @throws InvalidPdfReportTemplateTypeException on an unsupported type
   */
  private assertType(type: string): PdfReportTemplateType {
    if (!isPdfReportTemplateType(type)) {
      throw new InvalidPdfReportTemplateTypeException(type);
    }
    return type;
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002) on the
   * per-tenant active-name index, throw the typed 409; otherwise return so the
   * caller can rethrow.
   */
  private rethrowUniqueViolation(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new PdfReportTemplateNameConflictException(name);
    }
  }
}
