import { AppointmentStatus, OrderStatus } from '@prisma/client';
import {
  CHECKED_IN_APPOINTMENT_STATUSES,
  PRE_CHECKIN_APPOINTMENT_STATUSES,
  isActiveOrderForGates,
} from './order-gate-scope.util';

/**
 * Guards the rule that an appointment Check-In must enforce the SAME finalize-time
 * registration gates (referral credit, previous-dues, partial-billing, discount/TDS)
 * as a real ORDER — so a checked-in appointment can never bypass a restriction a
 * normal order would hit, even though it keeps `status = APPOINTMENT`.
 */
describe('isActiveOrderForGates', () => {
  it('treats a real ORDER as active (gates enforced) regardless of appointment/check-in', () => {
    expect(
      isActiveOrderForGates({
        effectiveStatus: OrderStatus.ORDER,
        appointmentStatus: null,
        checkIn: false,
      }),
    ).toBe(true);
  });

  it('treats the Check-In transition (checkIn=true) on an APPOINTMENT as active', () => {
    expect(
      isActiveOrderForGates({
        effectiveStatus: OrderStatus.APPOINTMENT,
        appointmentStatus: AppointmentStatus.CONFIRMED,
        checkIn: true,
      }),
    ).toBe(true);
  });

  it.each(CHECKED_IN_APPOINTMENT_STATUSES)(
    'treats an already checked-in APPOINTMENT (%s) as active on later edits (checkIn=false)',
    (appointmentStatus) => {
      expect(
        isActiveOrderForGates({
          effectiveStatus: OrderStatus.APPOINTMENT,
          appointmentStatus,
          checkIn: false,
        }),
      ).toBe(true);
    },
  );

  it.each(PRE_CHECKIN_APPOINTMENT_STATUSES)(
    'does NOT treat a not-yet-checked-in APPOINTMENT (%s) as active (gates skipped)',
    (appointmentStatus) => {
      expect(
        isActiveOrderForGates({
          effectiveStatus: OrderStatus.APPOINTMENT,
          appointmentStatus,
          checkIn: false,
        }),
      ).toBe(false);
    },
  );

  it('does NOT treat a cancelled appointment as active', () => {
    expect(
      isActiveOrderForGates({
        effectiveStatus: OrderStatus.APPOINTMENT,
        appointmentStatus: AppointmentStatus.CANCELLED,
        checkIn: false,
      }),
    ).toBe(false);
  });

  it.each([OrderStatus.DRAFT, OrderStatus.QUOTE])(
    'does NOT treat %s as active even if checkIn is somehow set',
    (effectiveStatus) => {
      expect(
        isActiveOrderForGates({
          effectiveStatus,
          appointmentStatus: null,
          checkIn: true,
        }),
      ).toBe(false);
    },
  );

  it('does NOT treat an undefined status as active', () => {
    expect(
      isActiveOrderForGates({
        effectiveStatus: undefined,
        appointmentStatus: null,
        checkIn: false,
      }),
    ).toBe(false);
  });

  it('the checked-in and pre-check-in status sets are disjoint and cover the actionable lifecycle', () => {
    const overlap = CHECKED_IN_APPOINTMENT_STATUSES.filter((s) =>
      PRE_CHECKIN_APPOINTMENT_STATUSES.includes(s),
    );
    expect(overlap).toEqual([]);
  });
});
