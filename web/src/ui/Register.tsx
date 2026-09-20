import { format, type Line } from "../engine";

const LEFT = 14;

/**
 * The register, one table row per engine line. The left cell is the same
 * fourteen-character string the text render() produces, so the screen and
 * the hand working can be compared line by line (standing rule 5).
 */
export function Register({ lines }: { lines: Line[] }) {
  return (
    <table className="register" aria-label="Register working">
      <tbody>
        {lines.map((ln, i) => {
          const left = ln.date !== undefined ? format(ln.date).padStart(LEFT) : (ln.deduction ?? "").padStart(LEFT);
          const kind = ln.date !== undefined ? "date" : "deduction";
          const key = ln.label === "LPD" || ln.label === "EPD" || ln.label === "D/R" || ln.label === "EPD (adjusted)";
          return (
            <tr key={i} className={[kind, ln.rule ? "ruled" : "", key ? "key" : ""].join(" ").trim()}>
              <td className="cell">{left}</td>
              <td className="label">{ln.label}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
