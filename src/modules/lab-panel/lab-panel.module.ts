import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { LabPanelController } from './lab-panel.controller';
import { LabPanelService } from './lab-panel.service';

/**
 * Lab Panel feature module. Tenant-scoped + branch-level lab-panel configuration
 * (the panel plus its included tests), living inside a master data. Imports
 * `MasterDataModule` to validate the parent master data via `MasterDataService`
 * (rule #3 — DI, not a direct file import). Included-test references are validated
 * against the `LabTest` model directly through `PrismaService`.
 */
@Module({
  imports: [PrismaModule, MasterDataModule],
  controllers: [LabPanelController],
  providers: [LabPanelService],
  exports: [LabPanelService],
})
export class LabPanelModule {}
