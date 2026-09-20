#!/usr/bin/env python3
"""
Test suite. Every worked example on the booklet pages supplied, in booklet order.

Each case records what the booklet prints. Where the booklet is wrong, the
expected value is the correct answer and the case carries a `booklet_says`
field, so a pass means the engine reproduces the method and disagrees with the
misprint.
"""

from computation import (
    Duration, Policy, RegDate, additional, date_diff, double_escape,
    hospital_loss, licence_eligible, one_third, resolve_counts, simple,
    single_escape, compute,
)

PASS, FAIL = [], []


def check(name, got, want, booklet_says=None):
    got, want = str(got), str(want)
    if got == want:
        note = f"   (booklet prints {booklet_says}, which is a misprint)" if booklet_says else ""
        PASS.append(f"ok   {name}: {got}{note}")
    else:
        FAIL.append(f"FAIL {name}: got {got}, expected {want}")


# ---- p.4 simple, no remission -------------------------------------------
r = simple(RegDate(4, 7, 76), Duration.of(days=25), "stealing")
check("p.4a 25 days, D/R", r.dr, "28-7-76")

r = simple(RegDate(1, 1, 2007), Duration.of(months=1), "stealing")
check("p.4b 1 month = 30 days, below 31, D/R", r.dr, "31-1-2007")

# ---- p.5 ordinary remission ---------------------------------------------
r = simple(RegDate(17, 10, 2006), Duration.of(weeks=5, days=2), "stealing")
check("p.5a 37 days LPD", r.lpd, "22-11-2006")
check("p.5a 37 days EPD", r.epd, "16-11-2006")
check("p.5a remission", r.remission, "7days")

r = simple(RegDate(1, 1, 2006), Duration.of(days=40), "stealing")
check("p.5b 40 days LPD", r.lpd, "9-2-2006")
check("p.5b 40 days EPD", r.epd, "31-1-2006")
check("p.5b remission", r.remission, "10days")

# ---- p.5 one-third remission --------------------------------------------
r = simple(RegDate(6, 11, 2005), Duration.of(days=100), "stealing")
check("p.5 Kwesi Mensah LPD", r.lpd, "13-2-2006")
check("p.5 Kwesi Mensah EPD", r.epd, "12-1-2006")
check("p.5 Kwesi Mensah remission stays in days (R6.7)", r.remission, "33days")

r = simple(RegDate(17, 11, 2004), Duration.of(years=6), "stealing")
check("p.5 6yrs LPD", r.lpd, "16-11-2010")
check("p.5 6yrs EPD", r.epd, "17-11-2008")

# ---- p.7 impossible dates and the debtor --------------------------------
r = simple(RegDate(31, 8, 72), Duration.of(months=6), "debt")
check("p.7 debtor 6mths D/R", r.dr, "28(30)-2-73")

r = simple(RegDate(31, 1, 76), Duration.of(months=1), "stealing")
check("p.7 1 month over Feb 76 D/R", r.dr, "29(30)-2-76")

r = simple(RegDate(1, 12, 71), Duration.of(months=3), "stealing")
check("p.7 3mths IHL LPD", r.lpd, "29-2-72")
check("p.7 3mths IHL EPD (month-end preserved, R4.7)", r.epd, "1-2-72")

# ---- p.8 additional sentence --------------------------------------------
r = additional(RegDate(25, 7, 2005), Duration.of(months=6), "debt",
               Duration.of(months=9, days=14), "assault")
check("p.8 Paul Mensah LPD", r.lpd, "7-11-2006")
check("p.8 Paul Mensah EPD", r.epd, "3-8-2006")
check("p.8 Paul Mensah remission on 9mths 14days only", r.remission, "3mths 5days")

r = additional(RegDate(24, 10, 2003), Duration.of(months=15), "stealing",
               Duration.of(years=3, months=7, days=26), "assault")
check("p.8 ex2 LPD", r.lpd, "18-9-2008")
check("p.8 ex2 EPD", r.epd, "31-1-2007")
check("p.8 ex2 remission", r.remission, "1yr 7mths 19days")

# ---- p.9 concurrent and consecutive -------------------------------------
total = resolve_counts([[Duration.of(years=1, months=10), Duration.of(years=1, months=6)]])
check("p.9 ex1 concurrent total", total, "1yr 10mths")
r = compute(RegDate(26, 11, 66), total, "stealing")
check("p.9 ex1 LPD", r.lpd, "25-9-68")
check("p.9 ex1 EPD", r.epd, "16-2-68", booklet_says="16-3-68")

total = resolve_counts([
    [Duration.of(months=10), Duration.of(months=18), Duration.of(months=6)],
    [Duration.of(months=9), Duration.of(years=2), Duration.of(years=1, months=5, days=11)],
])
check("p.9 ex2 grouped total", total, "3yrs 6mths")
r = compute(RegDate(28, 3, 2007), total, "stealing")
check("p.9 ex2 LPD", r.lpd, "27-9-2010")
check("p.9 ex2 EPD", r.epd, "28-7-2009")
check("p.9 ex2 remission", r.remission, "1yr 2mths",
      booklet_says="the right figure under a label reading '1yr 10mths'")

# ---- p.10 reduction on appeal (Yaw Atta) --------------------------------
balance = Duration.of(years=10, months=4) - Duration.of(years=3)
check("p.10 balance to serve", balance, "7yrs 4mths")
r = compute(RegDate(31, 3, 1998), balance, "felony")
check("p.10 LPD", r.lpd, "30-7-2005")
check("p.10 EPD", r.epd, "21-2-2003")
check("p.10 remission", r.remission, "2yrs 5mths 10days")

# ---- p.11 presidential pardon -------------------------------------------
balance = Duration.of(years=14, months=3, days=1) - Duration.of(years=2)
check("p.11 balance to serve", balance, "12yrs 3mths 1day")
r = compute(RegDate(30, 12, 1998), balance, "fraud")
check("p.11 LPD", r.lpd, "30-3-2011")
check("p.11 EPD", r.epd, "3-3-2007")
check("p.11 remission", r.remission, "4yrs 1mth",
      booklet_says="the right figure under a label reading '13yrs 3mths 1day'")

# ---- p.12 single escape: the A1 contradiction ---------------------------
served = date_diff(RegDate(10, 3, 2007), RegDate(15, 12, 2006))
check("p.12 period served", served, "2mths 23days")
check("p.12 residue", Duration.of(years=2) - served, "1yr 9mths 7days")

r = single_escape(RegDate(15, 12, 2006), Duration.of(years=2), RegDate(10, 3, 2007),
                  RegDate(25, 8, 2007), "stealing",
                  policy=Policy(escape_remission_base="residue"))
check("p.12 LPD", r.lpd, "31-5-2009")
check("p.12 EPD, booklet's residue basis", r.epd, "30-10-2008")

r = single_escape(RegDate(15, 12, 2006), Duration.of(years=2), RegDate(10, 3, 2007),
                  RegDate(25, 8, 2007), "stealing",
                  policy=Policy(escape_remission_base="original"))
check("p.12 EPD under rule (h), remission on the original 2yrs", r.epd, "1-10-2008")
check("p.12 rule (h) remission", r.remission, "8mths")

# ---- p.14/15 double escape ----------------------------------------------
r = double_escape(RegDate(17, 8, 80), Duration.of(years=3), RegDate(27, 10, 80),
                  RegDate(10, 2, 81), RegDate(25, 4, 81), RegDate(22, 11, 81),
                  offence_class="fraud")
check("p.15 Q1 LPD", r.lpd, "26-6-84")
check("p.15 Q1 EPD", r.epd, "27-6-83")

# Q2: the question's dates are impossible (escape 22/12/72, recapture 20/12/72).
# The working uses 13-12-72 as the 2nd date of recapture, so that is used here.
r = double_escape(RegDate(19, 5, 71), Duration.of(years=3), RegDate(2, 8, 72),
                  RegDate(28, 10, 72), RegDate(22, 12, 72), RegDate(13, 12, 72),
                  extra_sentence=Duration.of(months=6), cut=Duration.of(months=12),
                  offence_class="stealing")
check("p.16 Q2 LPD", r.lpd, "3-2-74")
check("p.16 Q2 EPD", r.epd, "4-4-73")
check("p.16 Q2 remission on 2yrs 6mths residue", r.remission, "10mths")

# ---- p.18 hospital ------------------------------------------------------
period = date_diff(RegDate(26, 12, 2004), RegDate(20, 9, 2004))
check("p.18 period in hospital", period, "3mths 6days")
check("p.18 remission lost", hospital_loss(period), "1mth 2days")
r = compute(RegDate(25, 8, 2004), Duration.of(years=6), "stealing",
            hospital_period=period)
check("p.18 LPD", r.lpd, "24-8-2010")
check("p.18 EPD after hospital loss", r.epd, "27-9-2008")

# ---- rounding rule (R6.4) ----------------------------------------------
check("R6.4 284/3 rounds up on remainder 2", one_third(284), 95)
check("R6.4 100/3 discards remainder 1", one_third(100), 33)
check("R6.4 1766/3 rounds up", one_third(1766), 589)
check("R6.4 4411/3 discards", one_third(4411), 1470)

# ---- licence (R8.8) -----------------------------------------------------
ok, why = licence_eligible("male", Duration.of(years=3), "stealing")
check("R8.8 male, 3yrs, stealing", ok, True)
ok, why = licence_eligible("female", Duration.of(years=3), "stealing")
check("R8.8 female excluded by the Ordinance", ok, False)
ok, why = licence_eligible("male", Duration.of(years=1), "stealing")
check("R8.8 under two years", ok, False)

# ---- report -------------------------------------------------------------
print("\n".join(PASS))
if FAIL:
    print()
    print("\n".join(FAIL))
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
