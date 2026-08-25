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
  exchange: {
    // External Exchange gateway used to deliver Email/SMS/WhatsApp. When any of
    // url/key/secret is missing, sends are a graceful no-op (dev fallback).
    url: process.env.EXCHANGE_API_URL,
    key: process.env.EXCHANGE_API_KEY,
    secret: process.env.EXCHANGE_API_SECRET,
    // Stamped as peer_server_url + used to build links inside message bodies.
    frontendUrl: process.env.FRONTEND_URL,
    // Default email sender — a blank `from` is dropped by the relay, so emails
    // fall back to these when the caller doesn't specify a sender.
    fromEmail: process.env.EXCHANGE_FROM_EMAIL,
    fromName: process.env.EXCHANGE_FROM_NAME,
    // Per-attempt HTTP timeout (ms) so a hung relay can't block the worker.
    timeoutMs: parseInt(process.env.EXCHANGE_TIMEOUT_MS ?? '15000', 10),
  },
  communication: {
    // Enable the background queue worker on exactly one instance per environment.
    workerEnabled: process.env.COMMUNICATION_WORKER_ENABLED === 'true',
    // Rows claimed per tenant per drain tick.
    workerBatch: parseInt(process.env.COMMUNICATION_WORKER_BATCH ?? '50', 10),
    // Default delivery attempts before a message is marked FAILED.
    maxRetry: parseInt(process.env.COMMUNICATION_MAX_RETRY ?? '3', 10),
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
    // Max outsource-center document size in bytes.
    maxDocumentBytes: parseInt(
      process.env.MAX_DOCUMENT_UPLOAD_BYTES ?? `${10 * 1024 * 1024}`,
      10,
    ),
  },
});

export type AppConfiguration = ReturnType<typeof configuration>;
