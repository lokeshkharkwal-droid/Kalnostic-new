import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologyMasterDataModule } from '../radiology-master-data/radiology-master-data.module';
import { RadiologyTestModule } from '../radiology-test/radiology-test.module';
import { RadiologyPanelController } from './radiology-panel.controller';
import { RadiologyPanelOptionsController } from './radiology-panel-options.controller';
import { SiteAdminRadiologyPanelController } from './siteadmin-radiology-panel.controller';
import { RadiologyMasterDataSyncController } from './radiology-master-data-sync.controller';
import { RadiologyPanelService } from './radiology-panel.service';

/**
 * Radiology Panel feature module. Tenant-scoped + branch-level radiology-panel
 * configuration (the panel plus its included tests), living inside a master data.
 * Imports `RadiologyMasterDataModule` and `RadiologyTestModule` (rule #3 — DI); the
 * latter is reused when adopting a SITE_ADMIN template panel and for the
 * Tenant→Branch sync — one-way dependencies, so no cycle.
 */
@Module({
  imports: [PrismaModule, RadiologyMasterDataModule, RadiologyTestModule],
  controllers: [
    RadiologyPanelOptionsController,
    RadiologyPanelController,
    SiteAdminRadiologyPanelController,
    RadiologyMasterDataSyncController,
  ],
  providers: [RadiologyPanelService],
  exports: [RadiologyPanelService],
})
export class RadiologyPanelModule {}
