import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpdMasterDataModule } from '../opd-master-data/opd-master-data.module';
import { OpdTestModule } from '../opd-test/opd-test.module';
import { OpdPanelController } from './opd-panel.controller';
import { OpdPanelOptionsController } from './opd-panel-options.controller';
import { SiteAdminOpdPanelController } from './siteadmin-opd-panel.controller';
import { OpdMasterDataSyncController } from './opd-master-data-sync.controller';
import { OpdPanelService } from './opd-panel.service';

/**
 * Opd Panel feature module. Tenant-scoped + branch-level opd-panel
 * configuration (the panel plus its included tests), living inside a master data.
 * Imports `OpdMasterDataModule` and `OpdTestModule` (rule #3 — DI); the
 * latter is reused when adopting a SITE_ADMIN template panel and for the
 * Tenant→Branch sync — one-way dependencies, so no cycle.
 */
@Module({
  imports: [PrismaModule, OpdMasterDataModule, OpdTestModule],
  controllers: [
    OpdPanelOptionsController,
    OpdPanelController,
    SiteAdminOpdPanelController,
    OpdMasterDataSyncController,
  ],
  providers: [OpdPanelService],
  exports: [OpdPanelService],
})
export class OpdPanelModule {}
