import { useMemo, useState } from "react";
import {
  Duration, dischargeDate, format, licenceEligible, versionLine,
  type CaseOutcome, type CaseSpec, type RegDate,
} from "../engine";
import { Feedback } from "./Feedback";
import { Register } from "./Register";
import { OFFENCE_CLASSES, UI_SCENARIOS, sentenceForLicence } from "./state";

interface Props {
  spec: CaseSpec;
  outcome: CaseOutcome;
  sex: string;
}

const fmtWire = (v: unknown): string => {
  if (Array.isArray(v)) return `${v[0]}-${v[1]}-${v[2]}`;
  if (v && typeof v === "object" && "days" in (v as object)) {
    const o = v as { days: number; months: number; years: number };
    return new Duration(o.days, o.months, o.years).format();
  }
  return String(v);
};

const INPUT_LABELS: Record<string, string> = {
  date_of_sentence: "Date of sentence", sentence: "Sentence", offence_class: "Offence class",
  first: "First sentence", first_class: "First offence class", second: "Additional sentence",
  second_class: "Additional offence class", cut: "Reduction", date_of_escape: "Date of escape",
  date_of_recapture: "Date of recapture", date_of_escape_1: "First escape",
  date_of_recapture_1: "First recapture", date_of_escape_2: "Second escape",
  date_of_recapture_2: "Second recapture", extra_sentence: "Further sentence",
  date_of_bail: "Date bailed out", date_of_readmission: "Date re-admitted",
  hospital_from: "Admitted to hospital", hospital_to: "Discharged from hospital",
  forfeited_days: "Days forfeited",
};

function Discharge({ date, isLpd, label }: { date: RegDate; isLpd: boolean; label: string }) {
  const r = dischargeDate(date, isLpd);
  if ("error" in r) return <li className="flag">{label}: {r.error}</li>;
  const moved = r.movedDays > 0;
  return (
    <li className={r.provisional ? "flag" : moved ? "confirm" : ""}>
      <span className="k">{label}</span>{" "}
      <span className="mono">{r.discharge}</span> ({r.weekday})
      {moved
        ? ` : moved ${r.movedDays} day${r.movedDays > 1 ? "s" : ""} ${isLpd ? "back" : "forward"}` +
          (r.reason ? `, ${r.reason}` : "") + (isLpd ? " (R7.4: never past midnight on the LPD)" : "")
        : " : a working day, unchanged"}
      {r.provisional && <> . Provisional: {r.note}.</>}
    </li>
  );
}

export function ResultView({ spec, outcome, sex }: Props) {
  const { result, expect } = outcome;
  const [copied, setCopied] = useState(false);

  const licence = useMemo(() => {
    const cls = String(spec.inputs.offence_class ?? spec.inputs.first_class ?? "felony");
    const wire = sentenceForLicence(spec);
    let term: Duration | null = wire ? new Duration(wire.days, wire.months, wire.years) : null;
    if (!term && typeof expect.total === "string") {
      // counts: judge on the resolved total
      term = null;
      const m = /(?:(\d+)yrs?)?\s*(?:(\d+)mths?)?\s*(?:(\d+)days?)?/.exec(expect.total);
      if (m) term = new Duration(Number(m[3] ?? 0), Number(m[2] ?? 0), Number(m[1] ?? 0));
    }
    return term ? licenceEligible(sex, term, cls) : null;
  }, [spec, expect, sex]);

  if (!result) return null;

  const scenarioLabel = UI_SCENARIOS.find((s) => s.id === spec.scenario)?.label
    ?? (spec.scenario === "hospital" || spec.scenario === "forfeiture" ? "Single sentence with adjustments" : spec.scenario);
  const clsLabel = (id: unknown) => OFFENCE_CLASSES.find((o) => o.id === id)?.label ?? String(id);
  const extras = Object.entries(expect).filter(([k]) =>
    ["total", "balance", "hospital_period", "hospital_loss"].includes(k));
  const EXTRA_LABELS: Record<string, string> = {
    total: "Sentence after resolving the counts", balance: "Balance to serve",
    hospital_period: "Period in hospital", hospital_loss: "Remission lost (R7.2)",
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(result!.renderStamped());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="result" aria-live="polite">
      <dl className="summary-inputs">
        <div><dt>Order</dt><dd>{scenarioLabel}</dd></div>
        {Object.entries(spec.inputs).map(([k, v]) => {
          if (k === "groups") {
            return (v as unknown[][]).map((g, gi) => (
              <div key={`g${gi}`}>
                <dt>Group {String.fromCharCode(65 + gi)}, concurrent</dt>
                <dd>{g.map(fmtWire).join(" ; ")}</dd>
              </div>
            ));
          }
          if (k === "policy") return null;
          const label = INPUT_LABELS[k] ?? k;
          const val = k.endsWith("_class") ? clsLabel(v) : fmtWire(v);
          if (val === "nil") return null;
          return <div key={k}><dt>{label}</dt><dd>{val}</dd></div>;
        })}
        {extras.map(([k, v]) => (
          <div key={k}><dt>{EXTRA_LABELS[k]}</dt><dd>{String(v)}</dd></div>
        ))}
      </dl>

      <Register lines={result.lines} />

      <dl className="answers">
        {result.dr && <div><dt>D/R</dt><dd className="mono">{format(result.dr)}</dd></div>}
        {result.lpd && <div><dt>LPD</dt><dd className="mono">{format(result.lpd)}</dd></div>}
        {result.epd && <div><dt>EPD</dt><dd className="mono">{format(result.epd)}</dd></div>}
        <div>
          <dt>Remission</dt>
          <dd>{result.remission.format()} <span className="note">{result.remissionNote}</span></dd>
        </div>
        {result.licencePeriod && (
          <div><dt>Licence period (R8.8)</dt><dd>{result.licencePeriod.format()}</dd></div>
        )}
        {licence && (
          <div>
            <dt>Licence</dt>
            <dd>{licence[0] ? "Eligible" : "Not eligible"}. {licence[1]}</dd>
          </div>
        )}
      </dl>

      {result.flags.length > 0 && (
        <ul className="flags" aria-label="Flags">
          {result.flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      <ul className="discharge" aria-label="Working-day discharge">
        <li className="head">Working-day discharge (A6). Separate from the computation above; the register dates stand.</li>
        {(result.epd ?? result.dr) && (
          <Discharge date={(result.epd ?? result.dr)!} isLpd={false} label={result.epd ? "EPD, next working day" : "D/R, next working day"} />
        )}
        {result.lpd && <Discharge date={result.lpd} isLpd label="LPD, previous working day" />}
      </ul>

      <p className="versions">{versionLine()}</p>

      <div className="chrome row actions">
        <button type="button" className="quiet" onClick={() => window.print()}>Print</button>
        <button type="button" className="quiet" onClick={() => void copy()}>{copied ? "Copied" : "Copy working"}</button>
      </div>
      {!__SINGLE_FILE__ && <Feedback spec={spec} result={result} />}
    </section>
  );
}
