import { DayOfWeek, TatUnit } from '@prisma/client';
import {
  forwardMinutes,
  isInWindow,
  NablReportState,
  NablWindowConfig,
  stepNablStopwatch,
} from './nabl-tat-stopwatch.util';

/**
 * Instants live in Jan 2024, read as branch-local == UTC (TAT engine tz
 * contract). 2024-01-01 is a **Monday**: day 1=Mon, 2=Tue … 7=Sun. Tests pass
 * `timezone = null` so wall-clock == UTC fields, except the explicit tz case.
 */
const at = (day: number, hh: number, mm = 0): Date =>
  new Date(Date.UTC(2024, 0, day, hh, mm));

/** Window 09:00–17:00, every day, Max TAT 4h (240 min) unless overridden. */
const cfg = (over: Partial<NablWindowConfig> = {}): NablWindowConfig => ({
  processingTimeFrom: '09:00',
  processingTimeTo: '17:00',
  scheduleDays: [],
  tatMaxValue: 4,
  tatMaxUnit: TatUnit.HOURS,
  ...over,
});

const fresh: NablReportState = {
  isNablTat: false,
  tatStartAt: null,
  tatIsRunning: false,
  tatLastTickAt: null,
  tatNetMinutes: null,
};

/** A started + currently-running report with the given accrued minutes. */
const running = (
  net: number,
  lastTick: Date,
  startAt = at(1, 9),
): NablReportState => ({
  isNablTat: true,
  tatStartAt: startAt,
  tatIsRunning: true,
  tatLastTickAt: lastTick,
  tatNetMinutes: net,
});

/** A started-but-paused report (e.g. after the window closed yesterday). */
const paused = (net: number, startAt = at(1, 9)): NablReportState => ({
  isNablTat: true,
  tatStartAt: startAt,
  tatIsRunning: false,
  tatLastTickAt: at(1, 17),
  tatNetMinutes: net,
});

describe('isInWindow / forwardMinutes helpers', () => {
  it('same-day window is [from, to)', () => {
    expect(isInWindow(9 * 60, 9 * 60, 17 * 60)).toBe(true); // exactly at from
    expect(isInWindow(17 * 60, 9 * 60, 17 * 60)).toBe(false); // exactly at to
    expect(isInWindow(8 * 60, 9 * 60, 17 * 60)).toBe(false);
  });
  it('zero-length window never opens', () => {
    expect(isInWindow(9 * 60, 9 * 60, 9 * 60)).toBe(false);
  });
  it('wrapping window (22:00–06:00) spans midnight', () => {
    expect(isInWindow(23 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isInWindow(3 * 60, 22 * 60, 6 * 60)).toBe(true);
    expect(isInWindow(12 * 60, 22 * 60, 6 * 60)).toBe(false);
  });
  it('forwardMinutes wraps past midnight', () => {
    expect(forwardMinutes(16 * 60 + 50, 17 * 60)).toBe(10);
    expect(forwardMinutes(23 * 60, 1 * 60)).toBe(120);
    expect(forwardMinutes(9 * 60, 9 * 60)).toBe(0);
  });
});

describe('stepNablStopwatch — START (edge cases 11-14, 22)', () => {
  it('starts when the window opens on a scheduled, open day (#12)', () => {
    const patch = stepNablStopwatch(fresh, cfg(), true, null, at(1, 9));
    expect(patch).toEqual({
      isNablTat: true,
      tatStartAt: at(1, 9),
      tatIsRunning: true,
      tatLastTickAt: at(1, 9),
      tatNetMinutes: 0,
      tatMaxMinutes: 240,
      tatBand: 'WITHIN',
    });
  });

  it('does not start before processingTimeFrom (#11)', () => {
    expect(stepNablStopwatch(fresh, cfg(), true, null, at(1, 8))).toBeNull();
  });

  it('does not start while the branch is closed even if in-window (Step 1)', () => {
    expect(stepNablStopwatch(fresh, cfg(), false, null, at(1, 12))).toBeNull();
  });

  it('does not start on a non-scheduled day (#15)', () => {
    const c = cfg({ scheduleDays: [DayOfWeek.TUESDAY] });
    expect(stepNablStopwatch(fresh, c, true, null, at(1, 12))).toBeNull(); // Monday
  });

  it('starts immediately when accepted after From already passed (#14)', () => {
    const patch = stepNablStopwatch(fresh, cfg(), true, null, at(1, 14));
    expect(patch).toMatchObject({ tatIsRunning: true, tatNetMinutes: 0 });
  });

  it('empty scheduleDays means every day (#16)', () => {
    const patch = stepNablStopwatch(
      fresh,
      cfg({ scheduleDays: [] }),
      true,
      null,
      at(6, 12), // Saturday
    );
    expect(patch).toMatchObject({ tatIsRunning: true });
  });
});

describe('stepNablStopwatch — ACCUMULATE (edge cases 25, 6)', () => {
  it('adds the elapsed minutes since the last tick while in-window', () => {
    const patch = stepNablStopwatch(
      running(60, at(1, 10)),
      cfg(),
      true,
      null,
      at(1, 10, 1),
    );
    expect(patch).toEqual({
      tatNetMinutes: 61,
      tatLastTickAt: at(1, 10, 1),
      tatMaxMinutes: 240,
      tatBand: 'WITHIN',
    });
  });

  it('never resets tatStartAt on later ticks (duplicate-START guard #22)', () => {
    const patch = stepNablStopwatch(
      running(60, at(1, 10)),
      cfg(),
      true,
      null,
      at(1, 10, 1),
    );
    expect(patch).not.toHaveProperty('tatStartAt');
    expect(patch).not.toHaveProperty('isNablTat');
  });

  it('clamps the added minutes to the window end (never over-counts #25)', () => {
    // last tick 16:50, now 16:55 — 5 min, all inside the window.
    const patch = stepNablStopwatch(
      running(100, at(1, 16, 50)),
      cfg(),
      true,
      null,
      at(1, 16, 55),
    );
    expect(patch).toMatchObject({ tatNetMinutes: 105 });
  });

  it('only advances the tick clock while the branch is closed (#6, Step 1)', () => {
    const patch = stepNablStopwatch(
      running(60, at(1, 12)),
      cfg(),
      false, // branch closed mid-window
      null,
      at(1, 12, 1),
    );
    expect(patch).toEqual({ tatLastTickAt: at(1, 12, 1) });
  });

  it('adopts the tick clock with no add when a running report has no last tick', () => {
    const patch = stepNablStopwatch(
      { ...running(60, at(1, 12)), tatLastTickAt: null },
      cfg(),
      true,
      null,
      at(1, 12, 1),
    );
    expect(patch).toEqual({ tatLastTickAt: at(1, 12, 1) });
  });

  it('bands as BREACHED once accrued minutes exceed Max TAT (#21)', () => {
    const patch = stepNablStopwatch(
      running(240, at(1, 12)),
      cfg(),
      true,
      null,
      at(1, 12, 1),
    );
    expect(patch).toMatchObject({ tatNetMinutes: 241, tatBand: 'BREACHED' });
  });

  it('leaves band null when no Max TAT is configured (#20)', () => {
    const patch = stepNablStopwatch(
      running(60, at(1, 12)),
      cfg({ tatMaxValue: null, tatMaxUnit: null }),
      true,
      null,
      at(1, 12, 1),
    );
    expect(patch).toMatchObject({ tatMaxMinutes: null, tatBand: null });
  });
});

describe('stepNablStopwatch — PAUSE (edge cases 13, 23)', () => {
  it('pauses at the window end, adding the final sliver clamped to To', () => {
    // last tick 16:50, now 17:30 — only the 10 min up to 17:00 count.
    const patch = stepNablStopwatch(
      running(100, at(1, 16, 50)),
      cfg(),
      true,
      null,
      at(1, 17, 30),
    );
    expect(patch).toEqual({
      tatIsRunning: false,
      tatNetMinutes: 110,
      tatEndAt: at(1, 17, 30),
      tatLastTickAt: at(1, 17, 30),
      tatMaxMinutes: 240,
      tatBand: 'WITHIN',
    });
  });

  it('pauses even when the branch is already closed (never hangs running)', () => {
    const patch = stepNablStopwatch(
      running(100, at(1, 16, 50)),
      cfg(),
      false,
      null,
      at(1, 17, 30),
    );
    expect(patch).toMatchObject({
      tatIsRunning: false,
      tatEndAt: at(1, 17, 30),
    });
  });

  it('does not re-pause a report already paused for the day (guard #23)', () => {
    // Paused, now still past the window end → nothing to do.
    expect(
      stepNablStopwatch(paused(120), cfg(), true, null, at(1, 18)),
    ).toBeNull();
  });
});

describe('stepNablStopwatch — RESUME (edge cases 7, 24)', () => {
  it('resumes a paused report next scheduled day, preserving accrued minutes', () => {
    const patch = stepNablStopwatch(
      paused(120),
      cfg(),
      true,
      null,
      at(2, 9, 30),
    );
    expect(patch).toEqual({
      tatIsRunning: true,
      tatLastTickAt: at(2, 9, 30),
    });
    expect(patch).not.toHaveProperty('tatNetMinutes'); // accrued total untouched
  });

  it('does not resume while the branch is closed', () => {
    expect(
      stepNablStopwatch(paused(120), cfg(), false, null, at(2, 9, 30)),
    ).toBeNull();
  });

  it('does not resume outside the window', () => {
    expect(
      stepNablStopwatch(paused(120), cfg(), true, null, at(2, 8)),
    ).toBeNull();
  });
});

describe('stepNablStopwatch — wrapping window & timezone (edge cases 18, 35)', () => {
  it('starts inside a window that wraps past midnight', () => {
    const c = cfg({ processingTimeFrom: '22:00', processingTimeTo: '06:00' });
    expect(stepNablStopwatch(fresh, c, true, null, at(1, 23))).toMatchObject({
      tatIsRunning: true,
    });
    expect(stepNablStopwatch(fresh, c, true, null, at(2, 3))).toMatchObject({
      tatIsRunning: true,
    }); // spill after midnight
    expect(stepNablStopwatch(fresh, c, true, null, at(2, 12))).toBeNull();
  });

  it('evaluates the window in the branch timezone (#35)', () => {
    // 06:30 UTC == 12:00 IST (UTC+5:30) → inside 09:00–17:00 local.
    const patch = stepNablStopwatch(
      fresh,
      cfg(),
      true,
      'Asia/Kolkata',
      at(1, 6, 30),
    );
    expect(patch).toMatchObject({ tatIsRunning: true });
    // 04:00 UTC == 09:30 IST → in-window; 03:00 UTC == 08:30 IST → not yet.
    expect(
      stepNablStopwatch(fresh, cfg(), true, 'Asia/Kolkata', at(1, 3)),
    ).toBeNull();
  });
});
