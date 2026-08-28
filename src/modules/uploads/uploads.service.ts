import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { UploadAttachmentResult } from './dto/upload-attachment.dto';
import {
  UploadFailedException,
  UploadNotConfiguredException,
} from './exceptions/uploads.exceptions';

/** S3 key prefix under which finance attachments are stored. */
const ATTACHMENT_PREFIX = 'uploads/finance-attachments';

/** Default AWS region when `AWS_REGION` is unset (mirrors the kishan reference). */
const DEFAULT_REGION = 'ap-southeast-1';

/**
 * Stateless file-upload helper. Pushes a multipart file to S3 (mirroring the
 * `kalnostic-old-version-kishan` mechanism) and returns the object's public URL.
 *
 * By design this service touches NO database: the returned URL string is
 * persisted by the caller into an existing `attachmentUrl` column (e.g.
 * `InvoicePayment` / `SettlementPayment`), so there is no file record to manage
 * here and no tenant table to scope. The `tenantId` is used only to namespace
 * the S3 key.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Upload a file to S3 and return its public URL.
   *
   * @param file the multipart file (type/size already validated by the
   *   controller's `FileInterceptor`).
   * @param tenantId owning tenant, used only to namespace the S3 key.
   * @param folder optional key sub-folder (validated slug) to group objects by
   *   feature, e.g. `signatures` → `uploads/finance-attachments/<tenant>/signatures/<uuid>`.
   * @returns `{ url }` — the fully-qualified S3 URL of the stored object.
   * @throws UploadNotConfiguredException if bucket/credentials are unset.
   * @throws UploadFailedException if the S3 put fails.
   */
  async uploadAttachment(
    file: Express.Multer.File,
    tenantId: string,
    folder?: string,
  ): Promise<UploadAttachmentResult> {
    const ext = extname(file.originalname).toLowerCase();
    return this.put(file.buffer, file.mimetype, ext, tenantId, folder);
  }

  /**
   * Upload an in-memory buffer to S3 and return its public URL — the server-side
   * counterpart to {@link uploadAttachment}, used when the bytes originate inside
   * the app (e.g. base64 histogram images decoded from an EMI machine submission)
   * rather than from a multipart HTTP upload. No MIME allow-list is applied (the
   * caller is trusted server code).
   * @param buffer the file bytes
   * @param contentType the object's MIME type (e.g. `image/bmp`)
   * @param ext the file extension including the dot (e.g. `.bmp`)
   * @param tenantId owning tenant, used only to namespace the S3 key
   * @param folder optional key sub-folder (e.g. `emi-histograms`)
   * @returns `{ url }` — the fully-qualified S3 URL of the stored object
   * @throws UploadNotConfiguredException if bucket/credentials are unset
   * @throws UploadFailedException if the S3 put fails
   */
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    ext: string,
    tenantId: string,
    folder?: string,
  ): Promise<UploadAttachmentResult> {
    return this.put(buffer, contentType, ext, tenantId, folder);
  }

  /** Shared S3 put: builds the namespaced key, sends the object, returns its URL. */
  private async put(
    body: Buffer,
    contentType: string,
    ext: string,
    tenantId: string,
    folder?: string,
  ): Promise<UploadAttachmentResult> {
    const bucket = this.config.get<string>('AWS_BUCKET');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_KEY');
    const region = this.config.get<string>('AWS_REGION') ?? DEFAULT_REGION;

    const missing: string[] = [];
    if (!bucket) missing.push('AWS_BUCKET');
    if (!accessKeyId) missing.push('AWS_ACCESS_KEY');
    if (!secretAccessKey) missing.push('AWS_SECRET_KEY');
    if (missing.length) {
      throw new UploadNotConfiguredException(missing);
    }

    const sub = folder ? `${folder}/` : '';
    const key = `${ATTACHMENT_PREFIX}/${tenantId}/${sub}${randomUUID()}${ext}`;

    const client = new S3Client({
      region,
      // Path-style addressing is required for bucket names containing dots (e.g.
      // `stage.ez.reports`): virtual-hosted style over HTTPS would fail TLS cert
      // validation. This also matches the path-style URL we return below.
      forcePathStyle: true,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket!,
          Key: key,
          Body: body,
          ContentType: contentType,
          // The bucket is private, so tag each uploaded attachment public-read
          // so its returned URL previews directly in the browser. Access control
          // is the unguessable UUID key (same model as the legacy documents route).
          ACL: 'public-read',
        }),
      );
    } catch (err) {
      // Log the real cause server-side; return a generic error to the client.
      this.logger.error(
        `S3 upload failed for key ${key}: ${(err as Error).message}`,
      );
      throw new UploadFailedException({ key });
    }

    // Path-style legacy endpoint, matching the kishan URL convention.
    return { url: `https://s3-${region}.amazonaws.com/${bucket}/${key}` };
  }
}
