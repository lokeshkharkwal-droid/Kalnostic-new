import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Uploads feature module. Provides a generic S3-backed file upload endpoint
 * (`POST /uploads/attachment`) whose returned URL is persisted by other modules
 * into their existing attachment fields. No Prisma dependency — it writes no DB
 * rows. `ConfigService` is available globally via `ConfigModule.forRoot`.
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
