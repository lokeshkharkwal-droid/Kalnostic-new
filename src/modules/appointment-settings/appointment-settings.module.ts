import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { AppointmentSettingsController } from './appointment-settings.controller';
import { AppointmentSettingsService } from './appointment-settings.service';

/**
 * Registration › Appointment Settings module. Tenant-scoped + branch-level.
 * Imports `BranchModule` to validate the active branch before reading/saving
 * its settings (`BranchService.findById`).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [AppointmentSettingsController],
  providers: [AppointmentSettingsService],
  exports: [AppointmentSettingsService],
})
export class AppointmentSettingsModule {}
