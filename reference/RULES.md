# Ghana Prisons Service sentence computation: formalised rule set

Derived from the training booklet pages supplied (unnumbered page before 4, then
pages 4, 5, 7, 8, 9, 11, 12, 14, 15, 16, 18, 19). Pages 1, 2, 6, 10, 13, 17 and
20 were not available, so rules that live only on those pages are absent here and
are listed in section 9.

Every rule below is stated so that it can be executed without judgement. Where the
booklet does not settle a question, it is recorded in section 8 as an ambiguity
with a switch name, not silently resolved.

---

## 1. Inputs

A computation needs exactly four things:

| Input | Notes |
|---|---|
| Date of sentence (D/S) | day, month, year as written on the warrant |
| Sentence | expressed in days, weeks, months, years, or a mixture |
| Offence class | determines whether remission is earned at all |
| Court's order | single, concurrent, consecutive, aggregate, additional |

## 2. Two month conventions (the central rule)

**R2.1 Sentence months are real calendar months.** When a day column overflows,
you borrow or repay the true length of the month named in the date.

**R2.2 Remission months are 30 days, and a remission year is 360 days.** All
remission is computed by converting the sentence to a total day count at
30 days per month, dividing, and converting back at 30 days per month.

These two conventions operate inside the same sum. R2.1 governs the date lines;
R2.2 governs the deduction rows.

**R2.3 Weeks are 7 days.** (p.4, "5 weeks 2 days" is handled as 37 days.)

**R2.4 Leap year.** The booklet rule is: divisible by 4. The true rule is:
divisible by 4, except centuries, unless divisible by 400. The two agree for
every year from 1901 to 2099, so the booklet rule is safe for live warrants and
wrong for 1900 and 2100. Engine default is the true rule.

## 3. The skeleton

```
D/S
+ sentence                     (add day, month, year columns separately)
= normalise                    (R4)
- 1 day            Grace       -> LPD
- remission                    -> (intermediate)
+ 1 day            Add         -> EPD
+ forfeiture, hospital loss    -> adjusted EPD, capped at LPD (R7.4)
```

Where no remission is earned, the line after grace is the date of release (D/R)
and the computation stops there.

## 4. Date arithmetic

**R4.1 Addition is column-wise.** Add days to the day column, months to the
month column, years to the year column. Do not convert between columns.
Carry months: while month > 12, subtract 12 and add 1 to the year.

**R4.2 Day overflow rolls forward using the month named in the date.**
While the day exceeds the length of the current month, subtract that month's
length and advance the month by one.
Worked: `6-11-2005 + 100 days = 106-11-2005`; less 30 (Nov) = `76-12-2005`;
less 31 (Dec) = `45-1-2006`; less 31 (Jan) = `14-2-2006`. (p.5)

**R4.3 Day subtraction borrows from the preceding month.**
`1-3-72 - 1 day`: borrow February 1972 (29 days) -> `29-2-72`. (p.7)

**R4.4 A date that does not exist is written real(notional).**
`28(30)-2-73` means the notional position is 30 February and the actual date is
28 February. (p.7)

**R4.5 Terminal impossible dates clamp backwards.** An LPD or D/R that lands on
an impossible date takes the last real day of that month, never the first of the
next, because p.16 forbids detention beyond midnight on the LPD.
`31-2-73 - 1 grace = 30-2-73 -> 28(30)-2-73 D/R`. (p.7)

**R4.6 Intermediate impossible dates roll forward.** A date produced by the
remission deduction, which is always followed by the add-one-day line, is
normalised by R4.2.
`30-3-2011 - 4yrs 1mth = 30-2-2007 -> 2-3-2007`, then add 1 = `3-3-2007 EPD`. (p.11)

**R4.7 Month-end is preserved across whole-month subtraction.** If the date you
are subtracting from is the last day of its month, and the deduction contains no
days, the result is the last day of the target month.
`29-2-72 - 1 mth = 31(29)-1-72`, then add 1 = `1-2-72 EPD`. (p.7)
This is the rule behind the p.5 technique: a prisoner sentenced on the 1st of a
month to a term of months or years divisible by 3 is discharged on the 1st.

**R4.8 Difference between two dates.** Column-wise subtraction with borrowing
under R4.3, giving a result in days, months and years. Used for period served,
period at large, period in hospital and licence period.
`10-3-2007 - 15-12-2006 = 2mths 23days` (borrowing February 2007 = 28). (p.12)

## 5. Grace

**R5.1** One day, always, deducted once, immediately after the sentence has been
added and normalised. It exists because a sentence day ends at midnight and no
prisoner is released at midnight, so discharge is at 09:00 the previous day.

## 6. Remission

**R6.1 No remission at all** for: a debtor, contempt of court, a condemned
prisoner, a lifer, or any sentence below 31 days. (unnumbered p.3)
Note that a one-month sentence is 30 days under R2.2 and therefore earns nothing,
which is why `1-1-2007 + 1 month` is marked D/R on p.4.

**R6.2 Ordinary remission**, sentence total 31 to 41 days inclusive:
remission = total days - 30.
`37 days -> 7 days`. (p.4, p.5)

**R6.3 One-third remission**, sentence total 42 days or more:
remission = total days / 3.

**R6.4 Rounding.** Two-thirds of a day or more counts as a whole day; one-third
or less is discarded. Since the divisor is 3, the remainder is 0, 1 or 2:
round up only when the remainder is 2.
`284 / 3 = 94 r2 -> 95 days = 3mths 5days`. (p.8)
`100 / 3 = 33 r1 -> 33 days`. (p.5)

**R6.5** One-sixth remission exists in the booklet's list (take one year off the
sentence, divide the remainder by six) but appears in no worked example on the
pages supplied. It belongs to preventive custody and resurfaces at p.19(h) for
licence periods. Not implemented. See section 9.

**R6.6 Remission attaches only to the remissionable part of a mixed sentence.**
Paul Mensah, 6 months for debt plus 9mths 14days IHL: remission is one third of
9mths 14days only. (p.8)

## 7. Adjustments after the EPD

**R7.1 Forfeiture for misconduct.** Days forfeited are added back to the EPD.
The amendment must be initialled by the Officer-in-Charge and approved by the
Director General, and must be entered in all books and records. (p.16)

**R7.2 Hospital.** One day of remission lost for every three days spent in
hospital, unless the Medical Officer and the Officer-in-Charge recommend
restoration and the Director General approves.
`3mths 6days = 96 days -> 32 days = 1mth 2days lost`. (p.18)

**R7.3 Cellular confinement and reduced diet.** One day lost per three days of
punishment. If close confinement and reduced diet fall on the same date, take the
higher of the two and divide by three. If on different dates, add them together
and forfeit one third. (p.16)

**R7.4 Hard cap.** No forfeiture may push the adjusted EPD beyond midnight on the
LPD. (p.16) The engine caps and raises a flag rather than returning the excess.

**R7.5 Lunatic criminals.** No remission accrues for the period spent in a mental
hospital. Remission runs from the date of return to prison. The DG may restore
remission for the earlier period if conduct in hospital was good. (p.16)

## 8. Scenario rules

**R8.1 Additional sentence.** A further sentence imposed before the first expires
is added to it, and the computation runs from the **first** date of conviction,
not the later one. (p.7)

**R8.2 Concurrent.** Take the highest of the sentences in the group; if equal,
take one. (unnumbered p.3)

**R8.3 Consecutive or aggregate.** Add the sentences together. (unnumbered p.3)
With mixed orders, resolve each concurrent group to its highest first, then add
the groups. (p.9 example 2: counts 1, 3, 4 concurrent = 18mths; counts 2, 5, 6
concurrent = 2yrs; the two groups consecutive = 3yrs 6mths.)

**R8.4 Reduction or pardon.** Deduct from the sentence, then work from the
original D/S. Remission runs on the balance to serve. (p.10, p.11)

p.10, supplied 2026-09-20, lists the grounds: (a) an appeal substitutes a
lesser sentence, (b) a meritorious act such as helping to quell a riot, (c)
general amnesty. Rule (d): for (a) and (b) subtract the fresh sentence from
the original and start working from the first date of conviction, unless the
court makes a special order. Rule (e): amnesty follows the Government's
directive of the day. The Yaw Atta example (10yrs 4mths from 31-3-1998,
reduced by 3yrs on appeal decided 17-11-1999) never uses the appeal date: the
balance of 7yrs 4mths runs from 31-3-1998 to LPD 30-7-2005 and EPD 21-2-2003.
The date of the reduction is therefore recorded on the register, not computed
with. The question states the sentence as 10yrs 3mths and the working as
10yrs 4mths; the working is followed.

**R8.5 Single escape.** Period served = date of escape - D/S. Sentence remaining
= sentence - period served. Work forward from the date of recapture. The period at
large is simply lost; it is never added anywhere. (p.11, p.12)

**R8.6 Double escape.** First period served = 1st D/E - D/S. Second period served
= 2nd D/E - 1st D/R. Add the two, subtract from the total sentence, work forward
from the 2nd D/R. (p.14)

**R8.7 Bailed out.** Period served = date bailed out - D/S. Work forward from the
date of re-admission on the remainder. (p.12, p.13; the worked example is on p.13,
which was not supplied.)

**R8.8 Licence.** Licence period = LPD - EPD. Issued only to male prisoners, only
on a sentence of two years or more, and only for felony of the
earning-a-livelihood-by-dishonest-means class, including arson, excluding murder,
attempted murder and conspiracy to murder. Prison Form No. 10 goes to the local
police at least one week before release. (p.18, p.19)

## 9. Ambiguities: the switches

These are places where the booklet gives two answers or none. Each is a policy
switch in the engine. The engine can return both answers side by side.

**A1. `escape_remission_base`.** p.12 rule (h) says remission is granted on the
**original** sentence, because the prisoner earns it for the period served before
the escape as well as after. The worked example on the same page grants it on the
**residue**: it uses 7mths 2days, which is one third of the 1yr 9mths 7days
remaining, not the 8 months that one third of 2 years would give. The two
double-escape examples on p.15 and p.16 both use the total sentence, which agrees
with rule (h). So the p.12 example is the outlier. Default: `original`.

**A2. `remission_when_sentence_below_grace`.** Not addressed anywhere: what
happens when the remission exceeds the sentence remaining after grace. Engine
floors the EPD at the D/S and flags.

**A3. `terminal_abnormal`.** Whether an impossible LPD clamps back or rolls
forward. p.7 clamps for a D/R; p.11 rolls forward for an intermediate. Default
`clamp` for LPD and D/R, roll for intermediates, on the authority of p.16.

**A4. `month_end_preservation`.** p.7 applies it (`31(29)-1-72`). No example
shows what happens when the deduction contains both days and whole months.
Engine applies preservation only when the deduction has no days, and flags the
mixed case.

**A5. `hospital_rounding`.** p.18 divides 96 by 3 exactly. The rounding direction
for an inexact division is unstated. Engine uses R6.4 and flags.

**A6. Working-day discharge.** Not mentioned anywhere in the pages supplied.
Practice is that a prisoner due for discharge on a public holiday is released on
the next working day. Note the asymmetry: pushing forward is lawful at the EPD,
because any date before the LPD is lawful, but it is **not** lawful at the LPD,
where R7.4 forbids detention past midnight. An LPD falling on a holiday must
therefore move backwards, not forwards. This is the one holiday case the manual
method cannot flag and the engine must.

## 10. Known gaps in the supplied pages

- One-sixth remission: formula given, never demonstrated (R6.5).
- Imprisonment in default of payment of a fine: not covered.
- Remand time before sentence: not covered.
- Recording of life and condemned sentences: excluded from remission, no
  computation shown.
- The lettered general rules, the definition pages, technique 2 and 3, the
  bailed-out example, the forfeiture example and the two licence examples are
  on pages 1, 2, 6, 13, 17 and 20, which were not supplied. Page 10, with the
  reduction rules and example, was supplied later and is now under R8.4.

---

## 11. Rule found by testing, not by reading

**R6.7 Remission is expressed in the same units as the sentence.** A sentence
stated in days only takes its remission in days and is subtracted from the date
as days. A sentence carrying months or years takes its remission in months and
days at 30 days to the month.

This rule appears nowhere in the pages supplied. It surfaced only when the
engine disagreed with the booklet on Kwesi Mensah (p.5, 100 days from 6-11-2005).
One third of 100 days is 33 days. Subtracted as 33 days from the LPD of
13-2-2006 it gives 11-1-2006 and an EPD of 12-1-2006, which is what the booklet
prints. Rewritten as 1mth 3days and subtracted column-wise it gives 10-1-2006
and an EPD of 11-1-2006, one day out.

The two are not interchangeable, because R2.1 and R2.2 disagree about what a
month is. Any officer who converts a small day-remission into months for
convenience will be one or two days wrong, in the direction of holding a
prisoner too long, and nothing in the method will tell him. It is probably
stated on one of the missing pages. If it is not, it needs to be written down.
