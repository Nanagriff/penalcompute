/**
 * Scenarios (R8). Each one reduces the court's order to a single call of
 * compute() and records how it got there in the flags.
 */
import { compute } from "./compute";
import type { Result } from "./compute";
import { Duration, dateDiff } from "./duration";
import type { Policy } from "./policy";
import { DEFAULT_POLICY } from "./policy";
import type { RegDate } from "./regdate";
import { NO_REMISSION_CLASSES } from "./remission";

export function simple(
  ds: RegDate,
  sentence: Duration,
  offenceClass = "felony",
  policy: Policy = DEFAULT_POLICY,
): Result {
  return compute(ds, sentence, offenceClass, { policy });
}

/** R8.1: add the sentences, work from the FIRST date of conviction. */
export function additional(
  dsFirst: RegDate,
  first: Duration,
  firstClass: string,
  second: Duration,
  secondClass: string,
  policy: Policy = DEFAULT_POLICY,
): Result {
  const total = first.add(second);
  let earning = new Duration();
  for (const [dur, cls] of [[first, firstClass], [second, secondClass]] as const) {
    if (!NO_REMISSION_CLASSES.has(cls.toLowerCase())) earning = earning.add(dur); // R6.6
  }
  const res = compute(dsFirst, total, "felony", { remissionBase: earning, policy });
  res.flags.push(`R8.1: total sentence ${total.format()}, remission base ${earning.format()}`);
  return res;
}

/** R8.2 and R8.3: highest within each concurrent group, then add the groups. */
export function resolveCounts(groups: Duration[][]): Duration {
  let total = new Duration();
  for (const g of groups) {
    let best = g[0];
    for (const d of g) if (d.totalDays > best.totalDays) best = d; // first of equals, R8.2
    total = total.add(best);
  }
  return total;
}

/** R8.4: deduct, then work from the ORIGINAL date of sentence. */
export function reduction(
  ds: RegDate,
  sentence: Duration,
  cut: Duration,
  offenceClass = "felony",
  policy: Policy = DEFAULT_POLICY,
): Result {
  const balance = sentence.sub(cut);
  const res = compute(ds, balance, offenceClass, { policy });
  res.flags.push(
    `R8.4: ${sentence.format()} less ${cut.format()} = ${balance.format()}, worked from original D/S`,
  );
  return res;
}

/** R8.5, and the A1 switch on the remission base. */
export function singleEscape(
  ds: RegDate,
  sentence: Duration,
  dEscape: RegDate,
  dRecapture: RegDate,
  offenceClass = "felony",
  policy: Policy = DEFAULT_POLICY,
): Result {
  const served = dateDiff(dEscape, ds, policy);
  const residue = sentence.sub(served);
  const base = policy.escapeRemissionBase === "original" ? sentence : residue;
  const res = compute(dRecapture, residue, offenceClass, {
    remissionBase: base,
    labelDs: "D/R (recapture)",
    policy,
  });
  res.flags.splice(
    0, 0,
    `R8.5: served ${served.format()}, residue ${residue.format()}`,
    `A1: remission taken on the ${policy.escapeRemissionBase} ` +
      `(${base.format()}); the other reading gives a different EPD`,
  );
  return res;
}

/** R8.6. */
export function doubleEscape(
  ds: RegDate,
  sentence: Duration,
  dEscape1: RegDate,
  dRecapture1: RegDate,
  dEscape2: RegDate,
  dRecapture2: RegDate,
  extraSentence: Duration = new Duration(),
  cut: Duration = new Duration(),
  offenceClass = "felony",
  policy: Policy = DEFAULT_POLICY,
): Result {
  const served1 = dateDiff(dEscape1, ds, policy);
  const served2 = dateDiff(dEscape2, dRecapture1, policy);
  const served = served1.add(served2);
  const total = sentence.add(extraSentence).sub(cut);
  const residue = total.sub(served);
  const res = compute(dRecapture2, residue, offenceClass, {
    remissionBase: total,
    labelDs: "2nd D/R",
    policy,
  });
  res.flags.splice(
    0, 0,
    `R8.6: served ${served1.format()} + ${served2.format()} = ${served.format()}; ` +
      `total sentence ${total.format()}; residue ${residue.format()}`,
  );
  return res;
}

/** R8.7. */
export function bailedOut(
  ds: RegDate,
  sentence: Duration,
  dBail: RegDate,
  dReadmission: RegDate,
  offenceClass = "felony",
  policy: Policy = DEFAULT_POLICY,
): Result {
  const served = dateDiff(dBail, ds, policy);
  const residue = sentence.sub(served);
  const res = compute(dReadmission, residue, offenceClass, {
    remissionBase: sentence,
    labelDs: "D/R (re-admission)",
    policy,
  });
  res.flags.splice(0, 0, `R8.7: served ${served.format()}, residue ${residue.format()}`);
  return res;
}

// --------------------------------------------------------------------------
// Licence eligibility (R8.8)
// --------------------------------------------------------------------------

export const LICENCE_CLASSES: ReadonlySet<string> = new Set([
  "stealing", "fraud", "arson", "burglary", "robbery", "felony",
]);
export const LICENCE_EXCLUDED: ReadonlySet<string> = new Set([
  "murder", "attempted murder", "conspiracy to murder",
]);

export function licenceEligible(sex: string, sentence: Duration, offence: string): [boolean, string] {
  const o = offence.toLowerCase();
  const s = sex.toLowerCase();
  if (s !== "m" && s !== "male") {
    return [
      false,
      "p.18(b): licence is not issued to female prisoners, on the " +
        "Ordinance's definition of 'convict' as male. Note this sits " +
        "awkwardly against Article 17 of the 1992 Constitution.",
    ];
  }
  if (LICENCE_EXCLUDED.has(o)) return [false, "p.18: excluded offence"];
  if (sentence.totalDays < 720) return [false, "p.18: sentence under two years"];
  if (!LICENCE_CLASSES.has(o)) {
    return [false, `p.18: '${offence}' is not in the dishonest-means felony class`];
  }
  return [true, "eligible; Prison Form No. 10 to local police at least one week before release"];
}
