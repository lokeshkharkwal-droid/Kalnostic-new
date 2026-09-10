import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { basename, extname } from 'path';
import { UploadAttachmentResult } from './dto/upload-attachment.dto';
import {
  UploadFailedException,
  UploadNotConfiguredException,
} from './exceptions/uploads.exceptions';

/** Default Spaces region when `SPACES_REGION` is unset. */
const DEFAULT_REGION = 'sgp1';

/**
 * Maps `NODE_ENV` to the short environment segment used as the top-level object
 * key folder, matching the legacy ezhealthtrack layout (`prod` / `dev` / `test`).
 */
const ENV_SEGMENT: Record<string, string> = {
  production: 'prod',
  development: 'dev',
  test: 'test',
};

/**
 * Stateless file-upload helper. Pushes a file to **DigitalOcean Spaces** (an
 * S3-compatible object store, driven via the AWS S3 SDK) and returns the
 * object's public URL.
 *
 * Objects are stored under the date-partitioned key layout the legacy
 * ezhealthtrack system used — `{env}/{tenantId}/{YYYY}/{MM}/{DD}/{filename}`
 * (UTC date) — keeping the uploaded file's original (sanitised) name plus a
 * short unique suffix so same-name uploads never overwrite each other.
 *
 * By design this service touches NO database: the returned URL string is
 * persisted by the caller into an existing `attachmentUrl` column (e.g.
 * `InvoicePayment` / `SettlementPayment`), so there is no file record to manage
 * here and no tenant table to scope. The `tenantId` is used only to namespace
 * the object key.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Upload a file to Spaces and return its public URL. The object keeps the file's
   * original (sanitised) name under a date-partitioned, tenant-scoped key.
   *
   * @param file the multipart file (type/size already validated by the
   *   controller's `FileInterceptor`).
   * @param tenantId owning tenant, used to namespace the object key.
   * @returns `{ url }` — the fully-qualified Spaces URL of the stored object.
   * @throws UploadNotConfiguredException if bucket/credentials are unset.
   * @throws UploadFailedException if the Spaces put fails.
   */
  async uploadAttachment(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<UploadAttachmentResult> {
    return this.put(
      file.buffer,
      file.mimetype,
      this.safeName(file.originalname),
      tenantId,
    );
  }

  /**
   * Upload an in-memory buffer to Spaces and return its public URL — the server-side
   * counterpart to {@link uploadAttachment}, used when the bytes originate inside
   * the app (e.g. base64 histogram images decoded from an EMI machine submission)
   * rather than from a multipart HTTP upload. No MIME allow-list is applied (the
   * caller is trusted server code). In-app buffers carry no original filename,
   * so the object is named with a random UUID plus the given extension.
   * @param buffer the file bytes
   * @param contentType the object's MIME type (e.g. `image/bmp`)
   * @param ext the file extension including the dot (e.g. `.bmp`)
   * @param tenantId owning tenant, used to namespace the object key
   * @returns `{ url }` — the fully-qualified Spaces URL of the stored object
   * @throws UploadNotConfiguredException if bucket/credentials are unset
   * @throws UploadFailedException if the Spaces put fails
   */
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    ext: string,
    tenantId: string,
  ): Promise<UploadAttachmentResult> {
    return this.put(buffer, contentType, `${randomUUID()}${ext}`, tenantId);
  }

  /** Shared put: builds the namespaced key, sends the object, returns its URL. */
  private async put(
    body: Buffer,
    contentType: string,
    filename: string,
    tenantId: string,
  ): Promise<UploadAttachmentResult> {
    const bucket = this.config.get<string>('SPACES_BUCKET');
    const accessKeyId = this.config.get<string>('SPACES_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('SPACES_SECRET_KEY');
    const region = this.config.get<string>('SPACES_REGION') ?? DEFAULT_REGION;
    // The DigitalOcean Spaces regional endpoint, e.g.
    // `https://sgp1.digitaloceanspaces.com`. Required — this is what points the
    // S3 client at Spaces.
    const endpoint = this.config.get<string>('SPACES_ENDPOINT');

    const missing: string[] = [];
    if (!bucket) missing.push('SPACES_BUCKET');
    if (!endpoint) missing.push('SPACES_ENDPOINT');
    if (!accessKeyId) missing.push('SPACES_ACCESS_KEY');
    if (!secretAccessKey) missing.push('SPACES_SECRET_KEY');
    if (missing.length) {
      throw new UploadNotConfiguredException(missing);
    }

    const key = this.buildKey(tenantId, filename);

    const client = new S3Client({
      region,
      // Points the S3 client at DigitalOcean Spaces.
      endpoint: endpoint!,
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
          // The bucket blocks listing, so tag each object public-read so its
          // returned URL previews directly in the browser. Keys keep the file's
          // original name (ezhealthtrack layout) plus a short random suffix, so
          // knowledge of the URL is the only gate — same model as the legacy
          // documents route.
          ACL: 'public-read',
        }),
      );
    } catch (err) {
      // Log the real cause server-side; return a generic error to the client.
      this.logger.error(
        `Spaces upload failed for key ${key}: ${(err as Error).message}`,
      );
      throw new UploadFailedException({ key });
    }

    return { url: this.buildPublicUrl(bucket!, key, endpoint!) };
  }

  /**
   * Build the object's public URL (path-style):
   *
   * 1. `SPACES_PUBLIC_BASE_URL` set → `{base}/{key}`. Use for a CDN or custom
   *    domain whose root already maps to the bucket.
   * 2. else the Spaces origin → `{endpoint}/{bucket}/{key}` (path-style, e.g.
   *    `https://sgp1.digitaloceanspaces.com/stage.ez.reports/…`).
   *
   * @param bucket the Spaces bucket name.
   * @param key the object key.
   * @param endpoint the Spaces regional endpoint.
   * @returns the fully-qualified public URL of the stored object.
   */
  private buildPublicUrl(
    bucket: string,
    key: string,
    endpoint: string,
  ): string {
    const publicBase = this.config.get<string>('SPACES_PUBLIC_BASE_URL');
    if (publicBase) {
      return `${publicBase.replace(/\/+$/, '')}/${key}`;
    }
    return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
  }

  /**
   * Build the object key using the legacy ezhealthtrack layout:
   * `{env}/{tenantId}/{YYYY}/{MM}/{DD}/{filename}`. The date is UTC (kalnostics
   * stores all timestamps in UTC) and `env` comes from `NODE_ENV` mapped to
   * `prod`/`dev`/`test`.
   *
   * @param tenantId owning tenant (or a fixed namespace such as `global` for
   *   tenant-less SiteAdmin uploads).
   * @param filename the already-sanitised object filename (incl. extension).
   * @returns the fully-qualified object key.
   */
  private buildKey(tenantId: string, filename: string): string {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const env = ENV_SEGMENT[nodeEnv] ?? nodeEnv;
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${env}/${tenantId}/${yyyy}/${mm}/${dd}/${filename}`;
  }

  /**
   * Sanitise an uploaded filename and append a short unique suffix so it is safe
   * as an object key segment / public-URL component and cannot collide with another
   * upload of the same name on the same day. Strips any directory component,
   * allows only `[A-Za-z0-9._-]` (collapsing everything else to `_`), drops
   * leading dots (so a name cannot become hidden/relative), then inserts a
   * 6-char hex suffix before the extension — e.g. `lab report.pdf` →
   * `lab_report_a1b2c3.pdf`.
   *
   * @param originalName the client-supplied filename.
   * @returns a collision-resistant, URL-safe filename.
   */
  private safeName(originalName: string): string {
    const base = basename(originalName || '');
    const ext = extname(base);
    const stem = base
      .slice(0, base.length - ext.length)
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '');
    const safeStem = stem.length > 0 ? stem : 'file';
    const safeExt = ext.replace(/[^A-Za-z0-9.]+/g, '');
    const suffix = randomUUID().replace(/-/g, '').slice(0, 6);
    return `${safeStem}_${suffix}${safeExt}`;
  }
}
