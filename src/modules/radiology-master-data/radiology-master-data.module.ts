import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { RadiologyMasterDataController } from './radiology-master-data.controller';
import { RadiologyMasterDataService } from './radiology-master-data.service';

/**
 * Radiology Master Data feature module. Tenant-scoped + branch-level. Imports
 * `BranchModule` to validate client-supplied branch ids via `BranchService`
 * (rule #3 — DI, not a direct file import). Auto-provisions a branch's default
 * radiology master data by reacting to the `branch.created` event.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [RadiologyMasterDataController],
  providers: [RadiologyMasterDataService],
  exports: [RadiologyMasterDataService],
})
export class RadiologyMasterDataModule {}
