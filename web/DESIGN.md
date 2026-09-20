# Design direction

The subject is a custodial register: a ruled, columnar, handwritten document
kept by the Ghana Prisons Service, whose colours are brown and white. An
officer will compare the screen to their own hand computation column by
column, on a cheap Android phone, in daylight, and then print it to file
next to the hand computation. Everything below follows from that.

## Palette

| Token | Value | Use |
|---|---|---|
| `--brown` | `#4a2c17` | Service brown. The masthead band, headings, the Compute button, and the rules the booklet draws under a line. |
| `--brown-deep` | `#33200f` | Shade at the foot of the masthead and the pressed Compute button. |
| `--tan` | `#a67c52` | Input borders and the ledger's outer border. |
| `--tan-line` | `#dccbb4` | Faint ruling: the column lines between day, month and year, sheet edges, dividers. |
| `--sand` | `#f3ece1` | The desk behind the sheets, the ledger heading row, and the LPD and EPD rows. |
| `--paper` | `#ffffff` | The two sheets: the order form and the register page. |
| `--ink` | `#241a12` | Text. Warm near-black so it reads as writing on paper. |
| `--flag` | `#a3321c` | Annotation ink, a sealing-wax red. Used only for ambiguity flags, warnings and the provisional-calendar notice, so that this colour alone means "an officer must read this". It is deliberately not a brown, because brown is now the service colour and appears everywhere. |
| `--confirm` | `#2f5d3f` | Used only for a confirmed working-day discharge. Nothing else is green. |

Print is black on white regardless: every token collapses to black, white or
grey under `@media print`.

## Type, three families, all from the system

- **Masthead, sheet titles, credit**: `Georgia, "Noto Serif", "Times New Roman", "Droid Serif", serif`.
  The official-document voice. No web font, because the app is offline first
  and the system faces are the ones an officer already reads all day.
- **Register**: `ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", "Roboto Mono", "Droid Sans Mono", monospace`.
  Figures align in the columns only in a monospace face. "Roboto Mono" and
  "Droid Sans Mono" are in the stack because a cheap Android phone has
  neither Cascadia nor DejaVu.
- **Labels and helper text**: `system-ui, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`.
  Never used inside the register.

## Layout

A full-bleed brown masthead, then two white sheets on a sand desk. On a phone
the order sheet sits above the register sheet, and pressing Compute scrolls
the register into view. From 60rem the two sheets sit side by side, the
order on the left, the register on the right, and the page scrolls as one.

The register is the one bold element: a ruled ledger in the three columns
of the paper form, day, month, year, with faint tan ruling between the
columns, a brown rule under exactly the lines the booklet rules, and a sand
band across the LPD and EPD rows. A deduction's days, months and years sit
directly under the date's day, month and year, so the officer's eye can move
down the screen and down the hand working column by column. The fixed-width
text render is kept for copying and for the test vectors.

Everything around the ledger is quiet: the answers repeat once in a
sand-tinted block with a brown edge, flags are the only red, and the
working-day layer is a plain list. The version stamp appears only on the
printed page, where it matters for filing.

## Not done, on purpose

No web fonts, no icon set, no dark theme (the artefact is a paper register
and is printed), no rounded cards with grey shadows, no all-caps labels, no
decorative gradients beyond the slight shading of the masthead band, no
animation except the register appearing.
