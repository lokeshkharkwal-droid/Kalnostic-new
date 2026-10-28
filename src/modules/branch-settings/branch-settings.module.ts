import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { TechnicianSettingsModule } from '../technician-settings/technician-settings.module';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService } from './branch-settings.service';

/**
 * Branch Admin › Branch Settings module. Tenant-scoped + branch-level: it reads and
 * saves the branch's report-printing switches through `TechnicianSettingsService`
 * (which owns the `technician_settings` table), behind Branch Admin permissions.
 */
@Module({
  imports: [TechnicianSettingsModule, PermissionsModule],
  controllers: [BranchSettingsController],
  providers: [BranchSettingsService],
  exports: [BranchSettingsService],
})
export class BranchSettingsModule {}
