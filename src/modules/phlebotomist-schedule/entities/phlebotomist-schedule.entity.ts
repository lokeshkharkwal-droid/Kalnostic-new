import { PhleboServiceType, Prisma } from '@prisma/client';

/**
 * Relations eager-loaded when fetching a schedule's full config (used to hydrate
 * the Configure form). Only active child rows are included, deterministically
 * ordered. Zones include their `ServiceZone` for name/label rendering.
 */
export const PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE = {
  days: { where: { deletedAt: null }, orderBy: { dayOfWeek: 'asc' } },
  zones: {
    where: { deletedAt: null },
    include: { zone: true },
  },
  holidays: { where: { deletedAt: null }, orderBy: { holidayDate: 'asc' } },
  overrides: { where: { deletedAt: null }, orderBy: { overrideDate: 'asc' } },
} satisfies Prisma.PhlebotomistScheduleInclude;

/** A schedule with its active days, zones, holidays, and overrides. */
export type PhlebotomistScheduleDetail = Prisma.PhlebotomistScheduleGetPayload<{
  include: typeof PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE;
}>;

/** The phlebotomist's live availability status, shown on both tabs. */
export type PhlebotomistCurrentStatus = 'Available' | 'On Route' | 'Inactive';

/** Coarse per-slot state exposed to the calendar. */
export type SlotDisplayStatus =
  | 'Available'
  | 'Booked'
  | 'Full'
  | 'Past'
  | 'Off-duty';

/** Per-day availability on the calendar. */
export type DayAvailabilityStatus = 'Available' | 'Unavailable' | 'Off-duty';

/** A single row of the Phlebotomist List (Tab 1). */
export interface PhlebotomistListRow {
  srNo: number;
  phlebotomistId: string;
  name: string;
  branch: string | null;
  zone: string | null;
  mobile: string | null;
  email: string | null;
  assignedVisits: number;
  completedVisits: number;
  phlebotomyCount: number;
  currentStatus: PhlebotomistCurrentStatus;
}

/** Phlebotomist header shown above the calendar. */
export interface CalendarPhlebotomistInfo {
  id: string;
  name: string;
  mobile: string | null;
  serviceType: PhleboServiceType | null;
  branch: string | null;
  zone: string | null;
  yearsOfExperience: number | null;
  completedVisitRatio: string;
  currentStatus: PhlebotomistCurrentStatus;
  /** Configured daily booking cap (`maxVisitsPerDay`); null when no schedule. */
  maxVisitsPerDay: number | null;
}

/** One slot rendered in the calendar grid. */
export interface CalendarSlot {
  slotId: string;
  startTime: string;
  endTime: string;
  totalCapacity: number;
  bookedCount: number;
  availableCount: number;
  occupancyPercentage: number;
  status: SlotDisplayStatus;
}

/** One day column of the weekly calendar. */
export interface CalendarDay {
  date: string;
  dayName: string;
  availabilityStatus: DayAvailabilityStatus;
  /** Total bookings on this day (sum of derived slot bookings). */
  bookedVisits: number;
  /** Configured daily cap for this day; null when no active schedule. */
  maxVisitsPerDay: number | null;
  /** Remaining daily capacity (`maxVisitsPerDay - bookedVisits`, floored at 0);
   *  null when there is no configured cap. */
  remaining: number | null;
  slots: CalendarSlot[];
}

/** The full weekly calendar response. */
export interface CalendarResponse {
  phlebotomist: CalendarPhlebotomistInfo;
  weekStart: string;
  /** Total bookings across the whole week shown. */
  totalBookings: number;
  days: CalendarDay[];
}

/** One entry of the "today's available slots" response. */
export interface TodaySlot {
  slotId: string;
  startTime: string;
  endTime: string;
  bookedCount: number;
  maxCapacity: number;
  occupancyRatio: string;
  occupancyPercentage: number;
  availabilityStatus: SlotDisplayStatus;
}

/**
 * Why a date is (not) bookable in the create-order collection picker:
 * `available` (has selectable slots), `past` (already elapsed), `no-schedule`
 * (phlebotomist has no active schedule), `holiday` (a scheduled holiday/leave
 * date), `off-day` (not a working day: Sunday / non-selected weekday / override
 * day-off / beyond the generated horizon), or `fully-booked` (every slot is
 * full/past or the daily max-visits cap is reached).
 */
export type AvailabilityDayStatus =
  | 'available'
  | 'past'
  | 'no-schedule'
  | 'holiday'
  | 'off-day'
  | 'fully-booked';

/** A single bookable time slot in the collection-date picker. */
export interface AvailabilitySlot {
  slotId: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  available: number;
  status: SlotDisplayStatus;
  /** True only when the slot can still take a new visit (drives the dropdown). */
  selectable: boolean;
}

/** One calendar date's availability for the collection-date picker. */
export interface AvailabilityDay {
  date: string;
  dayName: string;
  status: AvailabilityDayStatus;
  /** True only when the date can be picked (has at least one selectable slot). */
  selectable: boolean;
  /** Human-readable reason shown when the date is not selectable, else null. */
  reason: string | null;
  maxVisitsPerDay: number;
  bookedVisits: number;
  slots: AvailabilitySlot[];
}

/**
 * Phlebotomist availability across a date range, consumed by the create-order
 * home-visit collection picker: the frontend disables non-`selectable` dates and
 * offers only `selectable` slots for the chosen date.
 */
export interface PhlebotomistAvailability {
  phlebotomistId: string;
  /** False when the phlebotomist has no active schedule (all dates disabled). */
  hasSchedule: boolean;
  rangeStart: string;
  rangeEnd: string;
  days: AvailabilityDay[];
}
