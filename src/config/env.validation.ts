import * as Joi from 'joi';

/**
 * Joi schema for environment variables.
 *
 * `ConfigModule.forRoot` runs this at boot. If a required var is missing or
 * malformed, the app refuses to start — failing fast beats a confusing
 * runtime crash later. See SKILL.md §7.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: Joi.number().default(30),
  SITEADMIN_TOKEN_TTL: Joi.string().default('8h'),
  BCRYPT_ROUNDS: Joi.number().default(12),
  // AES-256-GCM key for at-rest encryption of sensitive fields (e.g. Aadhaar).
  // 32 bytes encoded as 64 hex characters. Optional so the app still boots
  // without it, but encryption/decryption then throws when actually used —
  // required in any environment that stores Aadhaar numbers.
  ENCRYPTION_KEY: Joi.string().hex().length(64).optional(),
  // Directory where uploaded profile photos are written (served/proxied).
  UPLOAD_DIR: Joi.string().default('./uploads'),
  // Max profile-photo size in bytes (default 2 MB per the v2.0 spec).
  MAX_UPLOAD_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(2 * 1024 * 1024),
  // Max outsource-center document size in bytes (default 10 MB).
  MAX_DOCUMENT_UPLOAD_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(10 * 1024 * 1024),
  // S3 attachment uploads (POST /uploads/attachment). All optional so the app
  // still boots without them; the endpoint throws UPLOAD_NOT_CONFIGURED if a
  // required var is missing when an upload is actually attempted.
  AWS_REGION: Joi.string().default('ap-southeast-1'),
  AWS_BUCKET: Joi.string().allow('').optional(),
  AWS_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_SECRET_KEY: Joi.string().allow('').optional(),
  // When true, PrismaService sets app.current_tenant_id per request so Postgres
  // RLS (prisma/rls.sql) enforces tenant isolation. Requires a non-owner DB role
  // and rls.sql applied. Default false — isolation then relies on where-clauses.
  RLS_ENABLED: Joi.boolean().default(false),
  // Retention window for audit logs: rows older than this many days are
  // hard-deleted by the daily purge in AuditService (CLAUDE.md retention
  // policy). Default 90 (~3 months).
  AUDIT_RETENTION_DAYS: Joi.number().integer().min(1).default(90),
  // External "Exchange" gateway that delivers Email/SMS/WhatsApp (ported from
  // Kishan). All optional so the app boots without them; when any is missing,
  // sends are a graceful no-op (the queue worker marks rows failed/retried).
  EXCHANGE_API_URL: Joi.string().uri().allow('').optional(),
  EXCHANGE_API_KEY: Joi.string().allow('').optional(),
  EXCHANGE_API_SECRET: Joi.string().allow('').optional(),
  // Default email sender for the Exchange relay (a blank `from` is dropped by
  // the relay). Both optional; recommended in any env that sends email.
  EXCHANGE_FROM_EMAIL: Joi.string().allow('').optional(),
  EXCHANGE_FROM_NAME: Joi.string().allow('').optional(),
  // Per-attempt HTTP timeout (ms) for the Exchange relay; a hung gateway fails
  // this attempt fast rather than blocking the queue worker. Default 15s.
  EXCHANGE_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),
  // Origin of the business frontend — stamped as peer_server_url and used to
  // build links inside message bodies.
  FRONTEND_URL: Joi.string().uri().allow('').optional(),
  // Background communication queue worker. Enable on ONE instance per env.
  COMMUNICATION_WORKER_ENABLED: Joi.boolean().default(false),
  COMMUNICATION_WORKER_BATCH: Joi.number().integer().min(1).default(50),
  COMMUNICATION_MAX_RETRY: Joi.number().integer().min(0).default(3),
});
