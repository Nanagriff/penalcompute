import type { DateInput, DurInput } from "./state";

const numeric = { inputMode: "numeric" as const, pattern: "[0-9]*", autoComplete: "off" };

interface DateFieldsProps {
  legend: string;
  value: DateInput;
  onChange: (v: DateInput) => void;
  hint?: string;
}

/** Day, month, year as three inputs, in the order a warrant is read. */
export function DateFields({ legend, value, onChange, hint }: DateFieldsProps) {
  const set = (k: keyof DateInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="date">
      <legend>{legend}</legend>
      <label>
        <span>Day</span>
        <input {...numeric} className="w2" value={value.d} onChange={set("d")} aria-label={`${legend}, day`} />
      </label>
      <span className="sep" aria-hidden="true">-</span>
      <label>
        <span>Month</span>
        <input {...numeric} className="w2" value={value.m} onChange={set("m")} aria-label={`${legend}, month`} />
      </label>
      <span className="sep" aria-hidden="true">-</span>
      <label>
        <span>Year</span>
        <input {...numeric} className="w4" value={value.y} onChange={set("y")} aria-label={`${legend}, year`} />
      </label>
      {hint && <small className="hint">{hint}</small>}
    </fieldset>
  );
}

interface DurationFieldsProps {
  legend: string;
  value: DurInput;
  onChange: (v: DurInput) => void;
  hint?: string;
}

/** Days, weeks, months, years. Weeks fold in at 7 days (R2.3). */
export function DurationFields({ legend, value, onChange, hint }: DurationFieldsProps) {
  const set = (k: keyof DurInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="duration">
      <legend>{legend}</legend>
      {(["years", "months", "weeks", "days"] as const).map((k) => (
        <label key={k}>
          <span>{k[0].toUpperCase() + k.slice(1)}</span>
          <input {...numeric} className="w3" value={value[k]} onChange={set(k)} aria-label={`${legend}, ${k}`} />
        </label>
      ))}
      {hint && <small className="hint">{hint}</small>}
    </fieldset>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  id: string;
}

export function Select({ label, value, onChange, options, id }: SelectProps) {
  return (
    <div className="select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
