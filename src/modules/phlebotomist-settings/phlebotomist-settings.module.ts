import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PhlebotomistSettingsController } from './phlebotomist-settings.controller';
import { PhlebotomistSettingsService } from './phlebotomist-settings.service';

/**
 * Registration › Phlebotomist Settings module. Tenant-scoped + branch-level.
 * Imports `BranchModule` to validate the active branch before reading/saving
 * its settings (`BranchService.findById`).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [PhlebotomistSettingsController],
  providers: [PhlebotomistSettingsService],
  exports: [PhlebotomistSettingsService],
})
export class PhlebotomistSettingsModule {}
