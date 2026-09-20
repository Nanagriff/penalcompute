import { type Line } from "../engine";

/**
 * The register, one table row per engine line, in the three ruled columns
 * of the paper form: day, month, year. A date puts its d, m and y in those
 * columns; a deduction puts its days, months and years under them, so the
 * screen can be read against the hand working column by column (standing
 * rule 5). The text render() keeps its own fixed-width layout for copying.
 */

interface Cells { d: string; m: string; y: string }

function dateCells(ln: Line): Cells {
  const dt = ln.date!;
  return { d: dt.notional ? `${dt.d}(${dt.notional})` : String(dt.d), m: String(dt.m), y: String(dt.y) };
}

/** Duration.columns() is `days(4)   months(4)   years(5)`; anything else is a bare day count. */
function deductionCells(s: string): Cells {
  if (s.length === 19 && s.slice(4, 7) === "   " && s.slice(11, 14) === "   ") {
    return { d: s.slice(0, 4).trim(), m: s.slice(7, 11).trim(), y: s.slice(14).trim() };
  }
  return { d: s.trim(), m: "", y: "" };
}

export function Register({ lines }: { lines: Line[] }) {
  return (
    <table className="register" aria-label="Register working">
      <thead>
        <tr>
          <th scope="col" className="op"><span className="visually-hidden">Sign</span></th>
          <th scope="col" className="cell d">Day</th>
          <th scope="col" className="cell m">Mth</th>
          <th scope="col" className="cell y">Year</th>
          <th scope="col" className="label"><span className="visually-hidden">Line</span></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((ln, i) => {
          const isDate = ln.date !== undefined;
          const c = isDate ? dateCells(ln) : deductionCells(ln.deduction ?? "");
          const key = ln.label === "LPD" || ln.label === "EPD" || ln.label === "D/R" || ln.label === "EPD (adjusted)";
          const cls = [isDate ? "date" : "deduction", ln.rule ? "ruled" : "", key ? "key" : ""].join(" ").trim();
          return (
            <tr key={i} className={cls}>
              <td className="op" aria-label={ln.op === "+" ? "add" : ln.op === "-" ? "subtract" : undefined}>
                {ln.op === "-" ? "\u2212" : ln.op ?? ""}
              </td>
              <td className="cell d">{c.d}</td>
              <td className="cell m">{c.m}</td>
              <td className="cell y">{c.y}</td>
              <td className="label">{ln.label}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
