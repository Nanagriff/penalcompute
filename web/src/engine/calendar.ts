/**
 * Calendar. Real calendar months (R2.1) and the leap-year rule (R2.4).
 * No Date object here or anywhere in the register arithmetic.
 */
import type { LeapRule } from "./policy";

const LONG = new Set([1, 3, 5, 7, 8, 10, 12]);

export const MONTH_NAME = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** R2.4. The booklet rule and the true rule agree for 1901-2099. */
export function isLeap(year: number, rule: LeapRule = "gregorian"): boolean {
  if (rule === "divideBy4") return year % 4 === 0;
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Length of a real calendar month (R2.1). */
export function monthLen(month: number, year: number, rule: LeapRule = "gregorian"): number {
  if (month === 2) return isLeap(year, rule) ? 29 : 28;
  return LONG.has(month) ? 31 : 30;
}

/** Throw on anything that is not a plain integer. Standing rule 3: no floats. */
export function int(v: number, what: string): number {
  if (!Number.isInteger(v)) throw new TypeError(`${what} must be an integer, got ${v}`);
  return v;
}

/** Exact integer division for non-negative operands: no float is ever formed. */
export function divmod(n: number, by: number): [number, number] {
  const r = n % by;
  return [(n - r) / by, r];
}
