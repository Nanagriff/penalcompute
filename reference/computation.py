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
* All remission arithmetic is in whole days at 30 days to the month (R2.2).
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


def sub_days(dt: RegDate, n: int, policy: Policy = DEFAULT) -> RegDate:
    """R4.3. Borrow the length of the preceding month."""
    d, m, y = dt.d - n, dt.m, dt.y
    while d < 1:
        m -= 1
        if m < 1:
            m, y = 12, y - 1
        d += month_len(m, y, policy)
    return RegDate(d, m, y)


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
        return Duration.from_days(self.total_days + other.total_days)

    def __sub__(self, other: "Duration") -> "Duration":
        return Duration.from_days(max(0, self.total_days - other.total_days))

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
    """Days first with borrowing, then whole months and years. R4.3, R4.7."""
    flags: List[str] = []
    was_month_end = dt.is_month_end(policy)
    cur = RegDate(dt.d, dt.m, dt.y)

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


def date_diff(later: RegDate, earlier: RegDate, policy: Policy = DEFAULT) -> Duration:
    """R4.8. Column-wise with borrowing, used for period served and licence period."""
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


def _as_sentence_units(n: int, sentence: Duration) -> Duration:
    """
    R6.7. Remission is expressed in the same units as the sentence. A sentence
    stated in days only takes its remission in days and is subtracted from the
    date as days; any sentence carrying months or years takes its remission in
    months and days at 30 days to the month.

    This matters. Kwesi Mensah, 100 days, earns 33 days. Subtracting 33 days
    from 13-2-2006 gives 11-1-2006 and an EPD of 12-1-2006, which is what the
    booklet prints. Subtracting the same 33 days rewritten as 1mth 3days gives
    10-1-2006 and an EPD of 11-1-2006, one day out. The two are not
    interchangeable because a calendar month is not 30 days (R2.1 against R2.2).
    """
    if sentence.months == 0 and sentence.years == 0:
        return Duration(days=n)
    return Duration.from_days(n)


def remission_for(sentence: Duration, offence_class: str = "felony") -> Tuple[Duration, str]:
    if offence_class.lower() in NO_REMISSION_CLASSES:
        return Duration(), f"no remission: {offence_class} (R6.1)"
    total = sentence.total_days
    if total < 31:
        return Duration(), "no remission: sentence below 31 days (R6.1)"
    if total <= 41:
        return _as_sentence_units(total - 30, sentence), "ordinary remission (R6.2)"
    return _as_sentence_units(one_third(total), sentence), "one-third remission (R6.3)"


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
    add(Line(deduction=sentence.columns(), label="S", rule=True))

    raw = add_sentence(d_s, sentence)
    add(Line(date=raw))

    cur = raw
    if sentence.days:
        # normalise before grace when the sentence carried days, one month per
        # line exactly as the register shows it (R4.2)
        while cur.d > month_len(cur.m, cur.y, policy):
            length = month_len(cur.m, cur.y, policy)
            add(Line(deduction=str(length), label=MONTH_NAME[cur.m], rule=True))
            cur = _carry_months(RegDate(cur.d - length, cur.m + 1, cur.y))
            add(Line(date=cur))

    add(Line(deduction="1", label="Grace", rule=True))
    cur = sub_days(cur, 1, policy)  # R5.1

    base = remission_base if remission_base is not None else sentence
    rem, note = remission_for(base, offence_class)
    res.remission, res.remission_note = rem, note

    if rem.total_days == 0:
        cur = clamp_back(cur, policy)  # R4.5
        res.dr = cur
        add(Line(date=cur, label="D/R"))
        res.flags.append(note)
        return res

    if cur.is_impossible(policy):
        cur = clamp_back(cur, policy)  # R4.5: never detain past the LPD
        res.flags.append("A3: LPD landed on an impossible date, clamped back (p.16)")
    res.lpd = cur
    add(Line(date=cur, label="LPD"))
    add(Line(deduction=rem.columns(), label=f"1/3 Rem on {base}" if "third" in note
             else f"Rem on {base}", rule=True))

    cur, fl = sub_duration(cur, rem, policy)
    res.flags.extend(fl)
    add(Line(date=cur))

    if cur.is_impossible(policy):
        length = month_len(cur.m, cur.y, policy)
        add(Line(deduction=str(length), label=MONTH_NAME[cur.m], rule=True))
        cur = roll_forward(cur, policy)  # R4.6
        add(Line(date=cur))

    add(Line(deduction="1", label="Add", rule=True))
    cur = add_days(cur, 1, policy)
    res.epd = cur
    add(Line(date=cur, label="EPD"))

    # adjustments after the EPD (R7)
    extra = Duration()
    if hospital_period is not None:
        loss = hospital_loss(hospital_period)
        extra = extra + loss
        add(Line(deduction=loss.columns(), label="H/R/L", rule=True))
    if forfeited_days:
        extra = extra + Duration(days=forfeited_days)
        add(Line(deduction=str(forfeited_days), label="Forfeit", rule=True))

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

    if res.lpd and res.epd:
        res.licence_period = date_diff(res.lpd, res.epd, policy)  # R8.8
    return res


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
    served = served1 + served2
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
# Working-day layer (A6). Deliberately separate from the computation.
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


def discharge_date(target: RegDate, is_lpd: bool = False) -> dict:
    """
    A6. Move the discharge to a working day. Forward at the EPD, because any
    date before the LPD is lawful. BACKWARD at the LPD, because R7.4 forbids
    detention past midnight on the LPD.
    """
    try:
        day = _dt.date(target.y if target.y > 1000 else 1900 + target.y, target.m, target.d)
    except ValueError:
        return {"error": f"{target} is not a real date"}
    step = -1 if is_lpd else 1
    hol = {}
    moved = day
    guard = 0
    while guard < 30:
        hol = holidays(moved.year)
        if moved.weekday() < 5 and moved not in hol:
            break
        moved += _dt.timedelta(days=step)
        guard += 1
    return {
        "computed": day.isoformat(),
        "discharge": moved.isoformat(),
        "weekday": moved.strftime("%A"),
        "direction": "backward (LPD, R7.4)" if is_lpd else "forward (EPD)",
        "moved_days": abs((moved - day).days),
        "reason": hol.get(day) or ("weekend" if day.weekday() >= 5 else None),
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
