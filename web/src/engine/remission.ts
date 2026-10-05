/**
 * Remission (R6) and the losses that eat into it (R7.2, R7.3).
 * Remission is divided column by column, remainders carried down at 30 days
 * to the month (R2.2, R6.7); days never carry back up into months. No floats.
 */
import { divmod } from "./calendar";
import { Duration } from "./duration";

export const NO_REMISSION_CLASSES: ReadonlySet<string> = new Set([
  "debt", "debtor", "contempt", "condemned", "life", "lifer",
]);

/** R6.3 with R6.4 rounding, integers only: round up on a remainder of 2. */
export function oneThird(totalDays: number): number {
  const [q, r] = divmod(totalDays, 3);
  return q + (r === 2 ? 1 : 0);
}

/**
 * R6.3 worked column by column, as the register does it (R6.7).
 *
 * Years are divided by three and the remainder carried down into months at
 * twelve to the year; months are divided by three and the remainder carried
 * down into days at 30 to the month (R2.2); the days are divided by three
 * with R6.4 rounding. Nothing is ever carried back up: a day column of 30 or
 * more stays in the day column. The total in days is the same as one third of
 * the whole sentence at 30 days to the month, and so is the rounding, since
 * 360 and 30 are both multiples of three.
 *
 * This matters because the day column is subtracted as calendar days and the
 * month column as calendar months (R2.1). Kwesi Mensah, 100 days, earns 33
 * days. Subtracting 33 days from 13-2-2006 gives 11-1-2006 and an EPD of
 * 12-1-2006, which is what the booklet prints; 1mth 3days would give
 * 11-1-2006, one day out. A reviewer's case, 9mths 90days from 30-6-1995,
 * earns 3mths 30days, subtracted as 30 days and then 3 months from 27-6-1996
 * for an EPD of 29-2-1996; rolled up to 4mths it would give 28-2-1996.
 */
export function oneThirdColumns(sentence: Duration): Duration {
  const [years, ry] = divmod(sentence.years, 3);
  const [months, rm] = divmod(ry * 12 + sentence.months, 3);
  const days = oneThird(rm * 30 + sentence.days);
  return new Duration(days, months, years);
}

export const ONE_SIXTH_CUSTODY: ReadonlySet<string> = new Set([
  "preventive", "protective", "productive_hard_labour",
]);

/**
 * R6.5. Take one year off the sentence, then divide by six column by column,
 * remainders carried down as in R6.7. Returns the remission and whether the
 * division was exact. An inexact day column rounds up at two thirds and over
 * (R6.4); the notes show no such example, so the caller flags it.
 */
export function oneSixthColumns(sentence: Duration): [Duration, boolean] {
  const total = sentence.totalDays;
  if (total <= 360) return [new Duration(), true];
  let { years: y, months: m, days: d } = sentence;
  if (y >= 1) {
    y -= 1;
  } else {
    const rest = Duration.fromDays(total - 360);
    y = rest.years;
    m = rest.months;
    d = rest.days;
  }
  const [years, ry] = divmod(y, 6);
  const [months, rm] = divmod(ry * 12 + m, 6);
  const [days, rd] = divmod(rm * 30 + d, 6);
  return [new Duration(days + (rd >= 4 ? 1 : 0), months, years), rd === 0];
}

/** R6.1 to R6.5. Returns the remission and the note naming the rule applied. */
export function remissionFor(
  sentence: Duration,
  offenceClass = "felony",
  custody?: string | null,
): [Duration, string] {
  if (NO_REMISSION_CLASSES.has(offenceClass.toLowerCase())) {
    return [new Duration(), `no remission: ${offenceClass} (R6.1)`];
  }
  if (custody && ONE_SIXTH_CUSTODY.has(custody)) {
    const [rem] = oneSixthColumns(sentence);
    if (rem.totalDays === 0) {
      return [new Duration(), "no remission: one-sixth leaves nothing on this sentence (R6.5)"];
    }
    return [rem, "one-sixth remission (R6.5)"];
  }
  const total = sentence.totalDays;
  if (total < 31) return [new Duration(), "no remission: sentence below 31 days (R6.1)"];
  if (total <= 41) return [new Duration(total - 30), "ordinary remission (R6.2)"];
  return [oneThirdColumns(sentence), "one-third remission (R6.3)"];
}

/** R7.2. One day lost per three days in hospital. */
export function hospitalLoss(period: Duration): Duration {
  return Duration.fromDays(oneThird(period.totalDays));
}

/** R7.3. */
export function punishmentLoss(closeDays: number, dietDays: number, sameDate: boolean): Duration {
  const base = sameDate ? Math.max(closeDays, dietDays) : closeDays + dietDays;
  return Duration.fromDays(oneThird(base));
}
