import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { TechnicianSettingsModule } from '../technician-settings/technician-settings.module';
import { LabTestModule } from '../lab-test/lab-test.module';
import { CommunicationModule } from '../communication/communication.module';
import { TemplateModule } from '../template/template.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { LabReportController } from './lab-report.controller';
import { LabReportService } from './lab-report.service';
import { LabReportAttachmentController } from './lab-report-attachment.controller';
import { LabReportAttachmentService } from './lab-report-attachment.service';
import { LabReportDirectoryService } from './lab-report-directory.service';
import { TatAdjustmentController } from './tat-adjustment.controller';
import { TatAdjustmentService } from './tat-adjustment.service';
import { ReRunController } from './re-run.controller';
import { ReRunService } from './re-run.service';
import { CriticalAlertController } from './critical-alert.controller';
import { CriticalAlertService } from './critical-alert.service';
import { OutOfRangeController } from './out-of-range.controller';
import { OutOfRangeService } from './out-of-range.service';
import { DeltaCheckController } from './delta-check.controller';
import { DeltaCheckService } from './delta-check.service';
import { ScheduledTestController } from './scheduled-test.controller';
import { ScheduledTestService } from './scheduled-test.service';
import { InventoryUsageController } from './inventory-usage.controller';
import { InventoryUsageService } from './inventory-usage.service';
import { MultiStepProcessService } from './multi-step-process.service';
import { TatService } from './tat.service';
import { NablTatCronService } from './nabl-tat-cron.service';

/**
 * Technician Reporting feature module (LABORATORY.docx). Exports
 * `LabReportService` so `AccessionModule` can call
 * `ensureCreatedForAcceptedItem` when a sample reaches `ACCEPTED` (CLAUDE.md
 * rule #3 — services injected, never imported directly) without a circular
 * module dependency: `AccessionModule` imports `LabReportModule`, not the
 * reverse.
 *
 * Controllers are ordered core (worklist/entry/gates) → the five special
 * worklists → so the static sub-paths (`re-run-requests`, `critical-alerts`,
 * etc.) each own their own top-level path, distinct from `lab-reports/:id`'s
 * per-test raise-actions.
 *
 * Imports `PdfReportTemplateModule` for Print/Download (LABORATORY.docx
 * §6.10) — that module's PDF engine already exists and works but is
 * "decoupled from the lab-result models" (its own doc comment); this module
 * supplies the missing bridge via `LabReportService.print`/`buildPrintContext`.
 */
@Module({
  imports: [
    PrismaModule,
    PdfReportTemplateModule,
    TechnicianSettingsModule,
    LabTestModule,
    CommunicationModule,
    TemplateModule,
    PermissionsModule,
  ],
  controllers: [
    LabReportController,
    LabReportAttachmentController,
    TatAdjustmentController,
    ReRunController,
    CriticalAlertController,
    OutOfRangeController,
    DeltaCheckController,
    ScheduledTestController,
    InventoryUsageController,
  ],
  providers: [
    LabReportService,
    LabReportAttachmentService,
    LabReportDirectoryService,
    TatAdjustmentService,
    ReRunService,
    CriticalAlertService,
    OutOfRangeService,
    DeltaCheckService,
    ScheduledTestService,
    InventoryUsageService,
    MultiStepProcessService,
    TatService,
    NablTatCronService,
  ],
  exports: [LabReportService],
})
export class LabReportModule {}
