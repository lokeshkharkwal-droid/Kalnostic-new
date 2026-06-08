import { Schedule, ShiftName, DayOfWeek } from '@prisma/client';

/**
 * One shift inside a schedule's `shifts` JSON array. All times are 24h `HH:mm`,
 * branch-local. A NIGHT shift may cross midnight (`endTime` <= `startTime`),
 * e.g. `22:00`–`06:00`; consumers (e.g. TAT calculation) must treat such a
 * shift as wrapping to the next day. `activeDays` are the days of the week the
 * shift runs on.
 */
export interface ScheduleShift {
  shiftName: ShiftName;
  startTime: string;
  endTime: string;
  breakStartTime: string;
  breakEndTime: string;
  activeDays: DayOfWeek[];
}

/**
 * Domain/response shape for a schedule. The Prisma model is the DB source of
 * truth; `shifts` is persisted as JSON and carries the shape below (validated
 * on the way in by the schedule DTOs).
 */
export type ScheduleEntity = Omit<Schedule, 'shifts'> & {
  shifts: ScheduleShift[];
};
