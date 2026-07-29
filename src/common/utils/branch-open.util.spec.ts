import { DayOfWeek } from '@prisma/client';
import { isBranchOpenAt } from './branch-open.util';
import { WorkingShift } from './tat-working-time.util';

/**
 * Instants live in Jan 2024, read as branch-local == UTC (engine tz contract).
 * 2024-01-01 is a **Monday**: day 1=Mon, 2=Tue … 7=Sun.
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

const dayShift = (
  activeDays: DayOfWeek[] = ALL_DAYS,
  breaks: WorkingShift['breaks'] = [],
): WorkingShift => ({
  startTime: '09:00',
  endTime: '17:00',
  breaks,
  activeDays,
});

const noFallback = {
  operationalDays: [] as DayOfWeek[],
  openingTime: null,
  closingTime: null,
};

describe('isBranchOpenAt', () => {
  describe('active schedule (preferred source)', () => {
    it('is open when now is inside an active shift', () => {
      expect(
        isBranchOpenAt(at(1, 12), { shifts: [dayShift()], ...noFallback }),
      ).toBe(true);
    });

    it('is closed when now is outside every shift', () => {
      expect(
        isBranchOpenAt(at(1, 18), { shifts: [dayShift()], ...noFallback }),
      ).toBe(false);
    });

    it('is closed on a day the shift does not run', () => {
      // Shift runs Mondays only; check Tuesday.
      expect(
        isBranchOpenAt(at(2, 12), {
          shifts: [dayShift([DayOfWeek.MONDAY])],
          ...noFallback,
        }),
      ).toBe(false);
    });

    it('treats a shift break as OPEN (breaks ignored for the gate)', () => {
      const s = dayShift(ALL_DAYS, [{ startTime: '12:00', endTime: '13:00' }]);
      expect(
        isBranchOpenAt(at(1, 12, 30), { shifts: [s], ...noFallback }),
      ).toBe(true);
    });

    it('handles a night shift wrapping past midnight', () => {
      const night: WorkingShift = {
        startTime: '22:00',
        endTime: '06:00',
        breaks: [],
        activeDays: [DayOfWeek.MONDAY],
      };
      expect(
        isBranchOpenAt(at(1, 23), { shifts: [night], ...noFallback }),
      ).toBe(true); // Mon 23:00
      expect(isBranchOpenAt(at(2, 3), { shifts: [night], ...noFallback })).toBe(
        true,
      ); // Tue 03:00 (spill from Mon)
      expect(
        isBranchOpenAt(at(2, 12), { shifts: [night], ...noFallback }),
      ).toBe(false); // Tue midday
    });
  });

  describe('operational-hours fallback (no active schedule)', () => {
    const fallback = {
      shifts: [] as WorkingShift[],
      operationalDays: [DayOfWeek.MONDAY],
      openingTime: '08:00',
      closingTime: '18:00',
    };

    it('is open within hours on an operational day', () => {
      expect(isBranchOpenAt(at(1, 10), fallback)).toBe(true);
    });

    it('is closed outside opening hours', () => {
      expect(isBranchOpenAt(at(1, 20), fallback)).toBe(false);
    });

    it('is closed on a non-operational day', () => {
      expect(isBranchOpenAt(at(2, 10), fallback)).toBe(false); // Tuesday
    });
  });

  describe('nothing configured → closed', () => {
    it('no shifts and no operational hours', () => {
      expect(isBranchOpenAt(at(1, 10), { shifts: [], ...noFallback })).toBe(
        false,
      );
    });

    it('operational days but missing opening/closing time', () => {
      expect(
        isBranchOpenAt(at(1, 10), {
          shifts: [],
          operationalDays: [DayOfWeek.MONDAY],
          openingTime: null,
          closingTime: '18:00',
        }),
      ).toBe(false);
    });
  });
});
