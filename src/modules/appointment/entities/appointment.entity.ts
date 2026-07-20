import { Prisma } from '@prisma/client';

/** Include the status-history log when returning a single appointment. */
export const APPOINTMENT_INCLUDE = {
  statusHistory: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.AppointmentInclude;

/** An appointment with its status-history log attached. */
export type AppointmentWithHistory = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_INCLUDE;
}>;
