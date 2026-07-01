import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SiteAdminTestGroupController } from './siteadmin-test-group.controller';
import { TestGroupService } from './test-group.service';

/**
 * Test Group feature module. Platform-level (SiteAdmin-only) named bundles of
 * SITE_ADMIN lab-test templates, mapped many-to-many via `TestGroupMapping`.
 * Lab-test references are validated against the `LabTest` model directly through
 * `PrismaService`, so no other feature module needs to be imported.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SiteAdminTestGroupController],
  providers: [TestGroupService],
  exports: [TestGroupService],
})
export class TestGroupModule {}
