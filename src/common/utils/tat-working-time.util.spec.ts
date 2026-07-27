import { DayOfWeek, TatUnit } from '@prisma/client';
import {
  classifyTat,
  evaluateTat,
  hhmmToMinutes,
  tatUnitToMinutes,
  toBranchLocalInstant,
  workingMinutesBetween,
  WorkingShift,
} from './tat-working-time.util';

/**
 * All test instants live in Jan 2024, read as branch-local == UTC (the util's
 * timezone contract). 2024-01-01 is a **Monday**, so:
 *   day 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun.
 */
const at = (day: number, hh: number, mm = 0): Date =>
  new Date(Date.UTC(2024, 0, day, hh, mm));

const ALL_DAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

/** A 09:00–17:00 day shift with no breaks, running on the given days. */
const dayShift = (
  activeDays: DayOfWeek[] = ALL_DAYS,
  breaks: WorkingShift['breaks'] = [],
): WorkingShift => ({
  startTime: '09:00',
  endTime: '17:00',
  breaks,
  activeDays,
});

describe('workingMinutesBetween', () => {
  it('returns 0 when end is at or before start', () => {
    expect(
      workingMinutesBetween(at(1, 12), at(1, 12), { shifts: [dayShift()] }),
    ).toBe(0);
    expect(
      workingMinutesBetween(at(1, 12), at(1, 10), { shifts: [dayShift()] }),
    ).toBe(0);
  });

  it('returns 0 when there are no shifts', () => {
    expect(workingMinutesBetween(at(1, 9), at(1, 17), { shifts: [] })).toBe(0);
  });

  it('counts a simple window fully inside operating hours', () => {
    // Mon 09:00 -> 12:00 = 180 min.
    expect(
      workingMinutesBetween(at(1, 9), at(1, 12), { shifts: [dayShift()] }),
    ).toBe(180);
  });

  it('clips time outside operating hours', () => {
    // Mon 08:00 -> 10:00, shift 09:00-17:00 => only 09:00-10:00 = 60.
    expect(
      workingMinutesBetween(at(1, 8), at(1, 10), { shifts: [dayShift()] }),
    ).toBe(60);
  });

  it('excludes break periods', () => {
    // 09:00-17:00 (480) minus a 13:00-14:00 break (60) = 420.
    const shift = dayShift(ALL_DAYS, [
      { startTime: '13:00', endTime: '14:00' },
    ]);
    expect(
      workingMinutesBetween(at(1, 9), at(1, 17), { shifts: [shift] }),
    ).toBe(420);
  });

  it('counts only worked minutes when accept/approve land inside a break', () => {
    // Accept 13:30 (mid-break), approve 14:30 => only 14:00-14:30 = 30.
    const shift = dayShift(ALL_DAYS, [
      { startTime: '13:00', endTime: '14:00' },
    ]);
    expect(
      workingMinutesBetween(at(1, 13, 30), at(1, 14, 30), { shifts: [shift] }),
    ).toBe(30);
  });

  it('skips the closed overnight gap between two days', () => {
    // Mon 16:00 -> Tue 10:00: Mon 16-17 (60) + closed 17:00-09:00 + Tue 09-10 (60) = 120.
    expect(
      workingMinutesBetween(at(1, 16), at(2, 10), { shifts: [dayShift()] }),
    ).toBe(120);
  });

  it('sums a multi-day span', () => {
    // Mon 09:00 -> Wed 17:00, daily 8h shift = 3 * 480 = 1440.
    expect(
      workingMinutesBetween(at(1, 9), at(3, 17), { shifts: [dayShift()] }),
    ).toBe(1440);
  });

  it('handles a night shift that crosses midnight', () => {
    // Shift 22:00-06:00 active Monday. Accept Mon 23:00 -> approve Tue 02:00 = 180.
    const night: WorkingShift = {
      startTime: '22:00',
      endTime: '06:00',
      breaks: [],
      activeDays: [DayOfWeek.MONDAY],
    };
    expect(
      workingMinutesBetween(at(1, 23), at(2, 2), { shifts: [night] }),
    ).toBe(180);
  });

  it('counts a night shift that started the day BEFORE the accept instant', () => {
    // Monday-night shift 22:00-06:00 spills into Tuesday morning. A window that
    // begins Tue 00:30 must still see Monday's occurrence (the walk starts a day
    // early). Tue 00:30 -> 05:00 = 270.
    const night: WorkingShift = {
      startTime: '22:00',
      endTime: '06:00',
      breaks: [],
      activeDays: [DayOfWeek.MONDAY],
    };
    expect(
      workingMinutesBetween(at(2, 0, 30), at(2, 5), { shifts: [night] }),
    ).toBe(270);
  });

  it('skips non-scheduled days via scheduledDays', () => {
    // Shift runs daily, but the test is only scheduled on Monday.
    // Mon 16:00 -> Tue 10:00 => only Monday's 16:00-17:00 counts = 60.
    const calendar = {
      shifts: [dayShift()],
      scheduledDays: [DayOfWeek.MONDAY],
    };
    expect(workingMinutesBetween(at(1, 16), at(2, 10), calendar)).toBe(60);
  });

  it('treats empty scheduledDays as "every operating day"', () => {
    const calendar = { shifts: [dayShift()], scheduledDays: [] };
    expect(workingMinutesBetween(at(1, 16), at(2, 10), calendar)).toBe(120);
  });

  it('unions overlapping shifts so time is never double-counted', () => {
    // Two overlapping Monday shifts 09:00-12:00 and 11:00-15:00 => union 09:00-15:00 = 360.
    const a: WorkingShift = {
      startTime: '09:00',
      endTime: '12:00',
      breaks: [],
      activeDays: [DayOfWeek.MONDAY],
    };
    const b: WorkingShift = {
      startTime: '11:00',
      endTime: '15:00',
      breaks: [],
      activeDays: [DayOfWeek.MONDAY],
    };
    expect(workingMinutesBetween(at(1, 9), at(1, 15), { shifts: [a, b] })).toBe(
      360,
    );
  });
});

describe('toBranchLocalInstant', () => {
  it('passes the instant through unchanged when no timezone is given', () => {
    const utc = new Date('2024-01-01T00:00:00Z');
    expect(toBranchLocalInstant(utc, null).getTime()).toBe(utc.getTime());
    expect(toBranchLocalInstant(utc, '').getTime()).toBe(utc.getTime());
  });

  it('shifts a UTC instant to Asia/Kolkata local wall clock (+05:30)', () => {
    // 2024-01-01T00:00:00Z is 05:30 local in IST.
    const local = toBranchLocalInstant(
      new Date('2024-01-01T00:00:00Z'),
      'Asia/Kolkata',
    );
    expect(local.getUTCFullYear()).toBe(2024);
    expect(local.getUTCMonth()).toBe(0);
    expect(local.getUTCDate()).toBe(1);
    expect(local.getUTCHours()).toBe(5);
    expect(local.getUTCMinutes()).toBe(30);
  });

  it('rolls the local date back for a negative-offset zone', () => {
    // 2024-01-01T02:00:00Z is 2023-12-31 21:00 in America/New_York (-05:00).
    const local = toBranchLocalInstant(
      new Date('2024-01-01T02:00:00Z'),
      'America/New_York',
    );
    expect(local.getUTCFullYear()).toBe(2023);
    expect(local.getUTCMonth()).toBe(11);
    expect(local.getUTCDate()).toBe(31);
    expect(local.getUTCHours()).toBe(21);
  });

  it('feeds the engine so IST timestamps line up with local shift windows', () => {
    // Accept 03:39Z (=09:09 IST) approve 06:39Z (=12:09 IST); day shift 09:00-17:00
    // in local time => 180 working minutes once converted.
    const tz = 'Asia/Kolkata';
    const start = toBranchLocalInstant(new Date('2024-01-01T03:39:00Z'), tz);
    const end = toBranchLocalInstant(new Date('2024-01-01T06:39:00Z'), tz);
    expect(workingMinutesBetween(start, end, { shifts: [dayShift()] })).toBe(
      180,
    );
  });
});

describe('hhmmToMinutes', () => {
  it('converts HH:mm to minutes since midnight', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('09:30')).toBe(570);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
});

describe('tatUnitToMinutes', () => {
  it('converts each unit', () => {
    expect(tatUnitToMinutes(45, TatUnit.MINUTES)).toBe(45);
    expect(tatUnitToMinutes(2, TatUnit.HOURS)).toBe(120);
    expect(tatUnitToMinutes(3, TatUnit.DAYS)).toBe(4320);
  });

  it('returns null when value or unit is missing', () => {
    expect(tatUnitToMinutes(null, TatUnit.HOURS)).toBeNull();
    expect(tatUnitToMinutes(5, null)).toBeNull();
  });
});

describe('classifyTat', () => {
  const max = 100; // minutes

  it('returns null without a configured maximum', () => {
    expect(classifyTat(50, null)).toBeNull();
    expect(classifyTat(50, 0)).toBeNull();
  });

  it('classifies each band (defaults: warn 0.75, critical 0.9)', () => {
    expect(classifyTat(50, max)).toBe('WITHIN'); // < 75
    expect(classifyTat(75, max)).toBe('WARNING'); // 75..<90
    expect(classifyTat(89, max)).toBe('WARNING');
    expect(classifyTat(90, max)).toBe('CRITICAL'); // 90..100
    expect(classifyTat(100, max)).toBe('CRITICAL'); // == max is still within committed max
    expect(classifyTat(101, max)).toBe('BREACHED'); // > max
  });

  it('respects custom thresholds', () => {
    expect(
      classifyTat(60, max, { warningRatio: 0.5, criticalRatio: 0.8 }),
    ).toBe('WARNING');
    expect(
      classifyTat(85, max, { warningRatio: 0.5, criticalRatio: 0.8 }),
    ).toBe('CRITICAL');
  });
});

describe('evaluateTat', () => {
  it('computes net working minutes and the band together', () => {
    // Mon 09:00 -> 12:00 = 180 net working minutes; Max TAT 8h = 480 => WITHIN.
    const result = evaluateTat(
      at(1, 9),
      at(1, 12),
      { shifts: [dayShift()] },
      8,
      TatUnit.HOURS,
    );
    expect(result.netMinutes).toBe(180);
    expect(result.maxTatMinutes).toBe(480);
    expect(result.band).toBe('WITHIN');
  });

  it('reports BREACHED when net working time exceeds the configured max', () => {
    // Mon 09:00 -> Wed 17:00 = 1440 net; Max TAT 8h = 480 => 1440 > 480 => BREACHED.
    const result = evaluateTat(
      at(1, 9),
      at(3, 17),
      { shifts: [dayShift()] },
      8,
      TatUnit.HOURS,
    );
    expect(result.netMinutes).toBe(1440);
    expect(result.band).toBe('BREACHED');
  });

  it('leaves the band null when no max is configured', () => {
    const result = evaluateTat(
      at(1, 9),
      at(1, 12),
      { shifts: [dayShift()] },
      null,
      null,
    );
    expect(result.netMinutes).toBe(180);
    expect(result.band).toBeNull();
  });
});
