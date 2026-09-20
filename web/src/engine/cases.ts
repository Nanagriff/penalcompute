/**
 * The wire format shared by the vectors, the UI and the feedback payload.
 * One abstract case in, one Result out. Mirrors run_case() in
 * reference/export_vectors.py scenario for scenario, so a reviewer's
 * disagreement can be converted straight into a test vector.
 *
 * dates      [d, m, y]
 * durations  {days, months, years}   (weeks already folded in, R2.3)
 * policy     the three switches, snake_case as the Python writes them
 */
import { compute } from "./compute";
import type { Result } from "./compute";
import { Duration, dateDiff } from "./duration";
import type { Policy } from "./policy";
import { policy as makePolicy } from "./policy";
import type { RegDate } from "./regdate";
import { format, regDate } from "./regdate";
import { hospitalLoss, oneThird, punishmentLoss } from "./remission";
import {
  additional, bailedOut, doubleEscape, licenceEligible, reduction, resolveCounts, simple,
  singleEscape,
} from "./scenarios";

export type WireDate = [number, number, number];
export interface WireDuration {
  days: number;
  months: number;
  years: number;
}
export interface WirePolicy {
  leap_rule: "gregorian" | "divide_by_4";
  month_end_preservation: boolean;
  escape_remission_base: "original" | "residue";
}

export const SCENARIOS = [
  "simple", "additional", "counts", "reduction", "single_escape", "double_escape",
  "bailed_out", "hospital", "forfeiture", "date_diff", "duration_sub", "one_third",
  "punishment_loss", "licence",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Every input key any scenario may carry. The feedback API rejects anything else. */
export const INPUT_KEYS = [
  "date_of_sentence", "sentence", "offence_class",
  "first", "first_class", "second", "second_class",
  "groups", "cut",
  "date_of_escape", "date_of_recapture",
  "date_of_escape_1", "date_of_recapture_1", "date_of_escape_2", "date_of_recapture_2",
  "extra_sentence", "date_of_bail", "date_of_readmission",
  "hospital_from", "hospital_to", "forfeited_days",
  "later", "earlier", "a", "b", "n", "close_days", "diet_days", "same_date",
  "sex", "offence",
] as const;

export interface CaseSpec {
  scenario: Scenario;
  inputs: Record<string, unknown>;
  policy?: Partial<WirePolicy>;
}

export interface CaseOutcome {
  /** The full register result, for scenarios that compute one. */
  result: Result | null;
  /** The vector-comparable view: every field a vector's `expect` may hold. */
  expect: Record<string, unknown>;
}

export function wireDate(v: unknown): RegDate {
  if (!Array.isArray(v) || v.length !== 3) throw new TypeError("a date is [d, m, y]");
  return regDate(v[0], v[1], v[2]);
}

export function wireDuration(v: unknown): Duration {
  const o = (v ?? {}) as Partial<WireDuration>;
  return new Duration(o.days ?? 0, o.months ?? 0, o.years ?? 0);
}

export function toWireDuration(d: Duration): WireDuration {
  return { days: d.days, months: d.months, years: d.years };
}

export function toWireDate(d: RegDate): WireDate {
  return [d.d, d.m, d.y];
}

export function policyFromWire(p: Partial<WirePolicy> = {}): Policy {
  return makePolicy({
    leapRule: p.leap_rule === "divide_by_4" ? "divideBy4" : "gregorian",
    monthEndPreservation: p.month_end_preservation ?? true,
    escapeRemissionBase: p.escape_remission_base === "residue" ? "residue" : "original",
  });
}

export function policyToWire(p: Policy): WirePolicy {
  return {
    leap_rule: p.leapRule === "divideBy4" ? "divide_by_4" : "gregorian",
    month_end_preservation: p.monthEndPreservation,
    escape_remission_base: p.escapeRemissionBase,
  };
}

const opt = <T,>(x: T | null, f: (v: T) => string): string | null => (x === null ? null : f(x));

function resultExpect(r: Result): Record<string, unknown> {
  return {
    lpd: opt(r.lpd, format),
    epd: opt(r.epd, format),
    dr: opt(r.dr, format),
    remission: r.remission.format(),
    remission_note: r.remissionNote,
    licence_period: opt(r.licencePeriod, (d) => d.format()),
    flags: [...r.flags],
    render: r.render(),
  };
}

function outcome(r: Result, extras: Record<string, unknown> = {}): CaseOutcome {
  return { result: r, expect: { ...resultExpect(r), ...extras } };
}

export function runCase(c: CaseSpec): CaseOutcome {
  const i = c.inputs as Record<string, any>;
  const p = policyFromWire(c.policy);
  const D = wireDate;
  const Dur = wireDuration;
  const cls = (v: unknown) => (typeof v === "string" ? v : "felony");

  switch (c.scenario) {
    case "simple":
      return outcome(simple(D(i.date_of_sentence), Dur(i.sentence), cls(i.offence_class), p));

    case "additional":
      return outcome(additional(D(i.date_of_sentence), Dur(i.first), cls(i.first_class),
        Dur(i.second), cls(i.second_class), p));

    case "counts": {
      const groups = (i.groups as unknown[][]).map((g) => g.map(Dur));
      const total = resolveCounts(groups);
      return outcome(compute(D(i.date_of_sentence), total, cls(i.offence_class), { policy: p }),
        { total: total.format() });
    }

    case "reduction":
      return outcome(reduction(D(i.date_of_sentence), Dur(i.sentence), Dur(i.cut),
        cls(i.offence_class), p),
        { balance: Dur(i.sentence).sub(Dur(i.cut)).format() });

    case "single_escape":
      return outcome(singleEscape(D(i.date_of_sentence), Dur(i.sentence),
        D(i.date_of_escape), D(i.date_of_recapture), cls(i.offence_class), p));

    case "double_escape":
      return outcome(doubleEscape(D(i.date_of_sentence), Dur(i.sentence),
        D(i.date_of_escape_1), D(i.date_of_recapture_1),
        D(i.date_of_escape_2), D(i.date_of_recapture_2),
        Dur(i.extra_sentence), Dur(i.cut), cls(i.offence_class), p));

    case "bailed_out":
      return outcome(bailedOut(D(i.date_of_sentence), Dur(i.sentence),
        D(i.date_of_bail), D(i.date_of_readmission), cls(i.offence_class), p));

    case "hospital": {
      const period = dateDiff(D(i.hospital_to), D(i.hospital_from), p);
      return outcome(compute(D(i.date_of_sentence), Dur(i.sentence), cls(i.offence_class),
        { hospitalPeriod: period, forfeitedDays: i.forfeited_days ?? 0, policy: p }),
        { hospital_period: period.format(), hospital_loss: hospitalLoss(period).format() });
    }

    case "forfeiture":
      return outcome(compute(D(i.date_of_sentence), Dur(i.sentence), cls(i.offence_class),
        { forfeitedDays: i.forfeited_days ?? 0, policy: p }));

    case "date_diff":
      return { result: null, expect: { diff: dateDiff(D(i.later), D(i.earlier), p).format() } };

    case "duration_sub":
      return { result: null, expect: { result: Dur(i.a).sub(Dur(i.b)).format() } };

    case "one_third":
      return { result: null, expect: { value: oneThird(i.n) } };

    case "punishment_loss":
      return {
        result: null,
        expect: { loss: punishmentLoss(i.close_days, i.diet_days, Boolean(i.same_date)).format() },
      };

    case "licence": {
      const [eligible, reason] = licenceEligible(cls(i.sex), Dur(i.sentence), cls(i.offence));
      return { result: null, expect: { eligible, reason } };
    }

    default:
      throw new Error(`unknown scenario ${String(c.scenario)}`);
  }
}
