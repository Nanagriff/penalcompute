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
import { Duration, addSentence, dateDiff, subDuration } from "./duration";
import type { Policy } from "./policy";
import { DEFAULT_POLICY } from "./policy";
import type { RegDate } from "./regdate";
import {
  addDays, carryMonths, clampBack, format, isImpossible, ordinal, rollForward, subDays,
} from "./regdate";
import { hospitalLoss, remissionFor } from "./remission";
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

  add({ deduction: "1", label: "Grace", rule: true, op: "-" });
  cur = subDays(cur, 1, rule); // R5.1

  const base = opts.remissionBase ?? sentence;
  const [rem, note] = remissionFor(base, offenceClass);
  res.remission = rem;
  res.remissionNote = note;

  if (rem.totalDays === 0) {
    cur = clampBack(cur, rule); // R4.5
    res.dr = cur;
    add({ date: cur, label: "D/R", rule: false });
    res.flags.push(note);
    return res;
  }

  if (isImpossible(cur, rule)) {
    cur = clampBack(cur, rule); // R4.5: never detain past the LPD
    res.flags.push("A3: LPD landed on an impossible date, clamped back (p.16)");
  }
  res.lpd = cur;
  add({ date: cur, label: "LPD", rule: false });
  add({
    deduction: rem.columns(),
    label: note.includes("third") ? `1/3 Rem on ${base.format()}` : `Rem on ${base.format()}`,
    rule: true,
    op: "-",
  });

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

  if (res.lpd && res.epd) res.licencePeriod = dateDiff(res.lpd, res.epd, policy); // R8.8
  return res;
}
