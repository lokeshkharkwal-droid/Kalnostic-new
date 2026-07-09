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
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import type { Response } from 'express';
import { PdfReportTemplateService } from './pdf-report-template.service';
import { CreatePdfReportTemplateDto } from './dto/create-pdf-report-template.dto';
import { UpdatePdfReportTemplateDto } from './dto/update-pdf-report-template.dto';
import { ListPdfReportTemplateQueryDto } from './dto/list-pdf-report-template-query.dto';
import { GeneratePdfDto } from './dto/generate-pdf.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import {
  PDF_REPORT_TEMPLATE_TYPES,
  PDF_REPORT_TEMPLATE_TYPE_LABELS,
  PdfReportTemplateType,
} from './constants/pdf-report-template-types.constant';

/**
 * PDF report template endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes. Controllers stay thin —
 * the service holds all logic; the `ResponseInterceptor` builds the envelope
 * (except `generate`, which streams a raw PDF via a library-specific response).
 */
@Controller('pdf-report-templates')
export class PdfReportTemplateController {
  constructor(private readonly service: PdfReportTemplateService) {}

  /**
   * Create a PDF report template in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.PDF_REPORT_TEMPLATE,
    action: AuditAction.CREATE,
    description: 'Created a PDF report template',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePdfReportTemplateDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  /**
   * List templates in the caller's tenant (paginated; optional `search`, `type`,
   * `status`, and `branchId` filters).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPdfReportTemplateQueryDto,
  ) {
    return this.service.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      {
        search: query.search,
        type: query.type,
        status: query.status,
        branchId: query.branchId,
      },
    );
  }

  /**
   * List the supported template type keys + labels for the frontend select.
   * Declared before `:id` so it isn't captured as an id.
   */
  @Get('options/types')
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
   * Fetch one template by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(id, tenantId);
  }

  /**
   * Update a template.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.PDF_REPORT_TEMPLATE,
    action: AuditAction.UPDATE,
    description: 'Updated a PDF report template',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePdfReportTemplateDto,
  ) {
    return this.service.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a template.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.PDF_REPORT_TEMPLATE,
    action: AuditAction.DELETE,
    description: 'Deleted a PDF report template',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(id, tenantId);
  }

  /**
   * Render a template to a PDF and stream it back (`application/pdf`). Uses a
   * library-specific response so the `ResponseInterceptor` does not wrap the
   * binary in the JSON envelope.
   */
  @Post(':id/generate')
  @Audit({
    module: AuditModule.PDF_REPORT_TEMPLATE,
    action: AuditAction.OTHER,
    description: 'Generated a PDF from a report template',
  })
  async generate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: GeneratePdfDto,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.generatePdf(id, tenantId, dto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${id}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
