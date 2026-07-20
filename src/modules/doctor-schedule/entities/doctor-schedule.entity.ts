import { DoctorStatus, Prisma } from '@prisma/client';

/**
 * Relations eager-loaded when fetching a schedule's full config (used to hydrate
 * the Configure form). Only active child rows are included, deterministically
 * ordered.
 */
export const DOCTOR_SCHEDULE_DETAIL_INCLUDE = {
  days: { where: { deletedAt: null }, orderBy: { dayOfWeek: 'asc' } },
  holidays: { where: { deletedAt: null }, orderBy: { holidayDate: 'asc' } },
  overrides: { where: { deletedAt: null }, orderBy: { overrideDate: 'asc' } },
} satisfies Prisma.DoctorScheduleInclude;

/** A schedule with its active days, holidays, and overrides. */
export type DoctorScheduleDetail = Prisma.DoctorScheduleGetPayload<{
  include: typeof DOCTOR_SCHEDULE_DETAIL_INCLUDE;
}>;

/** Coarse per-slot state exposed to the calendar. */
export type SlotDisplayStatus =
  | 'Available'
  | 'Booked'
  | 'Full'
  | 'Past'
  | 'Unavailable';

/** Per-day availability on the calendar. */
export type DayAvailabilityStatus = 'Available' | 'Unavailable';

/** A single row of the Doctor List (Tab 1). */
export interface DoctorScheduleListRow {
  srNo: number;
  doctorId: string;
  name: string;
  branch: string | null;
  department: string | null;
  speciality: string | null;
  initialConsultationFee: number;
  followUpConsultationFee: number;
  assignedAppointments: number;
  completedAppointments: number;
  status: DoctorStatus;
  currentStatus: 'Active' | 'On Leave';
}

/** Doctor header shown above the calendar. */
export interface CalendarDoctorInfo {
  id: string;
  name: string;
  department: string | null;
  speciality: string | null;
  branch: string | null;
  rating: number | null;
  yearsOfExperience: number;
  role: string;
  consultationFee: number;
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
  slots: CalendarSlot[];
}

/** The full weekly calendar response. */
export interface CalendarResponse {
  doctor: CalendarDoctorInfo;
  weekStart: string;
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
