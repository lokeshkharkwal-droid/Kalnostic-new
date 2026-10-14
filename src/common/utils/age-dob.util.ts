import { AgeType, AgeUnit } from '@prisma/client';

/**
 * Age <-> date-of-birth helpers.
 *
 * A patient's age is often typed without a date of birth ("34 years"). The stored
 * number goes stale, so we turn it into a date of birth the moment it is told:
 * today minus the age, subtracted exactly (20 years -> the same date 20 years ago).
 * Every function here works on CALENDAR DAYS held as UTC-midnight `Date`s, so the
 * result never shifts with the server's time zone.
 */

const DAY_MS = 86_400_000;
/** No patient is older than this; an age beyond it is not turned into a date of birth. */
const MAX_AGE_YEARS = 150;

/**
 * The calendar day an instant falls on in a time zone, as a UTC-midnight `Date`
 * (before 05:30 IST the UTC day is still "yesterday" — this returns the branch's day).
 * @param instant a real point in time
 * @param timeZone an IANA zone such as "Asia/Kolkata"; null/unknown reads the UTC day
 */
export function calendarDayIn(
  instant: Date,
  timeZone: string | null | undefined,
): Date {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const num = (type: Intl.DateTimeFormatPartTypes): number =>
        Number(parts.find((p) => p.type === type)?.value);
      return new Date(Date.UTC(num('year'), num('month') - 1, num('day')));
    } catch {
      // An unknown zone name falls through to the UTC day.
    }
  }
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
    ),
  );
}

/** Add whole months to a day; a day past the end of the target month lands on its last day (31 Mar - 1 month = 28/29 Feb). */
function addMonthsClamped(
  year: number,
  month: number,
  day: number,
  delta: number,
): Date {
  const total = year * 12 + month + delta;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const out = new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)),
  );
  // `Date.UTC` maps years 0-99 to 1900-1999; pin the real year.
  out.setUTCFullYear(targetYear);
  return out;
}

/**
 * The date of birth that makes a patient exactly `age` (in `ageType`) old on `onDay`:
 * days -> that many days back, months -> that many calendar months back (month-end
 * clamped), years -> that many years back. `null` when the age is not a sane whole
 * number or lands outside any believable date.
 * @param age the age as typed (0 is a real age: a newborn)
 * @param ageType its unit; unset means years
 * @param onDay the calendar day the age was told (UTC-midnight)
 */
export function dobFromAge(
  age: number | null | undefined,
  ageType: AgeType | null | undefined,
  onDay: Date,
): Date | null {
  if (age === null || age === undefined) return null;
  if (!Number.isInteger(age) || age < 0) return null;
  const unit = ageType ?? AgeType.YEARS;
  const years =
    unit === AgeType.YEARS
      ? age
      : unit === AgeType.MONTHS
        ? age / 12
        : age / 365;
  if (years > MAX_AGE_YEARS) return null;
  const y = onDay.getUTCFullYear();
  const m = onDay.getUTCMonth();
  const d = onDay.getUTCDate();
  if (unit === AgeType.DAYS) return new Date(Date.UTC(y, m, d - age));
  return addMonthsClamped(y, m, d, unit === AgeType.MONTHS ? -age : -12 * age);
}

/** Completed whole days / months / years between a date of birth and a day (all three counted separately). */
export interface CompletedAge {
  days: number;
  months: number;
  years: number;
}

/**
 * How many whole days, months and years a person born on `dob` has completed on `onDay`.
 * A month completes on the same day-of-month as the birth day, or on the month's last
 * day when the birth day does not exist in it (born 31 Jan: 1 month on 28/29 Feb).
 * `null` when `onDay` is before `dob`.
 */
export function completedAge(dob: Date, onDay: Date): CompletedAge | null {
  if (onDay.getTime() < dob.getTime()) return null;
  let months =
    (onDay.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (onDay.getUTCMonth() - dob.getUTCMonth());
  if (onDay.getUTCDate() < dob.getUTCDate()) {
    const lastDayOfMonth = new Date(
      Date.UTC(onDay.getUTCFullYear(), onDay.getUTCMonth() + 1, 0),
    ).getUTCDate();
    if (!(onDay.getUTCDate() === lastDayOfMonth)) months--;
  }
  return {
    days: Math.round((onDay.getTime() - dob.getTime()) / DAY_MS),
    months,
    years: Math.floor(months / 12),
  };
}

/**
 * Whether the age a person has on `onDay` (born on `dob`) lies inside a reference
 * range's age band — decided from the calendar, so there is nothing "partial" about
 * it. The band's lower end is inclusive and its upper end covers its whole unit
 * ("0 to 17 Years" includes someone 17 years and 364 days old).
 */
export function dobInAgeBand(
  dob: Date,
  onDay: Date,
  band: {
    ageFrom: number;
    ageFromUnit: AgeUnit;
    ageTo: number;
    ageToUnit: AgeUnit;
  },
): boolean | null {
  const done = completedAge(dob, onDay);
  if (!done) return null;
  const inUnit = (unit: AgeUnit): number =>
    unit === AgeUnit.DAYS
      ? done.days
      : unit === AgeUnit.MONTHS
        ? done.months
        : done.years;
  return (
    inUnit(band.ageFromUnit) >= band.ageFrom &&
    inUnit(band.ageToUnit) <= band.ageTo
  );
}

/**
 * The exact date of birth to age a patient by on `onDay`: the saved date of birth when
 * it is real (not in the future, not after `onDay`), otherwise the date the saved age
 * implies — the day the patient record was created minus that age. `null` when the
 * patient has neither.
 * @param patient the saved date of birth / age / unit and the record's creation instant
 * @param onDay the day the age is needed for (e.g. the sample collection day)
 * @param timeZone the branch's IANA zone, used to read the creation day
 */
export function exactBirthDate(
  patient: {
    dateOfBirth?: Date | null;
    age?: number | null;
    ageType?: AgeType | null;
    createdAt?: Date | null;
  },
  onDay: Date,
  timeZone: string | null | undefined,
): Date | null {
  const dob = patient.dateOfBirth;
  if (dob && !Number.isNaN(dob.getTime()) && dob.getTime() <= onDay.getTime()) {
    return dob;
  }
  if (patient.age === null || patient.age === undefined || !patient.createdAt) {
    return null;
  }
  const told = calendarDayIn(patient.createdAt, timeZone);
  const implied = dobFromAge(patient.age, patient.ageType, told);
  return implied && implied.getTime() <= onDay.getTime() ? implied : null;
}
