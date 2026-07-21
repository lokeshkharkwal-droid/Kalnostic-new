import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
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
 * `BranchModule` to validate transfer destinations + settings branches.
 *
 * Phase 0/1: sample entity + generation hook + §A.9 In-House state machine.
 * Phase 2/3: `SampleTransferService` (Internal/External referral + Outsource).
 * Phase 4: `AccessionSettingsService` (per-branch §G settings) and
 * `AccessionReportService` (Part F exception reports).
 */
@Module({
  imports: [PrismaModule, BranchModule],
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
