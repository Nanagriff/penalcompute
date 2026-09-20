# Design direction (Task 3.0)

The subject is a custodial register: a ruled, columnar, handwritten document.
An officer will compare the screen to their own hand computation line by
line, on a cheap Android phone, in daylight, and then print it to file next
to the hand computation. Everything below follows from that.

## Palette, five values

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1a1a18` | All text and rules. Register ink, not pure black, so it reads as writing rather than as a screen. |
| `--paper` | `#fbfaf7` | The only background. Off-white so the page is paper, not a dialog. |
| `--rule` | `#c9c4b8` | Ruled lines and input borders. Lighter than ink so the writing sits on top of the ruling, as it does on the form. |
| `--flag` | `#8a5a2b` | Annotation ink. Used only for ambiguity flags, warnings and the provisional-calendar notice, so that colour alone means "an officer must read this". |
| `--confirm` | `#2f5d3f` | Used only for a confirmed working-day discharge. Nothing else is green, so green means exactly one thing. |

The brief's five values are kept unchanged. No sixth colour, no tints, no
shadows. Print is black on white regardless.

## Type, two families

- **Register**: `ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", "Roboto Mono", "Droid Sans Mono", monospace`.
  The columns only align in a monospace face, and alignment is the whole
  point of the layout. "Roboto Mono" and "Droid Sans Mono" are added to the
  brief's stack because a cheap Android phone has neither Cascadia nor
  DejaVu, and the generic `monospace` on Android is sometimes narrow enough
  to blur 3 against 8 in daylight.
- **Chrome and labels**: `system-ui, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`.
  A humanist sans for labels and helper text. It is never used inside the
  register.

## Layout

Single column on a phone, left aligned, no maximum width below 44rem: the
form sits above, the register below at full width as the hero of the result
view, then the flags, then the working-day layer. From 60rem the order and
the working sit side by side, the working column sticky, so an officer at a
desk can change an input and see the register move without scrolling. The
version stamp appears only on the printed page, where it matters for filing. No cards, no
shadows, no rounded corners: the register is a ruled table and the inputs
are boxes ruled in `--rule`, which is how a form looks on paper. Rules are
drawn only under the lines where the booklet draws them (the deduction
rows), as a 1px border in ink.

## Why it departs from a generic form-and-result page

- The register is rendered from the engine's `lines`, one table row per
  line, in the three ruled columns of the paper form: day, month, year. A
  deduction's days, months and years sit directly under the date's day,
  month and year, so the officer's eye can move down the screen and down
  the hand working column by column. The fixed-width text render is kept
  for copying and for the vectors.
- The answer is not enlarged or boxed. The working is the product; the LPD
  and EPD are simply the labelled lines in it, repeated once as a plain
  summary for the print footer.
- Colour carries meaning, not decoration: brown means "read this",
  green means "confirmed working day", and everything else is ink on paper.
- Three separate number inputs for a date, in the order a warrant is read,
  not a date picker.
- The only animation is the result appearing.

## Not done, on purpose

No rounded cards with soft grey shadows, no cream-and-terracotta accent,
(the only small-caps text is the "Ghana Prisons Service" masthead line and
the section title above the form, both in ink), no dark theme (the artefact is a paper
register and is printed), no icon set, no web fonts (offline first, and
the system faces are the ones an officer already reads all day).
