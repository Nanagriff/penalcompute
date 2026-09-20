/**
 * Form state and its conversion to the engine's wire format (CaseSpec).
 * Every value here is a string straight from an input; nothing is parsed
 * until toCaseSpec runs. No prisoner data anywhere (standing rule 7).
 */
import type { CaseSpec, WireDate, WireDuration, WirePolicy } from "../engine";

export interface DateInput { d: string; m: string; y: string }
export interface DurInput { days: string; weeks: string; months: string; years: string }

export const emptyDate = (): DateInput => ({ d: "", m: "", y: "" });
export const emptyDur = (): DurInput => ({ days: "", weeks: "", months: "", years: "" });

export const UI_SCENARIOS = [
  { id: "simple", label: "Single sentence" },
  { id: "additional", label: "Additional sentence before expiry (R8.1)" },
  { id: "counts", label: "Several counts, concurrent and consecutive (R8.2, R8.3)" },
  { id: "reduction", label: "Reduction or pardon (R8.4)" },
  { id: "single_escape", label: "Escape and recapture (R8.5)" },
  { id: "double_escape", label: "Two escapes (R8.6)" },
  { id: "bailed_out", label: "Bailed out and re-admitted (R8.7)" },
] as const;
export type UiScenario = (typeof UI_SCENARIOS)[number]["id"];

export const OFFENCE_CLASSES = [
  { id: "stealing", label: "Stealing" },
  { id: "fraud", label: "Fraud" },
  { id: "burglary", label: "Burglary" },
  { id: "robbery", label: "Robbery" },
  { id: "arson", label: "Arson" },
  { id: "assault", label: "Assault" },
  { id: "felony", label: "Other felony" },
  { id: "misdemeanour", label: "Other misdemeanour" },
  { id: "murder", label: "Murder" },
  { id: "debt", label: "Debtor (no remission)" },
  { id: "contempt", label: "Contempt of court (no remission)" },
  { id: "condemned", label: "Condemned (no remission)" },
  { id: "life", label: "Life (no remission)" },
] as const;

export interface CountInput { dur: DurInput; group: string }

export interface FormState {
  scenario: UiScenario;
  dateOfSentence: DateInput;
  sentence: DurInput;
  offenceClass: string;
  sex: "male" | "female";
  // additional
  second: DurInput;
  secondClass: string;
  // counts
  counts: CountInput[];
  // reduction, double escape
  cut: DurInput;
  // single escape
  dateOfEscape: DateInput;
  dateOfRecapture: DateInput;
  // double escape
  dateOfEscape1: DateInput;
  dateOfRecapture1: DateInput;
  dateOfEscape2: DateInput;
  dateOfRecapture2: DateInput;
  extraSentence: DurInput;
  // bailed out
  dateOfBail: DateInput;
  dateOfReadmission: DateInput;
  // adjustments after the EPD (single sentence only)
  forfeitedDays: string;
  hospital: boolean;
  hospitalFrom: DateInput;
  hospitalTo: DateInput;
  // policy switches (rule set, section 9)
  leapRule: WirePolicy["leap_rule"];
  monthEndPreservation: boolean;
  escapeRemissionBase: WirePolicy["escape_remission_base"];
}

export function initialState(): FormState {
  return {
    scenario: "simple",
    dateOfSentence: emptyDate(),
    sentence: emptyDur(),
    offenceClass: "stealing",
    sex: "male",
    second: emptyDur(),
    secondClass: "stealing",
    counts: [
      { dur: emptyDur(), group: "A" },
      { dur: emptyDur(), group: "A" },
    ],
    cut: emptyDur(),
    dateOfEscape: emptyDate(),
    dateOfRecapture: emptyDate(),
    dateOfEscape1: emptyDate(),
    dateOfRecapture1: emptyDate(),
    dateOfEscape2: emptyDate(),
    dateOfRecapture2: emptyDate(),
    extraSentence: emptyDur(),
    dateOfBail: emptyDate(),
    dateOfReadmission: emptyDate(),
    forfeitedDays: "",
    hospital: false,
    hospitalFrom: emptyDate(),
    hospitalTo: emptyDate(),
    leapRule: "gregorian",
    monthEndPreservation: true,
    escapeRemissionBase: "original",
  };
}

// --------------------------------------------------------------------------
// parsing
// --------------------------------------------------------------------------

export type Parsed =
  | { ok: true; spec: CaseSpec; sex: string }
  | { ok: false; errors: string[] };

function intOf(s: string): number | null {
  const t = s.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

function parseDate(v: DateInput, name: string, errors: string[]): WireDate | null {
  const d = intOf(v.d);
  const m = intOf(v.m);
  const y = intOf(v.y);
  if (v.d.trim() === "" || v.m.trim() === "" || v.y.trim() === "") {
    errors.push(`${name}: enter day, month and year`);
    return null;
  }
  if (d === null || m === null || y === null) {
    errors.push(`${name}: whole numbers only`);
    return null;
  }
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1 || y > 9999) {
    errors.push(`${name}: day 1-31, month 1-12, year as written on the warrant`);
    return null;
  }
  return [d, m, y];
}

function parseDur(v: DurInput, name: string, errors: string[], required: boolean): WireDuration | null {
  const days = intOf(v.days);
  const weeks = intOf(v.weeks);
  const months = intOf(v.months);
  const years = intOf(v.years);
  if (days === null || weeks === null || months === null || years === null) {
    errors.push(`${name}: whole numbers only`);
    return null;
  }
  const out = { days: days + 7 * weeks, months, years }; // R2.3
  if (required && out.days === 0 && out.months === 0 && out.years === 0) {
    errors.push(`${name}: enter a term`);
    return null;
  }
  return out;
}

function policyOf(s: FormState): WirePolicy {
  return {
    leap_rule: s.leapRule,
    month_end_preservation: s.monthEndPreservation,
    escape_remission_base: s.escapeRemissionBase,
  };
}

export function toCaseSpec(s: FormState): Parsed {
  const errors: string[] = [];
  const ds = parseDate(s.dateOfSentence, "Date of sentence", errors);
  const policy = policyOf(s);
  const cls = s.offenceClass;
  let spec: CaseSpec | null = null;

  switch (s.scenario) {
    case "simple": {
      const sentence = parseDur(s.sentence, "Sentence", errors, true);
      const forfeited = intOf(s.forfeitedDays);
      if (forfeited === null) errors.push("Days forfeited: whole numbers only");
      const inputs: Record<string, unknown> = { date_of_sentence: ds, sentence, offence_class: cls };
      if (s.hospital) {
        inputs.hospital_from = parseDate(s.hospitalFrom, "Admitted to hospital", errors);
        inputs.hospital_to = parseDate(s.hospitalTo, "Discharged from hospital", errors);
        if (forfeited) inputs.forfeited_days = forfeited;
        spec = { scenario: "hospital", inputs, policy };
      } else if (forfeited) {
        inputs.forfeited_days = forfeited;
        spec = { scenario: "forfeiture", inputs, policy };
      } else {
        spec = { scenario: "simple", inputs, policy };
      }
      break;
    }
    case "additional": {
      const first = parseDur(s.sentence, "First sentence", errors, true);
      const second = parseDur(s.second, "Additional sentence", errors, true);
      spec = {
        scenario: "additional",
        inputs: { date_of_sentence: ds, first, first_class: cls, second, second_class: s.secondClass },
        policy,
      };
      break;
    }
    case "counts": {
      const groups: WireDuration[][] = [];
      const order: string[] = [];
      s.counts.forEach((c, idx) => {
        const dur = parseDur(c.dur, `Count ${idx + 1}`, errors, false);
        if (!dur || (dur.days === 0 && dur.months === 0 && dur.years === 0)) return;
        let gi = order.indexOf(c.group);
        if (gi < 0) {
          order.push(c.group);
          groups.push([]);
          gi = groups.length - 1;
        }
        groups[gi].push(dur);
      });
      if (groups.length === 0) errors.push("Counts: enter at least one term");
      spec = { scenario: "counts", inputs: { date_of_sentence: ds, offence_class: cls, groups }, policy };
      break;
    }
    case "reduction": {
      const sentence = parseDur(s.sentence, "Sentence", errors, true);
      const cut = parseDur(s.cut, "Reduction", errors, true);
      spec = { scenario: "reduction", inputs: { date_of_sentence: ds, sentence, cut, offence_class: cls }, policy };
      break;
    }
    case "single_escape": {
      const sentence = parseDur(s.sentence, "Sentence", errors, true);
      spec = {
        scenario: "single_escape",
        inputs: {
          date_of_sentence: ds, sentence,
          date_of_escape: parseDate(s.dateOfEscape, "Date of escape", errors),
          date_of_recapture: parseDate(s.dateOfRecapture, "Date of recapture", errors),
          offence_class: cls,
        },
        policy,
      };
      break;
    }
    case "double_escape": {
      const sentence = parseDur(s.sentence, "Sentence", errors, true);
      spec = {
        scenario: "double_escape",
        inputs: {
          date_of_sentence: ds, sentence,
          date_of_escape_1: parseDate(s.dateOfEscape1, "First escape", errors),
          date_of_recapture_1: parseDate(s.dateOfRecapture1, "First recapture", errors),
          date_of_escape_2: parseDate(s.dateOfEscape2, "Second escape", errors),
          date_of_recapture_2: parseDate(s.dateOfRecapture2, "Second recapture", errors),
          extra_sentence: parseDur(s.extraSentence, "Further sentence", errors, false),
          cut: parseDur(s.cut, "Reduction", errors, false),
          offence_class: cls,
        },
        policy,
      };
      break;
    }
    case "bailed_out": {
      const sentence = parseDur(s.sentence, "Sentence", errors, true);
      spec = {
        scenario: "bailed_out",
        inputs: {
          date_of_sentence: ds, sentence,
          date_of_bail: parseDate(s.dateOfBail, "Date bailed out", errors),
          date_of_readmission: parseDate(s.dateOfReadmission, "Date re-admitted", errors),
          offence_class: cls,
        },
        policy,
      };
      break;
    }
  }

  if (errors.length || !spec) return { ok: false, errors };
  return { ok: true, spec, sex: s.sex };
}

/** The term that licence eligibility is judged on (R8.8): the total sentence. */
export function sentenceForLicence(spec: CaseSpec): WireDuration | null {
  const i = spec.inputs as Record<string, any>;
  if (spec.scenario === "additional") {
    const a = i.first as WireDuration;
    const b = i.second as WireDuration;
    return { days: a.days + b.days, months: a.months + b.months, years: a.years + b.years };
  }
  if (spec.scenario === "counts") return null; // shown from the resolved total instead
  return (i.sentence as WireDuration) ?? null;
}
