import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
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

/**
 * Technician Reporting feature module (LABORATORY.docx). Exports
 * `LabReportService` so `OrderModule` can call `ensureCreatedForAcceptedItem`
 * from `OrderService.collectItem` (CLAUDE.md rule #3 — services injected, never
 * imported directly) without a circular module dependency: `OrderModule`
 * imports `LabReportModule`, not the reverse.
 *
 * Controllers are ordered core (worklist/entry/gates) → the five special
 * worklists → so the static sub-paths (`re-run-requests`, `critical-alerts`,
 * etc.) each own their own top-level path, distinct from `lab-reports/:id`'s
 * per-test raise-actions.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    LabReportController,
    ReRunController,
    CriticalAlertController,
    OutOfRangeController,
    DeltaCheckController,
    ScheduledTestController,
  ],
  providers: [
    LabReportService,
    LabReportDirectoryService,
    ReRunService,
    CriticalAlertService,
    OutOfRangeService,
    DeltaCheckService,
    ScheduledTestService,
  ],
  exports: [LabReportService],
})
export class LabReportModule {}
