/**
 * Durations: register columns, 30-day months for remission (R2.2).
 * Also the column-wise date arithmetic that consumes them (R4.1, R4.3,
 * R4.7, R4.8).
 */
import { divmod, int, monthLen } from "./calendar";
import type { Policy } from "./policy";
import { DEFAULT_POLICY } from "./policy";
import type { RegDate } from "./regdate";
import { carryMonths, isMonthEnd, subDays } from "./regdate";

export interface DurationParts {
  days?: number;
  weeks?: number;
  months?: number;
  years?: number;
}

export class Duration {
  readonly days: number;
  readonly months: number;
  readonly years: number;

  constructor(days = 0, months = 0, years = 0) {
    this.days = int(days, "days");
    this.months = int(months, "months");
    this.years = int(years, "years");
  }

  /** R2.3. Weeks are 7 days. */
  static of({ days = 0, weeks = 0, months = 0, years = 0 }: DurationParts = {}): Duration {
    return new Duration(days + 7 * weeks, months, years);
  }

  /** R2.2. Remission months are 30 days, a remission year is 360 days. */
  get totalDays(): number {
    return this.years * 360 + this.months * 30 + this.days;
  }

  /** R2.2. Convert back at 30 days to the month. Integers only. */
  static fromDays(n: number): Duration {
    int(n, "days");
    const [years, remYear] = divmod(n, 360);
    const [months, days] = divmod(remYear, 30);
    return new Duration(days, months, years);
  }

  add(other: Duration): Duration {
    return Duration.fromDays(this.totalDays + other.totalDays);
  }

  sub(other: Duration): Duration {
    return Duration.fromDays(Math.max(0, this.totalDays - other.totalDays));
  }

  /** "1yr 2mths 3days", or "nil". */
  format(): string {
    const bits: string[] = [];
    if (this.years) bits.push(`${this.years}yr` + (this.years > 1 ? "s" : ""));
    if (this.months) bits.push(`${this.months}mth` + (this.months > 1 ? "s" : ""));
    if (this.days) bits.push(`${this.days}day` + (this.days > 1 ? "s" : ""));
    return bits.length ? bits.join(" ") : "nil";
  }

  toString(): string {
    return this.format();
  }

  /** The three register deduction columns: days, months, years. */
  columns(): string {
    const c = (v: number) => (v ? String(v) : "");
    return `${c(this.days).padStart(4)}   ${c(this.months).padStart(4)}   ${c(this.years).padStart(5)}`;
  }
}

/** R4.1. Column-wise, day column left impossible on purpose. */
export function addSentence(dt: RegDate, dur: Duration): RegDate {
  return carryMonths({ d: dt.d + dur.days, m: dt.m + dur.months, y: dt.y + dur.years });
}

/** Days first with borrowing, then whole months and years. R4.3, R4.7. */
export function subDuration(
  dt: RegDate,
  dur: Duration,
  policy: Policy = DEFAULT_POLICY,
): { date: RegDate; flags: string[] } {
  const flags: string[] = [];
  const wasMonthEnd = isMonthEnd(dt, policy.leapRule);
  let cur: RegDate = { d: dt.d, m: dt.m, y: dt.y };

  if (dur.days) cur = subDays(cur, dur.days, policy.leapRule);
  cur = carryMonths({ d: cur.d, m: cur.m - dur.months, y: cur.y - dur.years });

  if (wasMonthEnd && (dur.months || dur.years)) {
    if (dur.days) {
      flags.push(
        "A4: deduction mixes days with whole months from a month-end date; " +
          "month-end preservation not applied, booklet shows no example",
      );
    } else if (policy.monthEndPreservation) {
      const limit = monthLen(cur.m, cur.y, policy.leapRule);
      if (limit !== cur.d) cur = { d: limit, m: cur.m, y: cur.y, notional: cur.d }; // R4.7
    }
  }
  return { date: cur, flags };
}

/** R4.8. Column-wise with borrowing, used for period served and licence period. */
export function dateDiff(later: RegDate, earlier: RegDate, policy: Policy = DEFAULT_POLICY): Duration {
  let m = later.m;
  let y = later.y;
  let dd = later.d - earlier.d;
  if (dd < 0) {
    const [pm, py] = m > 1 ? [m - 1, y] : [12, y - 1];
    dd += monthLen(pm, py, policy.leapRule);
    m -= 1;
  }
  let mm = m - earlier.m;
  if (mm < 0) {
    mm += 12;
    y -= 1;
  }
  return new Duration(dd, mm, y - earlier.y);
}
