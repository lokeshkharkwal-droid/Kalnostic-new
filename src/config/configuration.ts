/**
 * Typed configuration factory.
 *
 * Groups raw env vars into a structured, strongly-typed object so services
 * can read `config.get('jwt.secret')` instead of scattering `process.env`
 * lookups. Registered via `ConfigModule.forRoot({ load: [configuration] })`.
 */
export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },
  audit: {
    // Days an audit row is kept before the daily purge hard-deletes it.
    retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS ?? '90', 10),
  },
  encryption: {
    // AES-256-GCM key (64 hex chars) for at-rest field encryption (e.g. Aadhaar).
    key: process.env.ENCRYPTION_KEY,
  },
  upload: {
    // Where profile photos are written, and the max allowed size in bytes.
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxBytes: parseInt(
      process.env.MAX_UPLOAD_BYTES ?? `${2 * 1024 * 1024}`,
      10,
    ),
  },
});

export type AppConfiguration = ReturnType<typeof configuration>;
