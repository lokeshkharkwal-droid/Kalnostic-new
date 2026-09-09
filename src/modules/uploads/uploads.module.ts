import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { SiteAdminUploadsController } from './siteadmin-uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Uploads feature module. Provides a generic S3-backed file upload endpoint
 * (`POST /uploads/attachment`, business-authenticated) plus a SiteAdmin image
 * upload for tenant-less global PDF templates (`POST /siteadmin/uploads/
 * attachment`). The returned URL is persisted by other modules into their
 * existing attachment fields. No Prisma dependency — it writes no DB rows.
 * `ConfigService` is available globally via `ConfigModule.forRoot`.
 */
@Module({
  controllers: [UploadsController, SiteAdminUploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
