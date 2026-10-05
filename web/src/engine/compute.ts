/**
 * The core computation: the skeleton of RULES.md section 3.
 *
 *   D/S
 *   + sentence                     (add day, month, year columns separately)
 *   = normalise                    (R4)
 *   - 1 day            Grace       -> LPD
 *   - remission                    -> (intermediate)
 *   + 1 day            Add         -> EPD
 *   + forfeiture, hospital loss    -> adjusted EPD, capped at LPD (R7.4)
 */
import { MONTH_NAME, monthLen } from "./calendar";
import { Duration, addSentence, borrowSteps, dateDiff, subDuration } from "./duration";
import type { BorrowStep } from "./duration";
import type { Policy } from "./policy";
import { DEFAULT_POLICY } from "./policy";
import type { RegDate } from "./regdate";
import {
  addDays, carryMonths, clampBack, format, isImpossible, isMonthEnd, ordinal, rollForward, subDays,
} from "./regdate";
import { hospitalLoss, oneSixthColumns, remissionFor } from "./remission";
import { VERSION, versionLine } from "./version";
import type { VersionStamp } from "./version";

export interface Line {
  date?: RegDate;
  deduction?: string;
  label: string;
  /** Draw a rule under this line. */
  rule: boolean;
  /** Arithmetic sign of a deduction line: added to, or taken from, the date above. */
  op?: "+" | "-";
}

const LEFT = 14;
const GAP = "   ";
const RULE = " ".repeat(LEFT) + GAP + "-".repeat(34);

export class Result {
  lpd: RegDate | null = null;
  epd: RegDate | null = null;
  dr: RegDate | null = null;
  licencePeriod: Duration | null = null;
  remission: Duration = new Duration();
  remissionNote = "";
  lines: Line[] = [];
  flags: string[] = [];
  readonly version: VersionStamp = VERSION;

  /**
   * The register layout, character-identical to the Python reference.
   * Standing rule 5: officers validate by comparing this to what they write
   * by hand. Do not redesign it.
   */
  render(): string {
    const out: string[] = [];
    for (const ln of this.lines) {
      const left = ln.date !== undefined ? format(ln.date).padStart(LEFT) : (ln.deduction ?? "").padStart(LEFT);
      out.push(`${left}${GAP}${ln.label}`);
      if (ln.rule) out.push(RULE);
    }
    if (this.flags.length) {
      out.push("");
      for (const f of this.flags) out.push(`  ! ${f}`);
    }
    return out.join("\n");
  }

  /** The register plus the version footer (Task 2.8). */
  renderStamped(): string {
    return `${this.render()}\n\n${versionLine()}`;
  }
}

export interface ComputeOptions {
  /**
   * Compute remission on something other than the term being added to the
   * date: a mixed sentence where only part earns remission (R6.6), or an
   * escape where rule (h) puts remission on the original sentence while the
   * term added is the residue (A1).
   */
  remissionBase?: Duration;
  forfeitedDays?: number;
  hospitalPeriod?: Duration;
  labelDs?: string;
  policy?: Policy;
  /** Preventive or protective custody, or productive hard labour: one-sixth remission (R6.5). */
  custody?: string | null;
  /** Special or restored remission in days, taken off after the add-one line (R7.6). */
  specialDays?: number;
}

const A7 =
  "A7: the date of sentence is not a month-end but the sentence lands on an " +
  "abnormal date; bracketed as for a month-end sentence, confirm by hand";

/** Calendar days from first to last, both ends counted. */
export function daysInclusive(first: RegDate, last: RegDate, policy: Policy = DEFAULT_POLICY): number {
  const rule = policy.leapRule;
  if (first.y === last.y && first.m === last.m) return last.d - first.d + 1;
  let n = monthLen(first.m, first.y, rule) - first.d + 1;
  let cur = carryMonths({ d: 1, m: first.m + 1, y: first.y });
  while (cur.y !== last.y || cur.m !== last.m) {
    n += monthLen(cur.m, cur.y, rule);
    cur = carryMonths({ d: 1, m: cur.m + 1, y: cur.y });
  }
  return n + last.d;
}

/** R8.9. Debtor's subsistence: days from D/S to D/R, both counted, at the daily rate. */
export function subsistence(
  ds: RegDate,
  dr: RegDate,
  ratePesewas: number,
  policy: Policy = DEFAULT_POLICY,
): [number, string] {
  const days = daysInclusive(ds, dr, policy);
  const total = days * ratePesewas;
  return [days, `GH¢${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`];
}

export function compute(
  ds: RegDate,
  sentence: Duration,
  offenceClass = "felony",
  opts: ComputeOptions = {},
): Result {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const rule = policy.leapRule;
  const forfeitedDays = opts.forfeitedDays ?? 0;
  const labelDs = opts.labelDs ?? "D/S";

  const res = new Result();
  const add = (ln: Line) => res.lines.push(ln);

  add({ date: ds, label: labelDs, rule: false });
  add({ deduction: sentence.columns(), label: "S", rule: true, op: "+" });

  const raw = addSentence(ds, sentence);
  add({ date: raw, label: "", rule: false });

  let cur = raw;
  if (sentence.days) {
    // normalise before grace when the sentence carried days, one month per
    // line exactly as the register shows it (R4.2)
    while (cur.d > monthLen(cur.m, cur.y, rule)) {
      const length = monthLen(cur.m, cur.y, rule);
      add({ deduction: String(length), label: MONTH_NAME[cur.m], rule: true, op: "-" });
      cur = carryMonths({ d: cur.d - length, m: cur.m + 1, y: cur.y });
      add({ date: cur, label: "", rule: false });
    }
  }

  const showBorrows = (steps: BorrowStep[]) => {
    for (const s of steps) {
      add({ deduction: s.figure, label: s.label, rule: true, op: "+" });
      add({ date: s.after, label: "", rule: false });
    }
  };

  showBorrows(borrowSteps(cur, new Duration(1), policy));
  add({ deduction: "1", label: "Grace", rule: true, op: "-" });
  cur = subDays(cur, 1, rule); // R5.1
  // A7: the notes write the bracket rule (P2) only for a sentence passed on
  // the last day of a month
  const unconfirmed = isImpossible(cur, rule) && !isMonthEnd(ds, rule);
  const specialDays = opts.specialDays ?? 0;

  const base = opts.remissionBase ?? sentence;
  const [rem, note] = remissionFor(base, offenceClass, opts.custody);
  res.remission = rem;
  res.remissionNote = note;

  if (rem.totalDays === 0) {
    cur = clampBack(cur, rule); // R4.5
    res.dr = cur;
    add({ date: cur, label: "D/R", rule: false });
    res.flags.push(note);
    if (unconfirmed) res.flags.push(A7);
    if (specialDays) {
      res.flags.push("R7.6: special remission not applied, there is no EPD to take it from");
    }
    return res;
  }

  if (isImpossible(cur, rule)) {
    cur = clampBack(cur, rule); // R4.5: never detain past the LPD
    res.flags.push("A3: LPD landed on an impossible date, clamped back (p.16)");
    if (unconfirmed) res.flags.push(A7);
  }
  res.lpd = cur;
  add({ date: cur, label: "LPD", rule: false });
  let remLabel: string;
  if (note.includes("sixth")) {
    remLabel = `1/6 Rem on ${base.format()} less 1yr`;
    if (!oneSixthColumns(base)[1]) {
      res.flags.push(
        "A8: one-sixth did not divide exactly; two thirds and over " +
          "rounded up (R6.4), the notes show no such example",
      );
    }
  } else {
    remLabel = note.includes("third") ? `1/3 Rem on ${base.format()}` : `Rem on ${base.format()}`;
  }
  showBorrows(borrowSteps(cur, rem, policy));
  add({ deduction: rem.columns(), label: remLabel, rule: true, op: "-" });

  const sub = subDuration(cur, rem, policy);
  cur = sub.date;
  res.flags.push(...sub.flags);
  add({ date: cur, label: "", rule: false });

  if (isImpossible(cur, rule)) {
    const length = monthLen(cur.m, cur.y, rule);
    add({ deduction: String(length), label: MONTH_NAME[cur.m], rule: true, op: "-" });
    cur = rollForward(cur, rule); // R4.6
    add({ date: cur, label: "", rule: false });
  }

  add({ deduction: "1", label: "Add", rule: true, op: "+" });
  cur = addDays(cur, 1, rule);
  res.epd = cur;
  add({ date: cur, label: "EPD", rule: false });

  // adjustments after the EPD (R7)
  let extra = new Duration();
  if (opts.hospitalPeriod !== undefined) {
    const loss = hospitalLoss(opts.hospitalPeriod);
    extra = extra.add(loss);
    add({ deduction: loss.columns(), label: "H/R/L", rule: true, op: "+" });
  }
  if (forfeitedDays) {
    extra = extra.add(new Duration(forfeitedDays));
    add({ deduction: String(forfeitedDays), label: "Forfeit", rule: true, op: "+" });
  }

  if (extra.totalDays) {
    cur = addDays(cur, extra.days, rule);
    cur = carryMonths({ d: cur.d, m: cur.m + extra.months, y: cur.y + extra.years });
    if (isImpossible(cur, rule)) cur = rollForward(cur, rule);
    res.epd = cur;
    add({ date: cur, label: "EPD (adjusted)", rule: false });
    if (res.lpd && ordinal(cur) > ordinal(res.lpd)) {
      res.epd = res.lpd;
      res.flags.push("R7.4: forfeiture pushed the EPD past the LPD; capped at the LPD");
    }
  }

  if (specialDays) {
    // R7.6: special and restored remission come off after the add-one line
    showBorrows(borrowSteps(res.epd, new Duration(specialDays), policy));
    add({ deduction: String(specialDays), label: "Spec Rem", rule: true, op: "-" });
    cur = subDays({ d: res.epd.d, m: res.epd.m, y: res.epd.y }, specialDays, rule);
    res.epd = cur;
    add({ date: cur, label: "EPD (amended)", rule: false });
  }

  if (res.lpd && res.epd) res.licencePeriod = dateDiff(res.lpd, res.epd, policy); // R8.8
  return res;
}
