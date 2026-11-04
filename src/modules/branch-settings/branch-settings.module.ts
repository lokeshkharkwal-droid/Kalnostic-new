import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TechnicianSettingsModule } from '../technician-settings/technician-settings.module';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService } from './branch-settings.service';
import { QrCodeScanSettingsService } from './qr-code-scan-settings.service';

/**
 * Branch Admin › Branch Settings module. Tenant-scoped + branch-level, behind
 * Branch Admin permissions. Holds:
 *  - Report Printing — reads/saves the branch's report-printing switches through
 *    `TechnicianSettingsService` (which owns the `technician_settings` table).
 *  - QR Code Scan — reads/saves the branch's own `qr_code_scan_settings` row
 *    (`QrCodeScanSettingsService`); `BranchModule` validates the active branch,
 *    `PrismaModule` owns the table.
 */
@Module({
  imports: [
    PrismaModule,
    BranchModule,
    TechnicianSettingsModule,
    PermissionsModule,
  ],
  controllers: [BranchSettingsController],
  providers: [BranchSettingsService, QrCodeScanSettingsService],
  exports: [BranchSettingsService, QrCodeScanSettingsService],
})
export class BranchSettingsModule {}
