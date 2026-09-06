import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PDFOptions } from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { PdfService } from '../pdf/pdf.service';
import {
  TemplateRenderService,
  extractImageTokens,
  PreparedPdfHtml,
} from './services/template-render.service';
import { LatteReportRenderService } from './services/latte-render.service';
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
    private readonly latteRenderService: LatteReportRenderService,
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
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const created = await tx.pdfReportTemplate.create({
          data: {
            tenantId,
            branchId: dto.branchId ?? null,
            type,
            name: dto.name.trim(),
            isActive: dto.isActive ?? true,
            meta: meta,
            doc: dto.doc ? (dto.doc as Prisma.InputJsonValue) : undefined,
          },
        });
        // Register this template's uploaded images so their `{{image:<id>}}`
        // tokens are reusable in other templates (see syncImageRegistry).
        await this.syncImageRegistry(tx, tenantId, meta);
        return created;
      });
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
    const meta =
      dto.meta !== undefined ? this.normalizeMeta(dto.meta) : undefined;
    if (meta !== undefined) {
      data.meta = meta;
    }
    if (dto.doc !== undefined) {
      data.doc = dto.doc as Prisma.InputJsonValue;
    }
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const updated = await tx.pdfReportTemplate.update({
          where: { id },
          data,
        });
        // Keep the reusable-image registry in sync with the saved meta.images.
        if (meta !== undefined) {
          await this.syncImageRegistry(tx, tenantId, meta);
        }
        return updated;
      });
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
    const context2 = await this.withRegistryImages(tenantId, meta, context);
    const prepared = this.renderService.render(meta, context2);
    try {
      return await this.pdfService.htmlToPdf(
        prepared.bodyHtml,
        this.metaToPdfOptions(meta, prepared),
      );
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  /**
   * Render a `lab_all_report`-type template to a PDF using the Latte engine and
   * an order-scoped `report_tests`/`header_fields` context (see
   * {@link LatteReportRenderService}). Unlike {@link generatePdf} the whole order
   * is one continuous document — the template iterates every test and manages its
   * own per-test page headers/breaks — so there is no `pdf-lib` merge.
   * @param id template id (must be a `lab_all_report` template)
   * @param tenantId tenant scope
   * @param context the Latte data (`report_tests`, `header_fields`)
   * @returns the generated PDF bytes
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   * @throws PdfGenerationFailedException if rendering fails
   */
  async generateLattePdf(
    id: string,
    tenantId: string,
    context: Record<string, unknown>,
  ): Promise<Buffer> {
    const template = await this.findById(id, tenantId);
    const meta = this.readMeta(template.meta);
    const prepared = this.latteRenderService.render(meta, context);
    try {
      return await this.pdfService.htmlToPdf(
        prepared.bodyHtml,
        this.metaToPdfOptions(meta, prepared),
      );
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  /**
   * Read a template's `type` (used to decide whether "Print All Reports" should
   * route through the Latte all-reports path or the legacy per-report merge).
   * @throws PdfReportTemplateNotFoundException if missing/soft-deleted
   */
  async getType(id: string, tenantId: string): Promise<PdfReportTemplateType> {
    const template = await this.findById(id, tenantId);
    return this.assertType(template.type);
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
      const created = await this.prisma.pdfReportTemplate.create({
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
      // Register images under the global (NULL-tenant) registry so their tokens
      // are reusable across global templates.
      await this.syncImageRegistry(this.prisma, null, meta);
      return created;
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
    const meta =
      dto.meta !== undefined ? this.normalizeMeta(dto.meta) : undefined;
    if (meta !== undefined) {
      data.meta = meta;
    }
    if (dto.doc !== undefined) {
      data.doc = dto.doc as Prisma.InputJsonValue;
    }
    try {
      const updated = await this.prisma.pdfReportTemplate.update({
        where: { id },
        data,
      });
      if (meta !== undefined) {
        await this.syncImageRegistry(this.prisma, null, meta);
      }
      return updated;
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
    const context2 = await this.withRegistryImages(null, meta, context);
    const prepared = this.renderService.render(meta, context2);
    try {
      return await this.pdfService.htmlToPdf(
        prepared.bodyHtml,
        this.metaToPdfOptions(meta, prepared),
      );
    } catch (e) {
      throw new PdfGenerationFailedException(id, (e as Error).message);
    }
  }

  /**
   * Clone a SITE_ADMIN global PDF report template into the caller's tenant.
   * Idempotent: a template already cloned into the tenant returns the existing
   * copy (matched on `clonedFromId`). The clone keeps the source
   * name/type/meta/doc, is tenant-wide (`branchId` null), and records
   * `clonedFromId`. Runs inside `withTenant` — the pdf_report_templates RLS
   * policy permits reading the NULL-tenant source while a tenant GUC is set.
   * @param id the SITE_ADMIN global template to clone
   * @param tenantId caller's tenant (from JWT)
   * @returns the tenant template (existing clone or newly created)
   * @throws PdfReportTemplateNotFoundException if the source isn't a live global template
   * @throws PdfReportTemplateNameConflictException if the name clashes with an
   *   existing active tenant template
   */
  async cloneToTenant(
    id: string,
    tenantId: string,
  ): Promise<PdfReportTemplateEntity> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.pdfReportTemplate.findFirst({
        where: { tenantId, clonedFromId: id, deletedAt: null },
      });
      if (existing) {
        return existing;
      }
      const source = await tx.pdfReportTemplate.findFirst({
        where: { id, tenantId: null, deletedAt: null },
      });
      if (!source) {
        throw new PdfReportTemplateNotFoundException(id);
      }
      try {
        return await tx.pdfReportTemplate.create({
          data: {
            tenantId,
            branchId: null,
            clonedFromId: id,
            type: source.type,
            name: source.name,
            isActive: source.isActive,
            meta: source.meta as Prisma.InputJsonValue,
            doc:
              source.doc === null
                ? undefined
                : (source.doc as Prisma.InputJsonValue),
          },
        });
      } catch (e) {
        this.rethrowUniqueViolation(e, source.name);
        throw e;
      }
    });
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
   * Persist a template's uploaded images into the durable, tenant-wide
   * `PrintTemplateImage` registry so their `{{image:<id>}}` tokens become
   * REUSABLE across templates (a token copied from one template resolves when
   * pasted into another). Upserts every `meta.images` entry `[token → url]` and
   * resurrects a soft-deleted row. Rows are never removed when a template is
   * deleted/edited, so an image referenced elsewhere stays resolvable.
   *
   * A nullable `tenantId` participates in the `@@unique([tenantId, token])`, and
   * Prisma rejects `null` in a compound-unique `upsert` where-key, so this
   * find-then-write is used instead. A P2002 on create is a benign concurrent
   * race (the same token was inserted first) and is ignored.
   *
   * @param client a Prisma client/transaction (tenant path: a `withTenant` tx;
   *   global path: the base client) — reads/writes obey the row's RLS policy.
   * @param tenantId owning tenant, or `null` for a SITE_ADMIN global-template image
   * @param meta the normalized meta whose `images` map is being registered
   */
  private async syncImageRegistry(
    client: Prisma.TransactionClient,
    tenantId: string | null,
    meta: PdfTemplateMeta,
  ): Promise<void> {
    const images = meta.images ?? {};
    for (const [token, url] of Object.entries(images)) {
      if (!token || !url) {
        continue;
      }
      const existing = await client.printTemplateImage.findFirst({
        where: { tenantId, token },
        select: { id: true },
      });
      if (existing) {
        await client.printTemplateImage.update({
          where: { id: existing.id },
          data: { url, deletedAt: null },
        });
        continue;
      }
      try {
        await client.printTemplateImage.create({
          data: { tenantId, token, url },
        });
      } catch (e) {
        if (
          !(
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          )
        ) {
          throw e;
        }
      }
    }
  }

  /**
   * Build the render context, back-filling any `{{image:<id>}}` token referenced
   * in the template's header/body/footer that isn't in the template's own
   * `meta.images` from the tenant-wide `PrintTemplateImage` registry — this is
   * what makes a pasted token from another template resolve. Registry hits are
   * merged UNDER a caller-supplied `context.images` (runtime images still win),
   * and only cover the missing tokens so they never shadow the template's own
   * `meta.images` (which `render` applies).
   * @param tenantId tenant scope, or `null` for a global template
   * @param meta the template's normalized meta
   * @param context the incoming render context
   * @returns a context whose `images` includes resolved registry tokens
   */
  private async withRegistryImages(
    tenantId: string | null,
    meta: PdfTemplateMeta,
    context: GeneratePdfDto,
  ): Promise<GeneratePdfDto> {
    const referenced = extractImageTokens(
      meta.header_html,
      meta.body_html,
      meta.footer_html,
    );
    const own = meta.images ?? {};
    const missing = referenced.filter((id) => !(id in own));
    if (!missing.length) {
      return context;
    }
    const rows = await this.prisma.printTemplateImage.findMany({
      where: { tenantId, token: { in: missing }, deletedAt: null },
      select: { token: true, url: true },
    });
    if (!rows.length) {
      return context;
    }
    const registry = Object.fromEntries(rows.map((r) => [r.token, r.url]));
    return { ...context, images: { ...registry, ...(context.images ?? {}) } };
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

  /**
   * Map the template's page settings to Puppeteer PDF options. The top/bottom
   * page margins reserve the bands into which Chromium paints the header/footer
   * templates on every page; `displayHeaderFooter` is enabled only when the
   * template actually has header/footer content (else a plain body-only PDF).
   */
  private metaToPdfOptions(
    meta: PdfTemplateMeta,
    prepared: PreparedPdfHtml,
  ): PDFOptions {
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
      displayHeaderFooter: prepared.hasHeaderFooter,
      headerTemplate: prepared.headerTemplate,
      footerTemplate: prepared.footerTemplate,
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
