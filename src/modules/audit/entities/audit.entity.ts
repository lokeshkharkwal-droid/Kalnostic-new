import { AuditLog } from '@prisma/client';

/** Domain/response shape for an audit log (the Prisma model is the source of truth). */
export type AuditEntity = AuditLog;
