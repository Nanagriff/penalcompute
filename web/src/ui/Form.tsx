import { DateFields, DurationFields, Select } from "./fields";
import { OFFENCE_CLASSES, UI_SCENARIOS, emptyDur, type FormState, type UiScenario } from "./state";

interface Props {
  state: FormState;
  onChange: (s: FormState) => void;
  onCompute: () => void;
  onClear: () => void;
  errors: string[];
}

const GROUPS = ["A", "B", "C", "D"].map((g) => ({ id: g, label: `Group ${g}` }));

export function Form({ state, onChange, onCompute, onClear, errors }: Props) {
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => onChange({ ...state, [k]: v });
  const sc = state.scenario;
  const sentenceLegend =
    sc === "additional" ? "First sentence" : sc === "counts" ? "" : "Sentence";

  return (
    <form
      className="chrome inputs sheet"
      onSubmit={(e) => {
        e.preventDefault();
        onCompute();
      }}
      noValidate
    >
      <h2 className="sheet-title">Court's order</h2>
      <Select
        id="scenario"
        label="Type of order"
        value={sc}
        options={UI_SCENARIOS}
        onChange={(v) => onChange({ ...state, scenario: v as UiScenario })}
      />

      <DateFields
        legend={sc === "single_escape" || sc === "double_escape" || sc === "bailed_out" || sc === "additional"
          ? "Date of sentence (first conviction)"
          : "Date of sentence"}
        value={state.dateOfSentence}
        onChange={set("dateOfSentence")}
        hint="As written on the warrant, day month year."
      />

      {sc !== "counts" && (
        <DurationFields legend={sentenceLegend} value={state.sentence} onChange={set("sentence")} />
      )}

      <Select
        id="offence"
        label={sc === "additional" ? "Offence class, first sentence" : "Offence class"}
        value={state.offenceClass}
        options={OFFENCE_CLASSES}
        onChange={set("offenceClass")}
      />

      {sc === "additional" && (
        <>
          <DurationFields legend="Additional sentence" value={state.second} onChange={set("second")}
            hint="Imposed before the first expires; worked from the first date of conviction (R8.1)." />
          <Select id="offence2" label="Offence class, additional sentence" value={state.secondClass}
            options={OFFENCE_CLASSES} onChange={set("secondClass")} />
        </>
      )}

      {sc === "counts" && (
        <div className="counts">
          <p className="hint">
            Counts in the same group run concurrently: the highest is taken (R8.2).
            Groups run consecutively and are added (R8.3).
          </p>
          {state.counts.map((c, idx) => (
            <div className="count" key={idx}>
              <DurationFields
                legend={`Count ${idx + 1}`}
                value={c.dur}
                onChange={(dur) => {
                  const counts = state.counts.slice();
                  counts[idx] = { ...c, dur };
                  onChange({ ...state, counts });
                }}
              />
              <Select
                id={`group-${idx}`}
                label="Concurrent group"
                value={c.group}
                options={GROUPS}
                onChange={(group) => {
                  const counts = state.counts.slice();
                  counts[idx] = { ...c, group };
                  onChange({ ...state, counts });
                }}
              />
            </div>
          ))}
          <div className="row">
            <button type="button" className="quiet"
              onClick={() => onChange({ ...state, counts: [...state.counts, { dur: emptyDur(), group: "A" }] })}>
              Add a count
            </button>
            {state.counts.length > 1 && (
              <button type="button" className="quiet"
                onClick={() => onChange({ ...state, counts: state.counts.slice(0, -1) })}>
                Remove last count
              </button>
            )}
          </div>
        </div>
      )}

      {sc === "reduction" && (
        <DurationFields legend="Reduction or pardon" value={state.cut} onChange={set("cut")}
          hint="Deducted from the sentence; remission runs on the balance, worked from the original date (R8.4)." />
      )}

      {sc === "single_escape" && (
        <>
          <DateFields legend="Date of escape" value={state.dateOfEscape} onChange={set("dateOfEscape")} />
          <DateFields legend="Date of recapture" value={state.dateOfRecapture} onChange={set("dateOfRecapture")} />
          <div className="select">
            <label htmlFor="a1">Remission base (A1)</label>
            <select id="a1" value={state.escapeRemissionBase}
              onChange={(e) => onChange({ ...state, escapeRemissionBase: e.target.value as FormState["escapeRemissionBase"] })}>
              <option value="original">Original sentence, rule (h)</option>
              <option value="residue">Residue, as the p.12 worked example</option>
            </select>
            <small className="hint">The booklet gives both answers. The other reading is shown as a flag.</small>
          </div>
        </>
      )}

      {sc === "double_escape" && (
        <>
          <DateFields legend="First escape" value={state.dateOfEscape1} onChange={set("dateOfEscape1")} />
          <DateFields legend="First recapture" value={state.dateOfRecapture1} onChange={set("dateOfRecapture1")} />
          <DateFields legend="Second escape" value={state.dateOfEscape2} onChange={set("dateOfEscape2")} />
          <DateFields legend="Second recapture" value={state.dateOfRecapture2} onChange={set("dateOfRecapture2")} />
          <DurationFields legend="Further sentence, if any" value={state.extraSentence} onChange={set("extraSentence")} />
          <DurationFields legend="Reduction, if any" value={state.cut} onChange={set("cut")} />
        </>
      )}

      {sc === "bailed_out" && (
        <>
          <DateFields legend="Date bailed out" value={state.dateOfBail} onChange={set("dateOfBail")} />
          <DateFields legend="Date re-admitted" value={state.dateOfReadmission} onChange={set("dateOfReadmission")} />
        </>
      )}

      {sc === "simple" && (
        <details className="adjust">
          <summary>Adjustments after the EPD (R7)</summary>
          <label className="inline">
            <span>Days forfeited for misconduct (R7.1)</span>
            <input inputMode="numeric" pattern="[0-9]*" className="w3" value={state.forfeitedDays}
              onChange={(e) => onChange({ ...state, forfeitedDays: e.target.value })} />
          </label>
          <label className="inline check">
            <input type="checkbox" checked={state.hospital}
              onChange={(e) => onChange({ ...state, hospital: e.target.checked })} />
            <span>Period in hospital (R7.2, one day lost per three)</span>
          </label>
          {state.hospital && (
            <>
              <DateFields legend="Admitted to hospital" value={state.hospitalFrom} onChange={set("hospitalFrom")} />
              <DateFields legend="Discharged from hospital" value={state.hospitalTo} onChange={set("hospitalTo")} />
            </>
          )}
        </details>
      )}

      <div className="select">
        <label htmlFor="sex">Sex, for licence eligibility only (R8.8)</label>
        <select id="sex" value={state.sex}
          onChange={(e) => onChange({ ...state, sex: e.target.value as FormState["sex"] })}>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      <details className="switches">
        <summary>Rule switches</summary>
        <label className="inline">
          <span>Leap year rule (R2.4)</span>
          <select value={state.leapRule}
            onChange={(e) => onChange({ ...state, leapRule: e.target.value as FormState["leapRule"] })}>
            <option value="gregorian">True rule (default)</option>
            <option value="divide_by_4">Booklet rule, divisible by 4</option>
          </select>
        </label>
        <label className="inline check">
          <input type="checkbox" checked={state.monthEndPreservation}
            onChange={(e) => onChange({ ...state, monthEndPreservation: e.target.checked })} />
          <span>Preserve month-end across whole-month subtraction (R4.7, A4)</span>
        </label>
      </details>

      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="row actions">
        <button type="submit">Compute</button>
        <button type="button" className="quiet" onClick={onClear}>Clear</button>
      </div>
      <p className="hint privacy">
        No case details are collected: there is no field for a name, prison number or file reference.
      </p>
    </form>
  );
}
