import { AppointmentStatus, OrderStatus } from '@prisma/client';

/**
 * Appointment lifecycle statuses that count as "checked in" — the patient has
 * arrived and the order has entered the active workflow (accession/billing). An
 * APPOINTMENT-status order with one of these appointment statuses is surfaced in
 * Billing (regardless of payment) and the Order Console, and must enforce the same
 * finalize-time registration gates as a real ORDER (see {@link isActiveOrderForGates}).
 */
export const CHECKED_IN_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

/**
 * Appointment statuses from which a Check-In may advance to CHECKED_IN. Guards the
 * check-in transition so it never downgrades an appointment already in progress /
 * completed / cancelled.
 */
export const PRE_CHECKIN_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.NEW,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED,
];

/**
 * Whether an order must enforce the full finalize-time registration gates
 * (referral credit, previous-dues, partial-billing, discount/TDS). True for a real
 * `ORDER`, and for an `APPOINTMENT` that is being checked in (`checkIn`) or has
 * already been checked in (its linked appointment is CHECKED_IN / IN_PROGRESS /
 * COMPLETED). A Check-In commits the appointment into the active billable workflow
 * even though the order keeps `status = APPOINTMENT`, so it must not be allowed to
 * bypass any gate a normal order would hit. DRAFT / QUOTE / not-yet-checked-in
 * APPOINTMENT are not active and skip the gates.
 * @param input.effectiveStatus the order's effective status (patch merged over stored)
 * @param input.appointmentStatus the linked appointment's current status (null if none)
 * @param input.checkIn whether this write is the Check-In transition (`dto.checkIn`)
 */
export function isActiveOrderForGates(input: {
  effectiveStatus: OrderStatus | undefined;
  appointmentStatus: AppointmentStatus | null | undefined;
  checkIn: boolean;
}): boolean {
  if (input.effectiveStatus === OrderStatus.ORDER) return true;
  if (input.effectiveStatus !== OrderStatus.APPOINTMENT) return false;
  if (input.checkIn) return true;
  return (
    input.appointmentStatus != null &&
    CHECKED_IN_APPOINTMENT_STATUSES.includes(input.appointmentStatus)
  );
}
