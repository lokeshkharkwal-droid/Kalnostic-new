import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditAction, AuditModule } from '@prisma/client';
import type { Response } from 'express';
import { OutsourceCenterService } from './outsource-center.service';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  CreateOutsourceCenterDocumentDto,
} from './dto/create-outsource-center-document.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { InvalidOutsourceCenterDocumentException } from './exceptions/outsource-center.exceptions';

/** Multer hard cap; mirrors MAX_PHOTO_BYTES in user-management.controller.ts. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Outsource-center document upload/list/download/delete endpoints
 * (business-authenticated; tenant comes from the JWT). Nested under the
 * parent center, mirroring `patient-document.controller.ts`.
 */
@Controller('outsource-centers/:outsourceCenterId/documents')
export class OutsourceCenterDocumentController {
  constructor(
    private readonly outsourceCenterService: OutsourceCenterService,
  ) {}

  /**
   * Upload a document for an outsource center. The file arrives via the
   * multipart `document` field; an optional `name` field overrides the
   * display name (defaults to the file's original name).
   */
  @Post()
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.CREATE,
    description: 'Uploaded an outsource center document',
  })
  @UseInterceptors(
    FileInterceptor('document', {
      limits: { fileSize: MAX_DOCUMENT_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          cb(null, true);
        } else {
          cb(
            new InvalidOutsourceCenterDocumentException(
              'Unsupported file type',
            ),
            false,
          );
        }
      },
    }),
  )
  upload(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') actorId: string,
    @Param('outsourceCenterId') outsourceCenterId: string,
    @Body() dto: CreateOutsourceCenterDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new InvalidOutsourceCenterDocumentException(
        'No document file was uploaded',
      );
    }
    return this.outsourceCenterService.addDocument(
      outsourceCenterId,
      tenantId,
      file,
      dto,
      actorId,
    );
  }

  /** List a center's non-deleted documents, newest first. */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('outsourceCenterId') outsourceCenterId: string,
  ) {
    return this.outsourceCenterService.findDocuments(
      outsourceCenterId,
      tenantId,
    );
  }

  /** Stream a document's bytes back with its original filename and mimetype. */
  @Get(':documentId/download')
  async download(
    @CurrentTenant() tenantId: string,
    @Param('outsourceCenterId') outsourceCenterId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName, mimeType } =
      await this.outsourceCenterService.readDocumentFile(
        documentId,
        outsourceCenterId,
        tenantId,
      );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  /** Soft-delete a document (the on-disk file is left in place). */
  @Delete(':documentId')
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.DELETE,
    description: 'Deleted an outsource center document',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('outsourceCenterId') outsourceCenterId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.outsourceCenterService.removeDocument(
      documentId,
      outsourceCenterId,
      tenantId,
    );
  }
}
