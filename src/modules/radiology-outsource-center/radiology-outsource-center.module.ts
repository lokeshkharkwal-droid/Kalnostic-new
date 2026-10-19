import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchRadiologyTestListModule } from '../branch-radiology-test-list/branch-radiology-test-list.module';
import { BranchRadiologyPanelListModule } from '../branch-radiology-panel-list/branch-radiology-panel-list.module';
import { RadiologyOutsourceCenterController } from './radiology-outsource-center.controller';
import { RadiologyOutsourceCenterService } from './radiology-outsource-center.service';

/**
 * Radiology Outsource-Center feature module. Tenant-scoped, tenant-level. The model
 * is FLAT — unlike the diagnostics `OutsourceCenter` it has no contacts/documents
 * child tables. Imports the branch Radiology Test/Panel List modules to validate
 * the assigned-list logical refs against the active branch via their exported
 * services (CLAUDE.md rule #3 — DI, never a direct file import). Exports the
 * service so a future radiology-routing module can resolve a center's assigned
 * radiology test/panel.
 */
@Module({
  imports: [
    PrismaModule,
    BranchRadiologyTestListModule,
    BranchRadiologyPanelListModule,
  ],
  controllers: [RadiologyOutsourceCenterController],
  providers: [RadiologyOutsourceCenterService],
  exports: [RadiologyOutsourceCenterService],
})
export class RadiologyOutsourceCenterModule {}
