/**
 * Working-day layer (A6). Deliberately separate from the computation.
 * This is the one file in the engine where Date is permitted, and it is
 * used only in UTC so no time zone can shift a day.
 */
import type { RegDate } from "./regdate";
import { format } from "./regdate";

// Fixed-date Ghana public holidays. Keyed by the year from which each applies,
// because this list has changed (Constitution Day added 2019, Founders' Day
// moved 2019). VERIFY against the Public Holidays Act and any Executive
// Instrument before relying on it.
const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number, since: number, name: string]> = [
  [1, 1, 1957, "New Year's Day"],
  [1, 7, 2019, "Constitution Day"],
  [3, 6, 1957, "Independence Day"],
  [5, 1, 1957, "May Day"],
  [8, 4, 2019, "Founders' Day"],
  [9, 21, 2019, "Kwame Nkrumah Memorial Day"],
  [12, 25, 1957, "Christmas Day"],
  [12, 26, 1957, "Boxing Day"],
];

/** Eid al-Fitr and Eid al-Adha are announced, not calculated. Populate per year. */
export const ANNOUNCED_HOLIDAYS: Record<number, Record<string, string>> = {};
export const CALENDAR_CONFIRMED_THROUGH = 2026;

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}
function plus(day: Date, n: number): Date {
  return new Date(day.getTime() + n * 86_400_000);
}
/** Monday = 0 … Sunday = 6, as Python's weekday(). */
function weekday(day: Date): number {
  return (day.getUTCDay() + 6) % 7;
}
function key(day: Date): string {
  return day.toISOString().slice(0, 10);
}
function div(a: number, b: number): number {
  const r = ((a % b) + b) % b;
  return (a - r) / b;
}
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Anonymous Gregorian algorithm, integers only. */
export function easter(year: number): Date {
  const a = mod(year, 19);
  const b = div(year, 100);
  const c = mod(year, 100);
  const d = div(b, 4);
  const e = mod(b, 4);
  const f = div(b + 8, 25);
  const g = div(b - f + 1, 3);
  const h = mod(19 * a + b - d - g + 15, 30);
  const i = div(c, 4);
  const k = mod(c, 4);
  const l = mod(32 + 2 * e + 2 * i - h - k, 7);
  const m = div(a + 11 * h + 22 * l, 451);
  const month = div(h + l - 7 * m + 114, 31);
  const day = mod(h + l - 7 * m + 114, 31) + 1;
  return utc(year, month, day);
}

/** Every public holiday in a year, keyed YYYY-MM-DD, weekend ones also observed Monday. */
export function holidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const [m, d, since, name] of FIXED_HOLIDAYS) {
    if (year >= since) out.set(key(utc(year, m, d)), name);
  }
  const e = easter(year);
  out.set(key(plus(e, -2)), "Good Friday");
  out.set(key(plus(e, 1)), "Easter Monday");
  // Farmers' Day: first Friday in December
  const dec = utc(year, 12, 1);
  out.set(key(plus(dec, mod(4 - weekday(dec), 7))), "Farmers' Day");
  for (const [k, v] of Object.entries(ANNOUNCED_HOLIDAYS[year] ?? {})) out.set(k, v);
  // Public Holidays Act: a holiday falling at the weekend is observed Monday
  for (const [k, name] of Array.from(out.entries())) {
    const day = new Date(k + "T00:00:00Z");
    const wd = weekday(day);
    if (wd >= 5) out.set(key(plus(day, 7 - wd)), `${name} (observed)`);
  }
  return out;
}

export interface Discharge {
  computed: string;
  discharge: string;
  weekday: string;
  direction: string;
  movedDays: number;
  reason: string | null;
  provisional: boolean;
  note: string;
}

export interface DischargeError {
  error: string;
}

/**
 * A6. Move the discharge to a working day. Forward at the EPD, because any
 * date before the LPD is lawful. BACKWARD at the LPD, because R7.4 forbids
 * detention past midnight on the LPD.
 */
export function dischargeDate(target: RegDate, isLpd = false): Discharge | DischargeError {
  const year = target.y > 1000 ? target.y : 1900 + target.y;
  const day = utc(year, target.m, target.d);
  if (
    Number.isNaN(day.getTime()) ||
    day.getUTCFullYear() !== year ||
    day.getUTCMonth() !== target.m - 1 ||
    day.getUTCDate() !== target.d
  ) {
    return { error: `${format(target)} is not a real date` };
  }
  const step = isLpd ? -1 : 1;
  let moved = day;
  let guard = 0;
  while (guard < 30) {
    const hol = holidays(moved.getUTCFullYear());
    if (weekday(moved) < 5 && !hol.has(key(moved))) break;
    moved = plus(moved, step);
    guard += 1;
  }
  const reason = holidays(year).get(key(day)) ?? (weekday(day) >= 5 ? "weekend" : null);
  const provisional = year > CALENDAR_CONFIRMED_THROUGH;
  return {
    computed: key(day),
    discharge: key(moved),
    weekday: WEEKDAY[weekday(moved)],
    direction: isLpd ? "backward (LPD, R7.4)" : "forward (EPD)",
    movedDays: Math.abs(Math.round((moved.getTime() - day.getTime()) / 86_400_000)),
    reason,
    provisional,
    note: provisional
      ? `holiday calendar unconfirmed beyond ${CALENDAR_CONFIRMED_THROUGH}; ` +
        "Eid dates are announced, not calculated"
      : "",
  };
}
