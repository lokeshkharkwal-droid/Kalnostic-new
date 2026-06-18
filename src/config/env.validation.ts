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
  // When true, PrismaService sets app.current_tenant_id per request so Postgres
  // RLS (prisma/rls.sql) enforces tenant isolation. Requires a non-owner DB role
  // and rls.sql applied. Default false — isolation then relies on where-clauses.
  RLS_ENABLED: Joi.boolean().default(false),
  // Retention window for audit logs: rows older than this many days are
  // hard-deleted by the daily purge in AuditService (CLAUDE.md retention
  // policy). Default 90 (~3 months).
  AUDIT_RETENTION_DAYS: Joi.number().integer().min(1).default(90),
});
