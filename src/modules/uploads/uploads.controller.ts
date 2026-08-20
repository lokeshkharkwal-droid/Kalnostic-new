import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  UploadAttachmentResult,
} from './dto/upload-attachment.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { InvalidUploadFileException } from './exceptions/uploads.exceptions';

/**
 * Generic attachment upload endpoint. Business-authenticated (the global
 * `JwtAuthGuard` applies); the tenant comes from the JWT. Reused by any feature
 * that stores a document URL string — currently the finance Receive-Payment /
 * Settle flows persist the returned URL into their existing `attachmentUrl`
 * fields.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Upload a single file (multipart `file` field) to S3 and return its public
   * URL. Accepts PDF and JPEG/PNG images up to 10 MB.
   *
   * @returns `{ url }` — store this string wherever an attachment URL is kept.
   * @throws InvalidUploadFileException if no file is sent or the type is unsupported.
   */
  @Post('attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          cb(null, true);
        } else {
          cb(new InvalidUploadFileException('Unsupported file type'), false);
        }
      },
    }),
  )
  uploadAttachment(
    @CurrentTenant() tenantId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadAttachmentResult> {
    if (!file) {
      throw new InvalidUploadFileException('No file was uploaded');
    }
    return this.uploadsService.uploadAttachment(file, tenantId);
  }
}
