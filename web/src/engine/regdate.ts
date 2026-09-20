/**
 * Register dates: (day, month, year) triples that are allowed to be
 * impossible. 31 February and 54 October are legitimate intermediate states
 * in this system (R4.2), which is why Date is never used here.
 */
import { int, monthLen } from "./calendar";
import type { LeapRule } from "./policy";

export interface RegDate {
  readonly d: number;
  readonly m: number;
  readonly y: number;
  /** The bracketed notional day of a clamped date, R4.4. */
  readonly notional?: number;
}

export function regDate(d: number, m: number, y: number, notional?: number): RegDate {
  int(d, "day");
  int(m, "month");
  int(y, "year");
  return notional ? { d, m, y, notional } : { d, m, y };
}

/** R4.4. A date that does not exist is written real(notional): 28(30)-2-73. */
export function format(dt: RegDate): string {
  const day = dt.notional ? `${dt.d}(${dt.notional})` : String(dt.d);
  return `${day}-${dt.m}-${dt.y}`;
}

export function isImpossible(dt: RegDate, rule: LeapRule = "gregorian"): boolean {
  return dt.d > monthLen(dt.m, dt.y, rule) || dt.d < 1;
}

export function isMonthEnd(dt: RegDate, rule: LeapRule = "gregorian"): boolean {
  return dt.d === monthLen(dt.m, dt.y, rule);
}

/** R4.1. Normalise the month column only. Drops any notional. */
export function carryMonths(dt: RegDate): RegDate {
  let { m, y } = dt;
  const d = dt.d;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return { d, m, y };
}

/**
 * R4.2. Subtract the length of the month named in the current date, then
 * advance the month. Returns every intermediate state, first to last, so the
 * working can be shown line by line: 106-11-2005, 76-12-2005, 45-1-2006,
 * 14-2-2006 (p.5).
 */
export function rollForwardTrace(dt: RegDate, rule: LeapRule = "gregorian"): RegDate[] {
  let cur = carryMonths({ d: dt.d, m: dt.m, y: dt.y });
  const trace = [cur];
  while (cur.d > monthLen(cur.m, cur.y, rule)) {
    cur = carryMonths({ d: cur.d - monthLen(cur.m, cur.y, rule), m: cur.m + 1, y: cur.y });
    trace.push(cur);
  }
  return trace;
}

/** R4.2. The final state of rollForwardTrace. */
export function rollForward(dt: RegDate, rule: LeapRule = "gregorian"): RegDate {
  const trace = rollForwardTrace(dt, rule);
  return trace[trace.length - 1];
}

/** R4.5. Terminal impossible date takes the last real day, notional in brackets. */
export function clampBack(dt: RegDate, rule: LeapRule = "gregorian"): RegDate {
  const limit = monthLen(dt.m, dt.y, rule);
  if (dt.d > limit) return { d: limit, m: dt.m, y: dt.y, notional: dt.d };
  return dt;
}

/** R4.3. Borrow the length of the preceding month. */
export function subDays(dt: RegDate, n: number, rule: LeapRule = "gregorian"): RegDate {
  let d = dt.d - n;
  let m = dt.m;
  let y = dt.y;
  while (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d += monthLen(m, y, rule);
  }
  return { d, m, y };
}

/** Normalise first if the date is impossible, then add (R4.6). */
export function addDays(dt: RegDate, n: number, rule: LeapRule = "gregorian"): RegDate {
  const base = isImpossible(dt, rule) ? rollForward(dt, rule) : { d: dt.d, m: dt.m, y: dt.y };
  return rollForward({ d: base.d + n, m: base.m, y: base.y }, rule);
}

/** Rough day index, for comparisons only. */
export function ordinal(dt: RegDate): number {
  return dt.y * 372 + dt.m * 31 + dt.d;
}
