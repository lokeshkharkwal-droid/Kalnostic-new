import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import {
  MAX_ATTACHMENT_BYTES,
  UploadAttachmentResult,
} from './dto/upload-attachment.dto';
import { InvalidUploadFileException } from './exceptions/uploads.exceptions';
import { Public } from '../auth/decorators/public.decorator';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';

/**
 * MIME types accepted for a SiteAdmin template image upload — images only
 * (watermarks, header/body/footer logos), a stricter subset of the generic
 * attachment allow-list.
 */
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

/**
 * S3 key namespace for tenant-less (SiteAdmin, global) uploads. SiteAdmin PDF
 * templates carry no tenant, so their images live under this fixed namespace
 * instead of a real tenant id.
 */
const GLOBAL_UPLOAD_NAMESPACE = 'global';

/** S3 key sub-folder for PDF-template images. */
const PDF_TEMPLATE_FOLDER = 'pdf-templates';

/**
 * SiteAdmin image upload for global PDF templates
 * (`POST /siteadmin/uploads/attachment`). SiteAdmin templates are tenant-less,
 * so this route is authenticated by the SiteAdmin token (not the business JWT)
 * and namespaces the S3 key under a fixed `global/pdf-templates` prefix.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`, requiring
 * `master-data:write` (same as editing the templates that consume the images).
 */
@Controller('siteadmin/uploads')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminUploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Upload a single image (multipart `file` field) to S3 and return its public
   * URL. Accepts common image types up to 10 MB. Stored under the global
   * `pdf-templates` namespace (SiteAdmin templates have no tenant).
   *
   * @returns `{ url }` — store this string (or the id derived from it) in the
   *   template's `meta.images` / `meta.watermark_image`.
   * @throws InvalidUploadFileException if no file is sent or the type is unsupported.
   */
  @Post('attachment')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(
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
  uploadImage(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadAttachmentResult> {
    if (!file) {
      throw new InvalidUploadFileException('No file was uploaded');
    }
    return this.uploadsService.uploadAttachment(
      file,
      GLOBAL_UPLOAD_NAMESPACE,
      PDF_TEMPLATE_FOLDER,
    );
  }
}
