#!/usr/bin/env python3
"""
Ghana Prisons Service sentence computation engine.

Pure functions, standard library only, no network, no database. Every rule
reference in a comment points to a numbered rule in RULES.md.

Design notes
------------
* Dates are (day, month, year) triples that are allowed to be impossible.
  31 February and 54 October are legitimate intermediate states in this system,
  so datetime.date is deliberately not used for the register arithmetic.
* Remission is divided column by column, remainders carried down at 30 days
  to the month (R2.2, R6.7); days never carry back up into months.
  No floats anywhere: rounding is done on the integer remainder (R6.4).
* Where the booklet is ambiguous, Policy carries a switch and the result
  carries a flag. The engine never resolves an ambiguity silently.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import List, Optional, Tuple

# --------------------------------------------------------------------------
# Policy switches (RULES.md section 9)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Policy:
    leap_rule: str = "gregorian"             # "gregorian" | "divide_by_4" (R2.4)
    month_end_preservation: bool = True      # R4.7
    escape_remission_base: str = "original"  # "original" (rule h) | "residue" (A1)
    rule_set_version: str = "booklet-as-supplied"


DEFAULT = Policy()


# --------------------------------------------------------------------------
# Calendar
# --------------------------------------------------------------------------

LONG = {1, 3, 5, 7, 8, 10, 12}
MONTH_NAME = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def is_leap(year: int, policy: Policy = DEFAULT) -> bool:
    """R2.4. The booklet rule and the true rule agree for 1901-2099."""
    if policy.leap_rule == "divide_by_4":
        return year % 4 == 0
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def month_len(month: int, year: int, policy: Policy = DEFAULT) -> int:
    if month == 2:
        return 29 if is_leap(year, policy) else 28
    return 31 if month in LONG else 30


# --------------------------------------------------------------------------
# Register dates: (day, month, year), possibly impossible
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RegDate:
    d: int
    m: int
    y: int
    notional: Optional[int] = None  # the bracketed day, R4.4

    def __str__(self) -> str:
        day = f"{self.d}({self.notional})" if self.notional else str(self.d)
        return f"{day}-{self.m}-{self.y}"

    def is_impossible(self, policy: Policy = DEFAULT) -> bool:
        return self.d > month_len(self.m, self.y, policy) or self.d < 1

    def is_month_end(self, policy: Policy = DEFAULT) -> bool:
        return self.d == month_len(self.m, self.y, policy)


def _carry_months(dt: RegDate) -> RegDate:
    """R4.1. Normalise the month column only."""
    d, m, y = dt.d, dt.m, dt.y
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return RegDate(d, m, y)


def roll_forward(dt: RegDate, policy: Policy = DEFAULT) -> RegDate:
    """R4.2. Subtract the length of the month named in the date, advance the month."""
    dt = _carry_months(RegDate(dt.d, dt.m, dt.y))
    while dt.d > month_len(dt.m, dt.y, policy):
        dt = _carry_months(RegDate(dt.d - month_len(dt.m, dt.y, policy), dt.m + 1, dt.y))
    return dt


def clamp_back(dt: RegDate, policy: Policy = DEFAULT) -> RegDate:
    """R4.5. Terminal impossible date takes the last real day, notional in brackets."""
    limit = month_len(dt.m, dt.y, policy)
    if dt.d > limit:
        return RegDate(limit, dt.m, dt.y, notional=dt.d)
    return dt


def working(dt: RegDate) -> RegDate:
    """R4.9. A clamped date is worked from the bracketed day, not the real one."""
    if dt.notional and dt.notional > dt.d:
        return RegDate(dt.notional, dt.m, dt.y)
    return RegDate(dt.d, dt.m, dt.y)


def sub_days(dt: RegDate, n: int, policy: Policy = DEFAULT) -> RegDate:
    """R4.3. Borrow the length of the preceding month."""
    d, m, y = dt.d - n, dt.m, dt.y
    while d < 1:
        m -= 1
        if m < 1:
            m, y = 12, y - 1
        d += month_len(m, y, policy)
    return RegDate(d, m, y)


def borrow_days(dt: RegDate, n: int, policy: Policy = DEFAULT) -> List[Tuple[int, int, RegDate]]:
    """
    R4.3 step by step, as it is written by hand. Each borrow adds the length of
    the preceding month to the day column and steps the month back, until n days
    can be taken off. Returns (days borrowed, month borrowed, date after).
    """
    steps = []
    d, m, y = dt.d, dt.m, dt.y
    while d - n < 1:
        m -= 1
        if m < 1:
            m, y = 12, y - 1
        length = month_len(m, y, policy)
        d += length
        steps.append((length, m, RegDate(d, m, y)))
    return steps


def add_days(dt: RegDate, n: int, policy: Policy = DEFAULT) -> RegDate:
    """Normalise first if the date is impossible, then add (R4.6)."""
    base = roll_forward(dt, policy) if dt.is_impossible(policy) else RegDate(dt.d, dt.m, dt.y)
    return roll_forward(RegDate(base.d + n, base.m, base.y), policy)


# --------------------------------------------------------------------------
# Durations: register columns, 30-day months for remission (R2.2)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Duration:
    days: int = 0
    months: int = 0
    years: int = 0

    @staticmethod
    def of(days: int = 0, weeks: int = 0, months: int = 0, years: int = 0) -> "Duration":
        return Duration(days + 7 * weeks, months, years)  # R2.3

    @property
    def total_days(self) -> int:
        return self.years * 360 + self.months * 30 + self.days

    @staticmethod
    def from_days(n: int) -> "Duration":
        return Duration(n % 30, (n % 360) // 30, n // 360)

    def __add__(self, other: "Duration") -> "Duration":
        """Column by column. Months carry into years; days are never turned into months."""
        years, months = divmod(self.months + other.months, 12)
        return Duration(self.days + other.days, months, self.years + other.years + years)

    def __sub__(self, other: "Duration") -> "Duration":
        """Column by column, borrowing a month as 30 days and a year as 12 months."""
        if self.total_days <= other.total_days:
            return Duration()
        d, m, y = self.days - other.days, self.months - other.months, self.years - other.years
        while d < 0:
            d, m = d + 30, m - 1
        while m < 0:
            m, y = m + 12, y - 1
        return Duration(d, m % 12, y + m // 12)

    def __str__(self) -> str:
        bits = []
        if self.years:
            bits.append(f"{self.years}yr" + ("s" if self.years > 1 else ""))
        if self.months:
            bits.append(f"{self.months}mth" + ("s" if self.months > 1 else ""))
        if self.days:
            bits.append(f"{self.days}day" + ("s" if self.days > 1 else ""))
        return " ".join(bits) if bits else "nil"

    def columns(self) -> str:
        c = lambda v: str(v) if v else ""
        return f"{c(self.days):>4}   {c(self.months):>4}   {c(self.years):>5}"


def add_sentence(dt: RegDate, dur: Duration) -> RegDate:
    """R4.1. Column-wise, day column left impossible on purpose."""
    return _carry_months(RegDate(dt.d + dur.days, dt.m + dur.months, dt.y + dur.years))


def sub_duration(
    dt: RegDate, dur: Duration, policy: Policy = DEFAULT
) -> Tuple[RegDate, List[str]]:
    """Days first with borrowing, then whole months and years. R4.3, R4.7, R4.9."""
    flags: List[str] = []
    cur = working(dt)
    was_month_end = cur.is_month_end(policy)

    if dur.days:
        cur = sub_days(cur, dur.days, policy)
    cur = _carry_months(RegDate(cur.d, cur.m - dur.months, cur.y - dur.years))

    if was_month_end and (dur.months or dur.years):
        if dur.days:
            flags.append(
                "A4: deduction mixes days with whole months from a month-end date; "
                "month-end preservation not applied, booklet shows no example"
            )
        elif policy.month_end_preservation:
            limit = month_len(cur.m, cur.y, policy)
            if limit != cur.d:
                cur = RegDate(limit, cur.m, cur.y, notional=cur.d)  # R4.7
    return cur, flags


def borrow_steps(dt: RegDate, dur: Duration,
                 policy: Policy = DEFAULT) -> List[Tuple[str, str, RegDate]]:
    """
    The borrows behind sub_duration, for the register: months borrowed into the
    day column first, then a year borrowed into the month column as twelve
    months. Returns (figure borrowed, label, date after) for each.
    """
    out: List[Tuple[str, str, RegDate]] = []
    cur = working(dt)
    if dur.days:
        for length, m, after in borrow_days(cur, dur.days, policy):
            out.append((str(length), f"Borrow {MONTH_NAME[m]}", after))
            cur = after
    m, y = cur.m, cur.y
    while m - dur.months < 1:
        m, y = m + 12, y - 1
        out.append((Duration(months=12).columns(), "Borrow 1yr", RegDate(cur.d, m, y)))
    return out


def date_diff(later: RegDate, earlier: RegDate, policy: Policy = DEFAULT) -> Duration:
    """R4.8. Column-wise with borrowing, used for period served and licence period."""
    later = working(later)  # R4.9
    d, m, y = later.d, later.m, later.y
    dd = d - earlier.d
    if dd < 0:
        pm, py = (m - 1, y) if m > 1 else (12, y - 1)
        dd += month_len(pm, py, policy)
        m -= 1
    mm = m - earlier.m
    if mm < 0:
        mm += 12
        y -= 1
    return Duration(dd, mm, y - earlier.y)


# --------------------------------------------------------------------------
# Remission (R6)
# --------------------------------------------------------------------------

NO_REMISSION_CLASSES = {"debt", "debtor", "contempt", "condemned", "life", "lifer"}


def one_third(total_days: int) -> int:
    """R6.3 with R6.4 rounding, integers only: round up on a remainder of 2."""
    q, r = divmod(total_days, 3)
    return q + (1 if r == 2 else 0)


def one_third_columns(sentence: Duration) -> Duration:
    """
    R6.3 worked column by column, as the register does it (R6.7).

    Years are divided by three and the remainder carried down into months at
    twelve to the year; months are divided by three and the remainder carried
    down into days at 30 to the month (R2.2); the days are divided by three
    with R6.4 rounding. Nothing is ever carried back up: a day column of 30 or
    more stays in the day column. The total in days is the same as one third of
    the whole sentence at 30 days to the month, and so is the rounding, since
    360 and 30 are both multiples of three.

    This matters because the day column is subtracted as calendar days and the
    month column as calendar months (R2.1). Kwesi Mensah, 100 days, earns 33
    days. Subtracting 33 days from 13-2-2006 gives 11-1-2006 and an EPD of
    12-1-2006, which is what the booklet prints; 1mth 3days would give
    11-1-2006, one day out. A reviewer's case, 9mths 90days from 30-6-1995,
    earns 3mths 30days, subtracted as 30 days and then 3 months from 27-6-1996
    for an EPD of 29-2-1996; rolled up to 4mths it would give 28-2-1996.
    """
    years, r = divmod(sentence.years, 3)
    months, r = divmod(r * 12 + sentence.months, 3)
    days = one_third(r * 30 + sentence.days)
    return Duration(days, months, years)


ONE_SIXTH_CUSTODY = {"preventive", "protective", "productive_hard_labour"}


def one_sixth_columns(sentence: Duration) -> Tuple[Duration, bool]:
    """
    R6.5. Take one year off the sentence, then divide by six column by column,
    remainders carried down as in R6.7. Returns the remission and whether the
    division was exact. An inexact day column rounds up at two thirds and over
    (R6.4); the notes show no such example, so the caller flags it.
    """
    total = sentence.total_days
    if total <= 360:
        return Duration(), True
    if sentence.years >= 1:
        y, m, d = sentence.years - 1, sentence.months, sentence.days
    else:
        rest = Duration.from_days(total - 360)
        y, m, d = rest.years, rest.months, rest.days
    years, r = divmod(y, 6)
    months, r = divmod(r * 12 + m, 6)
    days, r = divmod(r * 30 + d, 6)
    return Duration(days + (1 if r >= 4 else 0), months, years), r == 0


def remission_for(sentence: Duration, offence_class: str = "felony",
                  custody: Optional[str] = None) -> Tuple[Duration, str]:
    if offence_class.lower() in NO_REMISSION_CLASSES:
        return Duration(), f"no remission: {offence_class} (R6.1)"
    if custody in ONE_SIXTH_CUSTODY:
        rem, _ = one_sixth_columns(sentence)
        if rem.total_days == 0:
            return Duration(), "no remission: one-sixth leaves nothing on this sentence (R6.5)"
        return rem, "one-sixth remission (R6.5)"
    total = sentence.total_days
    if total < 31:
        return Duration(), "no remission: sentence below 31 days (R6.1)"
    if total <= 41:
        return Duration(days=total - 30), "ordinary remission (R6.2)"
    return one_third_columns(sentence), "one-third remission (R6.3)"


def hospital_loss(period: Duration) -> Duration:
    """R7.2. One day lost per three days in hospital."""
    return Duration.from_days(one_third(period.total_days))


def punishment_loss(close_days: int, diet_days: int, same_date: bool) -> Duration:
    """R7.3."""
    base = max(close_days, diet_days) if same_date else close_days + diet_days
    return Duration.from_days(one_third(base))


# --------------------------------------------------------------------------
# Result and working
# --------------------------------------------------------------------------


@dataclass
class Line:
    date: Optional[RegDate] = None
    deduction: Optional[str] = None
    label: str = ""
    rule: bool = False  # draw a rule under this line
    op: Optional[str] = None  # "+" added to, "-" taken from, the date above


@dataclass
class Result:
    lpd: Optional[RegDate] = None
    epd: Optional[RegDate] = None
    dr: Optional[RegDate] = None
    licence_period: Optional[Duration] = None
    remission: Duration = field(default_factory=Duration)
    remission_note: str = ""
    lines: List[Line] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)

    def render(self) -> str:
        out = []
        for ln in self.lines:
            if ln.date is not None:
                left = f"{str(ln.date):>14}"
            else:
                left = f"{ln.deduction or '':>14}"
            out.append(f"{left}   {ln.label}")
            if ln.rule:
                out.append(" " * 14 + "   " + "-" * 34)
        if self.flags:
            out.append("")
            for f in self.flags:
                out.append(f"  ! {f}")
        return "\n".join(out)


# --------------------------------------------------------------------------
# The core computation
# --------------------------------------------------------------------------


def compute(
    d_s: RegDate,
    sentence: Duration,
    offence_class: str = "felony",
    remission_base: Optional[Duration] = None,
    forfeited_days: int = 0,
    hospital_period: Optional[Duration] = None,
    label_ds: str = "D/S",
    policy: Policy = DEFAULT,
    custody: Optional[str] = None,
    special_days: int = 0,
) -> Result:
    """
    The skeleton of RULES.md section 3.

    remission_base lets the caller compute remission on something other than the
    term being added to the date: a mixed sentence where only part earns
    remission (R6.6), or an escape where rule (h) puts remission on the original
    sentence while the term added is the residue (A1).
    """
    res = Result()
    add = res.lines.append

    add(Line(date=d_s, label=label_ds))
    add(Line(deduction=sentence.columns(), label="S", rule=True, op="+"))

    raw = add_sentence(d_s, sentence)
    add(Line(date=raw))

    cur = raw
    if sentence.days:
        # normalise before grace when the sentence carried days, one month per
        # line exactly as the register shows it (R4.2)
        while cur.d > month_len(cur.m, cur.y, policy):
            length = month_len(cur.m, cur.y, policy)
            add(Line(deduction=str(length), label=MONTH_NAME[cur.m], rule=True, op="-"))
            cur = _carry_months(RegDate(cur.d - length, cur.m + 1, cur.y))
            add(Line(date=cur))

    def show_borrows(steps) -> None:
        for figure, label, after in steps:
            add(Line(deduction=figure, label=label, rule=True, op="+"))
            add(Line(date=after))

    show_borrows(borrow_steps(cur, Duration(days=1), policy))
    add(Line(deduction="1", label="Grace", rule=True, op="-"))
    cur = sub_days(cur, 1, policy)  # R5.1
    # A7: the notes write the bracket rule (P2) only for a sentence passed on
    # the last day of a month
    unconfirmed = cur.is_impossible(policy) and not d_s.is_month_end(policy)

    base = remission_base if remission_base is not None else sentence
    rem, note = remission_for(base, offence_class, custody)
    res.remission, res.remission_note = rem, note

    if rem.total_days == 0:
        cur = clamp_back(cur, policy)  # R4.5
        res.dr = cur
        add(Line(date=cur, label="D/R"))
        res.flags.append(note)
        if unconfirmed:
            res.flags.append(A7)
        if special_days:
            res.flags.append("R7.6: special remission not applied, there is no EPD to take it from")
        return res

    if cur.is_impossible(policy):
        cur = clamp_back(cur, policy)  # R4.5: never detain past the LPD
        res.flags.append("A3: LPD landed on an impossible date, clamped back (p.16)")
        if unconfirmed:
            res.flags.append(A7)
    res.lpd = cur
    add(Line(date=cur, label="LPD"))
    if "sixth" in note:
        rem_label = f"1/6 Rem on {base} less 1yr"
        if not one_sixth_columns(base)[1]:
            res.flags.append("A8: one-sixth did not divide exactly; two thirds and over "
                             "rounded up (R6.4), the notes show no such example")
    else:
        rem_label = f"1/3 Rem on {base}" if "third" in note else f"Rem on {base}"
    show_borrows(borrow_steps(cur, rem, policy))
    add(Line(deduction=rem.columns(), label=rem_label, rule=True, op="-"))

    cur, fl = sub_duration(cur, rem, policy)
    res.flags.extend(fl)
    add(Line(date=cur))

    if cur.is_impossible(policy):
        length = month_len(cur.m, cur.y, policy)
        add(Line(deduction=str(length), label=MONTH_NAME[cur.m], rule=True, op="-"))
        cur = roll_forward(cur, policy)  # R4.6
        add(Line(date=cur))

    add(Line(deduction="1", label="Add", rule=True, op="+"))
    cur = add_days(cur, 1, policy)
    res.epd = cur
    add(Line(date=cur, label="EPD"))

    # adjustments after the EPD (R7)
    extra = Duration()
    if hospital_period is not None:
        loss = hospital_loss(hospital_period)
        extra = extra + loss
        add(Line(deduction=loss.columns(), label="H/R/L", rule=True, op="+"))
    if forfeited_days:
        extra = extra + Duration(days=forfeited_days)
        add(Line(deduction=str(forfeited_days), label="Forfeit", rule=True, op="+"))

    if extra.total_days:
        cur = add_days(cur, extra.days, policy)
        cur = _carry_months(RegDate(cur.d, cur.m + extra.months, cur.y + extra.years))
        if cur.is_impossible(policy):
            cur = roll_forward(cur, policy)
        res.epd = cur
        add(Line(date=cur, label="EPD (adjusted)"))
        if res.lpd and _ordinal(cur, policy) > _ordinal(res.lpd, policy):
            res.epd = res.lpd
            res.flags.append(
                "R7.4: forfeiture pushed the EPD past the LPD; capped at the LPD"
            )

    if special_days:
        # R7.6: special and restored remission come off after the add-one line
        show_borrows(borrow_steps(res.epd, Duration(days=special_days), policy))
        add(Line(deduction=str(special_days), label="Spec Rem", rule=True, op="-"))
        cur = sub_days(RegDate(res.epd.d, res.epd.m, res.epd.y), special_days, policy)
        res.epd = cur
        add(Line(date=cur, label="EPD (amended)"))

    if res.lpd and res.epd:
        res.licence_period = date_diff(res.lpd, res.epd, policy)  # R8.8
    return res


A7 = ("A7: the date of sentence is not a month-end but the sentence lands on an "
      "abnormal date; bracketed as for a month-end sentence, confirm by hand")


def days_inclusive(first: RegDate, last: RegDate, policy: Policy = DEFAULT) -> int:
    """Calendar days from first to last, both ends counted."""
    if (first.y, first.m) == (last.y, last.m):
        return last.d - first.d + 1
    n = month_len(first.m, first.y, policy) - first.d + 1
    cur = _carry_months(RegDate(1, first.m + 1, first.y))
    while (cur.y, cur.m) != (last.y, last.m):
        n += month_len(cur.m, cur.y, policy)
        cur = _carry_months(RegDate(1, cur.m + 1, cur.y))
    return n + last.d


def subsistence(d_s: RegDate, d_r: RegDate, rate_pesewas: int,
                policy: Policy = DEFAULT) -> Tuple[int, str]:
    """R8.9. Debtor's subsistence: days from D/S to D/R, both counted, at the daily rate."""
    days = days_inclusive(d_s, d_r, policy)
    total = days * rate_pesewas
    return days, f"GH¢{total // 100}.{total % 100:02d}"


def _ordinal(dt: RegDate, policy: Policy = DEFAULT) -> int:
    """Rough day index, for comparisons only."""
    return dt.y * 372 + dt.m * 31 + dt.d


# --------------------------------------------------------------------------
# Scenarios (R8)
# --------------------------------------------------------------------------


def simple(d_s: RegDate, sentence: Duration, offence_class: str = "felony",
           policy: Policy = DEFAULT) -> Result:
    return compute(d_s, sentence, offence_class, policy=policy)


def additional(d_s_first: RegDate, first: Duration, first_class: str,
               second: Duration, second_class: str,
               policy: Policy = DEFAULT) -> Result:
    """R8.1: add the sentences, work from the FIRST date of conviction."""
    total = first + second
    earning = Duration()
    for dur, cls in ((first, first_class), (second, second_class)):
        if cls.lower() not in NO_REMISSION_CLASSES:
            earning = earning + dur  # R6.6
    res = compute(d_s_first, total, "felony", remission_base=earning, policy=policy)
    res.flags.append(f"R8.1: total sentence {total}, remission base {earning}")
    return res


def resolve_counts(groups: List[List[Duration]]) -> Duration:
    """R8.2 and R8.3: highest within each concurrent group, then add the groups."""
    total = Duration()
    for g in groups:
        best = max(g, key=lambda d: d.total_days)
        total = total + best
    return total


def reduction(d_s: RegDate, sentence: Duration, cut: Duration,
              offence_class: str = "felony", policy: Policy = DEFAULT) -> Result:
    """R8.4: deduct, then work from the ORIGINAL date of sentence."""
    balance = sentence - cut
    res = compute(d_s, balance, offence_class, policy=policy)
    res.flags.append(f"R8.4: {sentence} less {cut} = {balance}, worked from original D/S")
    return res


def single_escape(d_s: RegDate, sentence: Duration, d_escape: RegDate,
                  d_recapture: RegDate, offence_class: str = "felony",
                  policy: Policy = DEFAULT) -> Result:
    """R8.5, and the A1 switch on the remission base."""
    served = date_diff(d_escape, d_s, policy)
    residue = sentence - served
    base = sentence if policy.escape_remission_base == "original" else residue
    res = compute(d_recapture, residue, offence_class, remission_base=base,
                  label_ds="D/R (recapture)", policy=policy)
    res.flags.insert(0, f"R8.5: served {served}, residue {residue}")
    res.flags.insert(1, f"A1: remission taken on the {policy.escape_remission_base} "
                        f"({base}); the other reading gives a different EPD")
    return res


def double_escape(d_s: RegDate, sentence: Duration, d_escape1: RegDate,
                  d_recapture1: RegDate, d_escape2: RegDate, d_recapture2: RegDate,
                  extra_sentence: Duration = Duration(),
                  cut: Duration = Duration(), offence_class: str = "felony",
                  policy: Policy = DEFAULT) -> Result:
    """R8.6."""
    served1 = date_diff(d_escape1, d_s, policy)
    served2 = date_diff(d_escape2, d_recapture1, policy)
    # periods served are not sentences: their days carry at 30 to the month
    served = Duration.from_days(served1.total_days + served2.total_days)
    total = sentence + extra_sentence - cut
    residue = total - served
    res = compute(d_recapture2, residue, offence_class, remission_base=total,
                  label_ds="2nd D/R", policy=policy)
    res.flags.insert(0, f"R8.6: served {served1} + {served2} = {served}; "
                        f"total sentence {total}; residue {residue}")
    return res


def bailed_out(d_s: RegDate, sentence: Duration, d_bail: RegDate,
               d_readmission: RegDate, offence_class: str = "felony",
               policy: Policy = DEFAULT) -> Result:
    """R8.7."""
    served = date_diff(d_bail, d_s, policy)
    residue = sentence - served
    res = compute(d_readmission, residue, offence_class, remission_base=sentence,
                  label_ds="D/R (re-admission)", policy=policy)
    res.flags.insert(0, f"R8.7: served {served}, residue {residue}")
    return res


# --------------------------------------------------------------------------
# Release-day layer (R9.1). Deliberately separate from the computation.
# --------------------------------------------------------------------------

import datetime as _dt

# Fixed-date Ghana public holidays. Keyed by the year from which each applies,
# because this list has changed (Constitution Day added 2019, Founders' Day
# moved 2019). VERIFY against the Public Holidays Act and any Executive
# Instrument before relying on it.
FIXED_HOLIDAYS = {
    (1, 1): (1957, "New Year's Day"),
    (1, 7): (2019, "Constitution Day"),
    (3, 6): (1957, "Independence Day"),
    (5, 1): (1957, "May Day"),
    (8, 4): (2019, "Founders' Day"),
    (9, 21): (2019, "Kwame Nkrumah Memorial Day"),
    (12, 25): (1957, "Christmas Day"),
    (12, 26): (1957, "Boxing Day"),
}

# Eid al-Fitr and Eid al-Adha are announced, not calculated. Populate per year.
ANNOUNCED_HOLIDAYS: dict = {}
CALENDAR_CONFIRMED_THROUGH = 2026


def _easter(year: int) -> _dt.date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return _dt.date(year, month, day)


def holidays(year: int) -> dict:
    out = {}
    for (m, d), (since, name) in FIXED_HOLIDAYS.items():
        if year >= since:
            out[_dt.date(year, m, d)] = name
    easter = _easter(year)
    out[easter - _dt.timedelta(days=2)] = "Good Friday"
    out[easter + _dt.timedelta(days=1)] = "Easter Monday"
    # Farmers' Day: first Friday in December
    dec = _dt.date(year, 12, 1)
    out[dec + _dt.timedelta(days=(4 - dec.weekday()) % 7)] = "Farmers' Day"
    out.update(ANNOUNCED_HOLIDAYS.get(year, {}))
    # Public Holidays Act: a holiday falling at the weekend is observed Monday
    for day, name in list(out.items()):
        if day.weekday() >= 5:
            shift = 7 - day.weekday()
            out[day + _dt.timedelta(days=shift)] = f"{name} (observed)"
    return out


def discharge_date(target: RegDate) -> dict:
    """
    R9.1. A release date falling on a Sunday, Christmas or a public holiday
    moves to the day BEFORE, for the EPD, the D/R and the LPD alike. Saturday is
    a release day.
    """
    try:
        day = _dt.date(target.y if target.y > 1000 else 1900 + target.y, target.m, target.d)
    except ValueError:
        return {"error": f"{target} is not a real date"}
    hol = {}
    moved = day
    guard = 0
    while guard < 30:
        hol = holidays(moved.year)
        if moved.weekday() != 6 and moved not in hol:
            break
        moved -= _dt.timedelta(days=1)
        guard += 1
    return {
        "computed": day.isoformat(),
        "discharge": moved.isoformat(),
        "weekday": moved.strftime("%A"),
        "direction": "backward (R9.1)",
        "moved_days": abs((moved - day).days),
        "reason": holidays(day.year).get(day) or ("Sunday" if day.weekday() == 6 else None),
        "provisional": day.year > CALENDAR_CONFIRMED_THROUGH,
        "note": (
            f"holiday calendar unconfirmed beyond {CALENDAR_CONFIRMED_THROUGH}; "
            "Eid dates are announced, not calculated"
            if day.year > CALENDAR_CONFIRMED_THROUGH else ""
        ),
    }


# --------------------------------------------------------------------------
# Licence eligibility (R8.8)
# --------------------------------------------------------------------------

LICENCE_CLASSES = {"stealing", "fraud", "arson", "burglary", "robbery", "felony"}
LICENCE_EXCLUDED = {"murder", "attempted murder", "conspiracy to murder"}


def licence_eligible(sex: str, sentence: Duration, offence: str) -> Tuple[bool, str]:
    o = offence.lower()
    if sex.lower() not in ("m", "male"):
        return False, ("p.18(b): licence is not issued to female prisoners, on the "
                       "Ordinance's definition of 'convict' as male. Note this sits "
                       "awkwardly against Article 17 of the 1992 Constitution.")
    if o in LICENCE_EXCLUDED:
        return False, "p.18: excluded offence"
    if sentence.total_days < 720:
        return False, "p.18: sentence under two years"
    if o not in LICENCE_CLASSES:
        return False, f"p.18: '{offence}' is not in the dishonest-means felony class"
    return True, "eligible; Prison Form No. 10 to local police at least one week before release"


if __name__ == "__main__":
    r = simple(RegDate(17, 10, 2006), Duration.of(weeks=5, days=2), "stealing")
    print(r.render())
