/**
 * Remission (R6) and the losses that eat into it (R7.2, R7.3).
 * All arithmetic in whole days at 30 days to the month. No floats.
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
 * R6.7. Remission is expressed in the same units as the sentence. A sentence
 * stated in days only takes its remission in days and is subtracted from the
 * date as days; any sentence carrying months or years takes its remission in
 * months and days at 30 days to the month.
 *
 * This matters. Kwesi Mensah, 100 days, earns 33 days. Subtracting 33 days
 * from 13-2-2006 gives 11-1-2006 and an EPD of 12-1-2006, which is what the
 * booklet prints. Subtracting the same 33 days rewritten as 1mth 3days gives
 * 10-1-2006 and an EPD of 11-1-2006, one day out. The two are not
 * interchangeable because a calendar month is not 30 days (R2.1 against R2.2).
 */
export function asSentenceUnits(n: number, sentence: Duration): Duration {
  if (sentence.months === 0 && sentence.years === 0) return new Duration(n);
  return Duration.fromDays(n);
}

/** R6.1 to R6.3. Returns the remission and the note naming the rule applied. */
export function remissionFor(sentence: Duration, offenceClass = "felony"): [Duration, string] {
  if (NO_REMISSION_CLASSES.has(offenceClass.toLowerCase())) {
    return [new Duration(), `no remission: ${offenceClass} (R6.1)`];
  }
  const total = sentence.totalDays;
  if (total < 31) return [new Duration(), "no remission: sentence below 31 days (R6.1)"];
  if (total <= 41) return [asSentenceUnits(total - 30, sentence), "ordinary remission (R6.2)"];
  return [asSentenceUnits(oneThird(total), sentence), "one-third remission (R6.3)"];
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
