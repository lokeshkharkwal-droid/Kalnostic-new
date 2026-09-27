import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpdMasterDataModule } from '../opd-master-data/opd-master-data.module';
import { OpdTestController } from './opd-test.controller';
import { OpdTestOptionsController } from './opd-test-options.controller';
import { SiteAdminOpdTestController } from './siteadmin-opd-test.controller';
import { OpdTestService } from './opd-test.service';

/**
 * Opd Test feature module. Tenant-scoped + branch-level opd-test
 * configuration (the test plus its samples, result parameters, and reference
 * ranges/values), living inside a opd master data. Imports
 * `OpdMasterDataModule` to validate the parent master data via
 * `OpdMasterDataService` (rule #3 — DI, not a direct file import).
 */
@Module({
  imports: [PrismaModule, OpdMasterDataModule],
  controllers: [
    OpdTestOptionsController,
    OpdTestController,
    SiteAdminOpdTestController,
  ],
  providers: [OpdTestService],
  exports: [OpdTestService],
})
export class OpdTestModule {}
