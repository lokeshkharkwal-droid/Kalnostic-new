import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { RadiologyTestModule } from '../radiology-test/radiology-test.module';
import { RadiologyPanelController } from './radiology-panel.controller';
import { RadiologyPanelOptionsController } from './radiology-panel-options.controller';
import { SiteAdminRadiologyPanelController } from './siteadmin-radiology-panel.controller';
import { RadiologyPanelService } from './radiology-panel.service';

/**
 * Radiology Panel feature module. Tenant-scoped + branch-level radiology-panel
 * configuration living inside a master data; a panel groups several radiology
 * tests (managed nested via `RadiologyPanelTest`). Imports `MasterDataModule` to
 * validate the parent master data and `RadiologyTestModule` to validate/clone the
 * referenced radiology tests (rule #3 — DI, not a direct file import); both are
 * one-way dependencies, so no cycle. Exports the service so the
 * branch-radiology-panel module can read source panels with the same semantics.
 */
@Module({
  imports: [PrismaModule, MasterDataModule, RadiologyTestModule],
  controllers: [
    RadiologyPanelController,
    RadiologyPanelOptionsController,
    SiteAdminRadiologyPanelController,
  ],
  providers: [RadiologyPanelService],
  exports: [RadiologyPanelService],
})
export class RadiologyPanelModule {}
