import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { RadiologyCertificateController } from './radiology-certificate.controller';
import { RadiologyCertificateOptionsController } from './radiology-certificate-options.controller';
import { RadiologyCertificateService } from './radiology-certificate.service';

/**
 * Radiology Certificate feature module. Tenant-scoped + branch-level certificate
 * templates (name / group / rich-text body) authored inside a master data —
 * ported from EzHealthTrack `radiologyCertificateCreate`. Managed by business-admin
 * (Tenant MD) and branch-admin (Branch MD); there is intentionally NO SiteAdmin
 * import. Imports `MasterDataModule` to validate the parent master data via
 * `MasterDataService` (rule #3 — DI, not a direct file import). The options
 * controller is listed first so its static `options` route matches before
 * `:certificateId`.
 */
@Module({
  imports: [PrismaModule, MasterDataModule],
  controllers: [
    RadiologyCertificateOptionsController,
    RadiologyCertificateController,
  ],
  providers: [RadiologyCertificateService],
  exports: [RadiologyCertificateService],
})
export class RadiologyCertificateModule {}
