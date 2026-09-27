import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { OpdMasterDataController } from './opd-master-data.controller';
import { OpdMasterDataService } from './opd-master-data.service';

/**
 * Opd Master Data feature module. Tenant-scoped + branch-level. Imports
 * `BranchModule` to validate client-supplied branch ids via `BranchService`
 * (rule #3 — DI, not a direct file import). Auto-provisions a branch's default
 * opd master data by reacting to the `branch.created` event.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [OpdMasterDataController],
  providers: [OpdMasterDataService],
  exports: [OpdMasterDataService],
})
export class OpdMasterDataModule {}
