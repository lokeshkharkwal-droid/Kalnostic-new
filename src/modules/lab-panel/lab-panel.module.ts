import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LabTestModule } from '../lab-test/lab-test.module';
import { LabPanelController } from './lab-panel.controller';
import { LabPanelOptionsController } from './lab-panel-options.controller';
import { SiteAdminLabPanelController } from './siteadmin-lab-panel.controller';
import { LabPanelService } from './lab-panel.service';

/**
 * Lab Panel feature module. Tenant-scoped + branch-level lab-panel configuration
 * (the panel plus its included tests), living inside a master data. Imports
 * `MasterDataModule` to validate the parent master data via `MasterDataService`
 * (rule #3 — DI, not a direct file import). Included-test references are validated
 * against the `LabTest` model directly through `PrismaService`. Imports
 * `LabTestModule` to reuse `LabTestService` when adopting a SITE_ADMIN template
 * panel (its referenced template tests are cloned into the tenant) — a one-way
 * dependency (LabTestModule does not import LabPanelModule), so no cycle.
 */
@Module({
  imports: [PrismaModule, MasterDataModule, LabTestModule],
  controllers: [
    LabPanelController,
    LabPanelOptionsController,
    SiteAdminLabPanelController,
  ],
  providers: [LabPanelService],
  exports: [LabPanelService],
})
export class LabPanelModule {}
