/**
 * One-off migration: AWS S3  ->  DigitalOcean Spaces.
 *
 * Two independent phases (run either, or both):
 *   objects  copy every object from the source (AWS) bucket to the destination
 *            (DO Spaces) bucket, preserving the KEY exactly and re-applying
 *            `public-read` + the original Content-Type. Keys are preserved so the
 *            only thing that changes in a stored URL is the host (+ bucket).
 *   urls     rewrite every stored object URL in the database, replacing the old
 *            public base (`OLD_PUBLIC_BASE`) with the new one (`NEW_PUBLIC_BASE`)
 *            across all 34 columns/JSON fields that hold an UploadsService URL.
 *
 * SAFETY: dry-run by default — it only COUNTS/lists what it would change. Pass
 * `--apply` to actually copy objects / write the DB. Idempotent: object copy
 * overwrites the same key; URL rewrite only touches values that still contain
 * OLD_PUBLIC_BASE, so re-running is a no-op.
 *
 * RLS: tenant-scoped tables are rewritten per tenant via `PrismaService.withTenant`
 * (sets `app.current_tenant_id`); platform tables (`persons`, `tenants`) and the
 * NULL-tenant SiteAdmin rows (`print_template_images`, `pdf_report_templates`)
 * are handled without a tenant context. Boot env (DATABASE_URL / RLS_ENABLED)
 * comes from `.env` via AppModule, exactly like the other scripts here.
 *
 * ── Environment (set these for the run; the app's own AWS_* are NOT used) ──
 *   Source (AWS S3):
 *     SRC_REGION=ap-southeast-1
 *     SRC_BUCKET=stage.ez.reports
 *     SRC_ENDPOINT=                      # blank for AWS
 *     SRC_ACCESS_KEY=... SRC_SECRET_KEY=...
 *   Destination (DO Spaces):
 *     DST_REGION=sgp1
 *     DST_BUCKET=stage.ez.reports
 *     DST_ENDPOINT=https://sgp1.digitaloceanspaces.com
 *     DST_ACCESS_KEY=DO801H6A2KM6EJLBHXHC  DST_SECRET_KEY=...
 *   URL rewrite:
 *     OLD_PUBLIC_BASE=https://s3-ap-southeast-1.amazonaws.com/stage.ez.reports
 *     NEW_PUBLIC_BASE=https://sgp1.digitaloceanspaces.com/stage.ez.reports
 *
 * ── Usage ──
 *   pnpm migrate:s3-to-spaces                       # dry-run, both phases
 *   pnpm migrate:s3-to-spaces --phase=objects       # dry-run object copy only
 *   pnpm migrate:s3-to-spaces --phase=urls --apply  # rewrite DB URLs for real
 *   pnpm migrate:s3-to-spaces --apply               # copy objects AND rewrite URLs
 *   (extra: --limit=N caps objects copied; --no-skip-existing forces re-copy)
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const logger = new Logger('S3ToSpaces');

// ── CLI flags ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SKIP_EXISTING = !argv.includes('--no-skip-existing');
const phaseArg = (argv.find((a) => a.startsWith('--phase=')) ?? '').split(
  '=',
)[1];
const PHASE: 'objects' | 'urls' | 'all' =
  phaseArg === 'objects' || phaseArg === 'urls' ? phaseArg : 'all';
const limitArg = (argv.find((a) => a.startsWith('--limit=')) ?? '').split(
  '=',
)[1];
const LIMIT = limitArg ? Number(limitArg) : Infinity;

// ── env helpers ───────────────────────────────────────────────────────────────
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function makeClient(prefix: 'SRC' | 'DST'): {
  client: S3Client;
  bucket: string;
} {
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const client = new S3Client({
    region: need(`${prefix}_REGION`),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: true,
    credentials: {
      accessKeyId: need(`${prefix}_ACCESS_KEY`),
      secretAccessKey: need(`${prefix}_SECRET_KEY`),
    },
  });
  return { client, bucket: need(`${prefix}_BUCKET`) };
}

// ── Phase A: copy objects AWS -> DO ───────────────────────────────────────────
async function copyObjects(): Promise<void> {
  const src = makeClient('SRC');
  const dst = makeClient('DST');
  logger.log(
    `[objects] ${APPLY ? 'COPY' : 'DRY-RUN'} ${src.bucket} -> ${dst.bucket}` +
      (SKIP_EXISTING ? ' (skip existing)' : ''),
  );

  let token: string | undefined;
  let listed = 0;
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  do {
    const page = await src.client.send(
      new ListObjectsV2Command({
        Bucket: src.bucket,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (listed >= LIMIT) break;
      const key = obj.Key;
      if (!key) continue;
      listed++;

      if (!APPLY) {
        logger.log(`[objects] would copy: ${key} (${obj.Size ?? '?'} bytes)`);
        continue;
      }

      try {
        if (SKIP_EXISTING) {
          const exists = await headExists(
            dst.client,
            dst.bucket,
            key,
            obj.Size,
          );
          if (exists) {
            skipped++;
            continue;
          }
        }
        const got = await src.client.send(
          new GetObjectCommand({ Bucket: src.bucket, Key: key }),
        );
        const body = await got.Body?.transformToByteArray();
        if (!body) {
          failed++;
          logger.warn(`[objects] empty body, skipped: ${key}`);
          continue;
        }
        await dst.client.send(
          new PutObjectCommand({
            Bucket: dst.bucket,
            Key: key,
            Body: body,
            ContentType: got.ContentType ?? 'application/octet-stream',
            ACL: 'public-read',
          }),
        );
        copied++;
        if (copied % 50 === 0) logger.log(`[objects] copied ${copied}…`);
      } catch (err) {
        failed++;
        logger.error(
          `[objects] FAILED ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && listed < LIMIT);

  logger.log(
    `[objects] done. listed=${listed} copied=${copied} skipped=${skipped} failed=${failed}`,
  );
}

async function headExists(
  client: S3Client,
  bucket: string,
  key: string,
  size?: number,
): Promise<boolean> {
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    // Treat same-size as already-copied (cheap idempotency check).
    return size === undefined || head.ContentLength === size;
  } catch (err) {
    if (
      err instanceof S3ServiceException &&
      err.$metadata.httpStatusCode === 404
    )
      return false;
    throw err;
  }
}

// ── Phase B: rewrite stored URLs ──────────────────────────────────────────────

/** A plain string/array column that stores an UploadsService URL. */
interface UrlColumn {
  table: string;
  column: string;
  /** `array` = Postgres text[] (element-wise rewrite); else a scalar text column. */
  kind?: 'array';
  /** tenant = RLS per-tenant; platform = no tenant_id column (persons/tenants). */
  scope: 'tenant' | 'platform';
  /** Also holds NULL-tenant (SiteAdmin) rows to rewrite in the platform pass. */
  nullTenant?: boolean;
}

/**
 * All 34 storage locations. 33 are plain columns (one is a text[] array); the
 * `pdf_report_templates.meta` JSON is handled separately in {@link rewriteMetaJson}.
 */
const URL_COLUMNS: UrlColumn[] = [
  { table: 'persons', column: 'photo_url', scope: 'platform' },
  { table: 'tenants', column: 'logo_url', scope: 'platform' },
  { table: 'tenants', column: 'photo_url', scope: 'platform' },
  {
    table: 'print_template_images',
    column: 'url',
    scope: 'tenant',
    nullTenant: true,
  },
  { table: 'doctors', column: 'signature_image_path', scope: 'tenant' },
  { table: 'referral_panels', column: 'file_url', scope: 'tenant' },
  { table: 'referral_doctors', column: 'file_url', scope: 'tenant' },
  { table: 'external_referrals', column: 'file_url', scope: 'tenant' },
  { table: 'internal_referrals', column: 'file_url', scope: 'tenant' },
  { table: 'machines', column: 'analyser_image', scope: 'tenant' },
  {
    table: 'machines',
    column: 'reference_images',
    kind: 'array',
    scope: 'tenant',
  },
  { table: 'report_settings', column: 'pdf_watermark', scope: 'tenant' },
  { table: 'patients', column: 'photo_url', scope: 'tenant' },
  { table: 'documents', column: 'file_url', scope: 'tenant' },
  { table: 'document_versions', column: 'file_url', scope: 'tenant' },
  { table: 'lab_panels', column: 'banner_image', scope: 'tenant' },
  { table: 'branch_lab_panels', column: 'banner_image', scope: 'tenant' },
  {
    table: 'lab_test_result_params',
    column: 'attach_file_url',
    scope: 'tenant',
  },
  { table: 'patient_documents', column: 'document_url', scope: 'tenant' },
  { table: 'attachments', column: 'url', scope: 'tenant' },
  { table: 'orders', column: 'order_id_barcode', scope: 'tenant' },
  { table: 'orders', column: 'order_id_qr_code', scope: 'tenant' },
  { table: 'order_samples', column: 'order_id_barcode', scope: 'tenant' },
  { table: 'order_diagnostics', column: 'prescription_url', scope: 'tenant' },
  { table: 'invoices', column: 'attachment_url', scope: 'tenant' },
  { table: 'invoice_payments', column: 'attachment_url', scope: 'tenant' },
  { table: 'settlement_payments', column: 'attachment_url', scope: 'tenant' },
  { table: 'settlements', column: 'decision_attachment_url', scope: 'tenant' },
  { table: 'lab_report_attachments', column: 'file_url', scope: 'tenant' },
  {
    table: 'order_sample_status_history',
    column: 'attachment_url',
    scope: 'tenant',
  },
  {
    table: 'home_visit_status_history',
    column: 'attachment_url',
    scope: 'tenant',
  },
  { table: 'lead_status_histories', column: 'attachment_url', scope: 'tenant' },
  { table: 'lead_meetings', column: 'attachment_url', scope: 'tenant' },
];

/** The JSON field handled specially (meta.images map + meta.watermark_image). */
const JSON_TABLE = 'pdf_report_templates';

type Exec = Pick<PrismaService, '$executeRawUnsafe' | '$queryRawUnsafe'>;

/** LIKE match for a scalar column ($1 = oldBase) or a text[] column. */
function matchSql(col: UrlColumn): string {
  return col.kind === 'array'
    ? `array_to_string(${col.column}, ',') LIKE '%' || $1 || '%'`
    : `${col.column} LIKE '%' || $1 || '%'`;
}

/**
 * Rewrite one string/array column. Returns rows changed (or, in dry-run, that
 * WOULD change). Placeholder numbering differs between the two queries — the
 * COUNT uses $1=oldBase (+$2=tenantId); the UPDATE uses $1=oldBase, $2=newBase
 * (+$3=tenantId) — so each builds its own params to stay in lockstep with PG.
 */
async function rewriteColumn(
  exec: Exec,
  col: UrlColumn,
  oldBase: string,
  newBase: string,
  ctx: { tenantId?: string; nullOnly?: boolean },
): Promise<number> {
  const nullOnly = ctx.nullOnly ?? false;
  const isTenant = col.scope === 'tenant' && !nullOnly;
  const nullClause =
    col.scope === 'tenant' && nullOnly ? ' AND tenant_id IS NULL' : '';

  if (!APPLY) {
    const scope = isTenant ? ' AND tenant_id = $2' : '';
    const params = isTenant ? [oldBase, ctx.tenantId] : [oldBase];
    const rows = (await exec.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM ${col.table} WHERE ${matchSql(col)}${nullClause}${scope}`,
      ...params,
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  const scope = isTenant ? ' AND tenant_id = $3' : '';
  const params = isTenant
    ? [oldBase, newBase, ctx.tenantId]
    : [oldBase, newBase];
  const setSql =
    col.kind === 'array'
      ? `${col.column} = ARRAY(SELECT REPLACE(e, $1, $2) FROM unnest(${col.column}) AS e)`
      : `${col.column} = REPLACE(${col.column}, $1, $2)`;
  return exec.$executeRawUnsafe(
    `UPDATE ${col.table} SET ${setSql} WHERE ${matchSql(col)}${nullClause}${scope}`,
    ...params,
  );
}

/** Rewrite the pdf_report_templates.meta JSON for a scope (tenant / null). */
async function rewriteMetaJson(
  prisma: PrismaService,
  oldBase: string,
  newBase: string,
  ctx: { tenantId?: string; nullOnly?: boolean; exec: Exec },
): Promise<number> {
  const nullOnly = ctx.nullOnly ?? false;
  const scopeSql = nullOnly ? ' AND tenant_id IS NULL' : ' AND tenant_id = $2';
  const params = nullOnly ? [oldBase] : [oldBase, ctx.tenantId];
  const rows = (await ctx.exec.$queryRawUnsafe(
    `SELECT id, meta FROM ${JSON_TABLE} WHERE meta::text LIKE '%' || $1 || '%'${scopeSql}`,
    ...params,
  )) as Array<{ id: string; meta: unknown }>;

  if (!APPLY) return rows.length;

  let changed = 0;
  for (const row of rows) {
    const before = JSON.stringify(row.meta ?? {});
    if (!before.includes(oldBase)) continue;
    const after = before.split(oldBase).join(newBase);
    await ctx.exec.$executeRawUnsafe(
      `UPDATE ${JSON_TABLE} SET meta = $1::jsonb WHERE id = $2`,
      after,
      row.id,
    );
    changed++;
  }
  return changed;
}

async function rewriteUrls(prisma: PrismaService): Promise<void> {
  const oldBase = need('OLD_PUBLIC_BASE').replace(/\/+$/, '');
  const newBase = need('NEW_PUBLIC_BASE').replace(/\/+$/, '');
  logger.log(
    `[urls] ${APPLY ? 'REWRITE' : 'DRY-RUN'}  "${oldBase}"  ->  "${newBase}"`,
  );

  const totals: Record<string, number> = {};
  const add = (label: string, n: number): void => {
    if (n) totals[label] = (totals[label] ?? 0) + n;
  };

  // 1) Platform tables (no tenant_id) — run once, no tenant context.
  for (const col of URL_COLUMNS.filter((c) => c.scope === 'platform')) {
    add(
      `${col.table}.${col.column}`,
      await rewriteColumn(prisma, col, oldBase, newBase, {}),
    );
  }

  // 2) NULL-tenant (SiteAdmin/global) rows — run once, no tenant context; the
  //    RLS policy on these tables permits `tenant_id IS NULL`.
  for (const col of URL_COLUMNS.filter((c) => c.nullTenant)) {
    add(
      `${col.table}.${col.column} (null-tenant)`,
      await rewriteColumn(prisma, col, oldBase, newBase, { nullOnly: true }),
    );
  }
  add(
    `${JSON_TABLE}.meta (null-tenant)`,
    await rewriteMetaJson(prisma, oldBase, newBase, {
      nullOnly: true,
      exec: prisma,
    }),
  );

  // 3) Tenant-scoped rows — per tenant, under the RLS context.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const tenantCols = URL_COLUMNS.filter((c) => c.scope === 'tenant');
  logger.log(`[urls] scanning ${tenants.length} tenants…`);
  for (const { id: tenantId } of tenants) {
    await prisma.withTenant(tenantId, async (tx) => {
      for (const col of tenantCols) {
        add(
          `${col.table}.${col.column}`,
          await rewriteColumn(tx as unknown as Exec, col, oldBase, newBase, {
            tenantId,
          }),
        );
      }
      add(
        `${JSON_TABLE}.meta`,
        await rewriteMetaJson(prisma, oldBase, newBase, {
          tenantId,
          exec: tx as unknown as Exec,
        }),
      );
    });
  }

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  logger.log(
    `[urls] ${APPLY ? 'rewrote' : 'would rewrite'} ${grand} row(s) across ${Object.keys(totals).length} location(s):`,
  );
  for (const [label, n] of Object.entries(totals).sort()) {
    logger.log(`         ${n.toString().padStart(6)}  ${label}`);
  }
  if (grand === 0) logger.log('[urls] nothing to rewrite (no matching URLs).');
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (!APPLY) {
    logger.warn(
      'DRY-RUN — no objects copied, no DB rows written. Pass --apply to execute.',
    );
  }
  if (PHASE === 'objects' || PHASE === 'all') {
    await copyObjects();
  }
  if (PHASE === 'urls' || PHASE === 'all') {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    try {
      await rewriteUrls(app.get(PrismaService));
    } finally {
      await app.close();
    }
  }
  logger.log('Migration finished.');
}

main().catch((err) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
