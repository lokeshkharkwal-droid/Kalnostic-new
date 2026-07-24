import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { LabReportController } from './lab-report.controller';
import { LabReportService } from './lab-report.service';
import { LabReportDirectoryService } from './lab-report-directory.service';
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
  imports: [PrismaModule, PdfReportTemplateModule],
  controllers: [
    LabReportController,
    ReRunController,
    CriticalAlertController,
    OutOfRangeController,
    DeltaCheckController,
    ScheduledTestController,
    InventoryUsageController,
  ],
  providers: [
    LabReportService,
    LabReportDirectoryService,
    ReRunService,
    CriticalAlertService,
    OutOfRangeService,
    DeltaCheckService,
    ScheduledTestService,
    InventoryUsageService,
    MultiStepProcessService,
  ],
  exports: [LabReportService],
})
export class LabReportModule {}
