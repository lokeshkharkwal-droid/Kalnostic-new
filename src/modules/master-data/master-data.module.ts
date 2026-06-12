import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';

/**
 * Master Data feature module. Tenant-scoped + branch-level master data and its
 * lab-test catalogue. Imports `BranchModule` to validate client-supplied branch
 * ids via `BranchService` (rule #3 — DI, not a direct file import). Auto-provisions
 * a branch's default master data by reacting to the `branch.created` event, so
 * `BranchModule` does NOT depend on this module (no circular dependency).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
