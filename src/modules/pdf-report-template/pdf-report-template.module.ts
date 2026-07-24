import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PdfModule } from '../pdf/pdf.module';
import { PdfReportTemplateController } from './pdf-report-template.controller';
import { PdfTemplateConfigController } from './pdf-template-config.controller';
import { SiteAdminPdfReportTemplateController } from './siteadmin-pdf-report-template.controller';
import { PdfReportTemplateService } from './pdf-report-template.service';
import { PdfTemplateConfigService } from './pdf-template-config.service';
import { TemplateRenderService } from './services/template-render.service';

/**
 * PDF report template feature module. Tenant-scoped, branch-level (CLAUDE.md
 * §4.6). Imports `PrismaModule` (DB), `PdfModule` (Puppeteer `PdfService`), and
 * `BranchModule` (validates an optional `branchId` against the tenant, via its
 * exported service — CLAUDE.md rule #3).
 */
@Module({
  imports: [PrismaModule, PdfModule, BranchModule],
  controllers: [
    PdfTemplateConfigController,
    PdfReportTemplateController,
    SiteAdminPdfReportTemplateController,
  ],
  providers: [
    PdfReportTemplateService,
    PdfTemplateConfigService,
    TemplateRenderService,
  ],
  exports: [PdfReportTemplateService],
})
export class PdfReportTemplateModule {}
