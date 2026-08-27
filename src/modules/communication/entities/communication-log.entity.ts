import { CommunicationLog } from '@prisma/client';

/**
 * The persisted communication log/queue row. Re-exported from the generated
 * Prisma types so controllers/services share one canonical entity shape
 * (the module has no ORM-entity classes — Prisma is the only data layer).
 */
export type CommunicationLogEntity = CommunicationLog;
