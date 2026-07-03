import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PdfReportTemplateService } from './pdf-report-template.service';
import { CreatePdfReportTemplateDto } from './dto/create-pdf-report-template.dto';
import { UpdatePdfReportTemplateDto } from './dto/update-pdf-report-template.dto';
import { ListPdfReportTemplateQueryDto } from './dto/list-pdf-report-template-query.dto';
import { GeneratePdfDto } from './dto/generate-pdf.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import {
  PDF_REPORT_TEMPLATE_TYPES,
  PDF_REPORT_TEMPLATE_TYPE_LABELS,
  PdfReportTemplateType,
} from './constants/pdf-report-template-types.constant';

/**
 * SiteAdmin global PDF report **template** management
 * (`/siteadmin/pdf-report-templates`). Templates carry no tenant (`tenant_id`
 * NULL) and no branch — they are shared across every business. Businesses can
 * later adopt them; SiteAdmin owns the definitions here.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/pdf-report-templates')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminPdfReportTemplateController {
  constructor(private readonly service: PdfReportTemplateService) {}

  /**
   * Create a global PDF report template.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreatePdfReportTemplateDto) {
    return this.service.createGlobalTemplate(dto);
  }

  /**
   * List global templates (paginated; optional `search`, `type`, `status`).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListPdfReportTemplateQueryDto) {
    return this.service.findAllGlobal(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      type: query.type,
      status: query.status,
    });
  }

  /**
   * List the supported template type keys + labels for the frontend select.
   * Declared before `:id` so it isn't captured as an id.
   */
  @Get('options/types')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  listTypes(): {
    types: readonly PdfReportTemplateType[];
    labels: Record<PdfReportTemplateType, string>;
  } {
    return {
      types: PDF_REPORT_TEMPLATE_TYPES,
      labels: PDF_REPORT_TEMPLATE_TYPE_LABELS,
    };
  }

  /**
   * Fetch one global template by id.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.service.findGlobalById(id);
  }

  /**
   * Update a global template.
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdatePdfReportTemplateDto) {
    return this.service.updateGlobal(id, dto);
  }

  /**
   * Soft-delete a global template.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.service.removeGlobal(id);
  }

  /**
   * Render a global template to a PDF and stream it back (`application/pdf`).
   * Uses a library-specific response so the `ResponseInterceptor` does not wrap
   * the binary in the JSON envelope.
   */
  @Post(':id/generate')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  async generate(
    @Param('id') id: string,
    @Body() dto: GeneratePdfDto,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.generateGlobalPdf(id, dto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${id}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /**
   * Render the template's block document (`doc`) to preview HTML against sample
   * data, for the Advance PDF editor's live iframe. Returns raw `text/html` (a
   * library-specific response) so the `ResponseInterceptor` does not wrap it in
   * the JSON envelope.
   */
  @Get(':id/preview-html')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  async previewHtml(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.service.renderGlobalDocHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  /**
   * Render the template's block document (`doc`) to a PDF and stream it back
   * (`application/pdf`). This is the block-designer counterpart of `generate`
   * (which renders the classic HTML `meta` model).
   */
  @Post(':id/render')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  async render(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const pdf = await this.service.renderGlobalDocPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${id}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
