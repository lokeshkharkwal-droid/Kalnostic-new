import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * Generic attachments feature module. Provides `/attachments` CRUD backed by the
 * polymorphic `Attachment` model, so any feature can persist a file's S3 URL
 * against its records without its own table. Exports the service for direct reuse.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
