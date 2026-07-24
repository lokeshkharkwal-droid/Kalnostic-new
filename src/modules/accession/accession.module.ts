import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { LabReportModule } from '../lab-report/lab-report.module';
import { AccessionController } from './accession.controller';
import { SampleTransferController } from './sample-transfer.controller';
import { AccessionSettingsController } from './accession-settings.controller';
import { AccessionReportController } from './accession-report.controller';
import { AccessionSampleService } from './accession-sample.service';
import { SampleTransferService } from './sample-transfer.service';
import { AccessionSettingsService } from './accession-settings.service';
import { AccessionReportService } from './accession-report.service';

/**
 * Accession module — the sample-lifecycle hub (post-order). Tenant-scoped +
 * branch-level. Exports `AccessionSampleService` so the order module can generate
 * an order's samples when it is confirmed, via DI (CLAUDE.md rule #3). Imports
 * `BranchModule` to validate transfer destinations + settings branches, and
 * `LabReportModule` so a sample reaching `ACCEPTED` (either via the in-house
 * state machine or RULE 1's internal-transfer clone) can create the
 * corresponding Technician Reporting `LabReport` rows via
 * `LabReportService.ensureCreatedForAcceptedItem` — the real trigger, replacing
 * the old interim `OrderService.collectItem` signal.
 *
 * Phase 0/1: sample entity + generation hook + §A.9 In-House state machine.
 * Phase 2/3: `SampleTransferService` (Internal/External referral + Outsource).
 * Phase 4: `AccessionSettingsService` (per-branch §G settings) and
 * `AccessionReportService` (Part F exception reports).
 */
@Module({
  imports: [PrismaModule, BranchModule, LabReportModule],
  controllers: [
    AccessionController,
    SampleTransferController,
    AccessionSettingsController,
    AccessionReportController,
  ],
  providers: [
    AccessionSampleService,
    SampleTransferService,
    AccessionSettingsService,
    AccessionReportService,
  ],
  exports: [AccessionSampleService],
})
export class AccessionModule {}
