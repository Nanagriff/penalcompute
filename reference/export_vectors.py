#!/usr/bin/env python3
"""
Export the booklet test cases as JSON vectors, and verify them.

    python3 export_vectors.py            writes ../vectors/booklet.json
    python3 export_vectors.py --verify   re-runs the engine against the
                                         committed file, exit 1 on mismatch

Every `expect` block is produced by running the reference engine, never by
copying a value out of test_booklet.py, so the vectors and the reference
cannot drift apart. The `--verify` mode is the guard against someone editing
the JSON to make a failing TypeScript test pass.

Wire format
-----------
dates      [d, m, y]                     register triples, may be impossible
durations  {"days", "months", "years"}   weeks already folded in at 7 days (R2.3)
policy     the three switches from RULES.md section 9, snake_case as in Python
expect     for computations: lpd, epd, dr, remission, remission_note,
           licence_period, flags, render. Other scenarios carry their own keys.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from computation import (
    Duration, Policy, RegDate, additional, bailed_out, compute, date_diff,
    double_escape, hospital_loss, licence_eligible, one_third, punishment_loss,
    reduction, resolve_counts, simple, single_escape,
)

OUT = Path(__file__).resolve().parent.parent / "vectors" / "booklet.json"


# --------------------------------------------------------------------------
# wire <-> engine
# --------------------------------------------------------------------------

def D(v: List[int]) -> RegDate:
    return RegDate(v[0], v[1], v[2])


def Dur(v: Dict[str, int]) -> Duration:
    return Duration(v.get("days", 0), v.get("months", 0), v.get("years", 0))


def dur_json(d: Duration) -> Dict[str, int]:
    return {"days": d.days, "months": d.months, "years": d.years}


def policy_from(p: Dict[str, Any]) -> Policy:
    return Policy(
        leap_rule=p.get("leap_rule", "gregorian"),
        month_end_preservation=p.get("month_end_preservation", True),
        escape_remission_base=p.get("escape_remission_base", "original"),
    )


def policy_json(p: Policy) -> Dict[str, Any]:
    return {
        "leap_rule": p.leap_rule,
        "month_end_preservation": p.month_end_preservation,
        "escape_remission_base": p.escape_remission_base,
    }


def opt(x) -> Any:
    return None if x is None else str(x)


def result_expect(r) -> Dict[str, Any]:
    return {
        "lpd": opt(r.lpd),
        "epd": opt(r.epd),
        "dr": opt(r.dr),
        "remission": str(r.remission),
        "remission_note": r.remission_note,
        "licence_period": opt(r.licence_period),
        "flags": list(r.flags),
        "render": r.render(),
    }


# --------------------------------------------------------------------------
# the dispatcher: one scenario name -> one engine call
# --------------------------------------------------------------------------

def run_case(case: Dict[str, Any]) -> Dict[str, Any]:
    s = case["scenario"]
    i = case["inputs"]
    p = policy_from(case.get("policy", {}))

    if s == "simple":
        r = simple(D(i["date_of_sentence"]), Dur(i["sentence"]), i["offence_class"], policy=p)
        return result_expect(r)

    if s == "additional":
        r = additional(D(i["date_of_sentence"]), Dur(i["first"]), i["first_class"],
                       Dur(i["second"]), i["second_class"], policy=p)
        return result_expect(r)

    if s == "counts":
        total = resolve_counts([[Dur(x) for x in g] for g in i["groups"]])
        r = compute(D(i["date_of_sentence"]), total, i["offence_class"], policy=p)
        e = result_expect(r)
        e["total"] = str(total)
        return e

    if s == "reduction":
        r = reduction(D(i["date_of_sentence"]), Dur(i["sentence"]), Dur(i["cut"]),
                      i["offence_class"], policy=p)
        e = result_expect(r)
        e["balance"] = str(Dur(i["sentence"]) - Dur(i["cut"]))
        return e

    if s == "single_escape":
        r = single_escape(D(i["date_of_sentence"]), Dur(i["sentence"]),
                          D(i["date_of_escape"]), D(i["date_of_recapture"]),
                          i["offence_class"], policy=p)
        return result_expect(r)

    if s == "double_escape":
        r = double_escape(D(i["date_of_sentence"]), Dur(i["sentence"]),
                          D(i["date_of_escape_1"]), D(i["date_of_recapture_1"]),
                          D(i["date_of_escape_2"]), D(i["date_of_recapture_2"]),
                          extra_sentence=Dur(i.get("extra_sentence", {})),
                          cut=Dur(i.get("cut", {})),
                          offence_class=i["offence_class"], policy=p)
        return result_expect(r)

    if s == "bailed_out":
        r = bailed_out(D(i["date_of_sentence"]), Dur(i["sentence"]),
                       D(i["date_of_bail"]), D(i["date_of_readmission"]),
                       i["offence_class"], policy=p)
        return result_expect(r)

    if s == "hospital":
        period = date_diff(D(i["hospital_to"]), D(i["hospital_from"]), p)
        r = compute(D(i["date_of_sentence"]), Dur(i["sentence"]), i["offence_class"],
                    hospital_period=period, policy=p)
        e = result_expect(r)
        e["hospital_period"] = str(period)
        e["hospital_loss"] = str(hospital_loss(period))
        return e

    if s == "forfeiture":
        r = compute(D(i["date_of_sentence"]), Dur(i["sentence"]), i["offence_class"],
                    forfeited_days=i["forfeited_days"], policy=p)
        return result_expect(r)

    if s == "date_diff":
        return {"diff": str(date_diff(D(i["later"]), D(i["earlier"]), p))}

    if s == "duration_sub":
        return {"result": str(Dur(i["a"]) - Dur(i["b"]))}

    if s == "one_third":
        return {"value": one_third(i["n"])}

    if s == "punishment_loss":
        return {"loss": str(punishment_loss(i["close_days"], i["diet_days"], i["same_date"]))}

    if s == "licence":
        ok, why = licence_eligible(i["sex"], Dur(i["sentence"]), i["offence"])
        return {"eligible": ok, "reason": why}

    raise ValueError(f"unknown scenario {s!r} in case {case.get('id')!r}")


# --------------------------------------------------------------------------
# the cases, in booklet order, mirroring test_booklet.py
# --------------------------------------------------------------------------

def case(id: str, page, scenario: str, inputs: Dict[str, Any], *,
         policy: Policy = Policy(), booklet_says=None, note: str = "",
         source: str = "booklet") -> Dict[str, Any]:
    c = {
        "id": id,
        "page": page,
        "source": source,
        "scenario": scenario,
        "inputs": inputs,
        "policy": policy_json(policy),
        "expect": None,
        "booklet_says": booklet_says,
        "note": note,
    }
    c["expect"] = run_case(c)
    return c


def dur(days=0, weeks=0, months=0, years=0) -> Dict[str, int]:
    return dur_json(Duration.of(days=days, weeks=weeks, months=months, years=years))


def build_cases() -> List[Dict[str, Any]]:
    C: List[Dict[str, Any]] = []

    # ---- p.4 simple, no remission ----------------------------------------
    C.append(case("p04a-25-days", 4, "simple",
                  {"date_of_sentence": [4, 7, 76], "sentence": dur(days=25),
                   "offence_class": "stealing"},
                  note="below 31 days, no remission, D/R (R6.1)"))
    C.append(case("p04b-1-month", 4, "simple",
                  {"date_of_sentence": [1, 1, 2007], "sentence": dur(months=1),
                   "offence_class": "stealing"},
                  note="1 month = 30 days under R2.2, below 31, D/R"))

    # ---- p.5 ordinary remission ------------------------------------------
    C.append(case("p05a-5-weeks-2-days", 5, "simple",
                  {"date_of_sentence": [17, 10, 2006], "sentence": dur(weeks=5, days=2),
                   "offence_class": "stealing"},
                  note="37 days, ordinary remission 7 days (R6.2); weeks folded at 7 days (R2.3)"))
    C.append(case("p05b-40-days", 5, "simple",
                  {"date_of_sentence": [1, 1, 2006], "sentence": dur(days=40),
                   "offence_class": "stealing"},
                  note="ordinary remission 10 days (R6.2)"))

    # ---- p.5 one-third remission -----------------------------------------
    C.append(case("p05-kwesi-mensah", 5, "simple",
                  {"date_of_sentence": [6, 11, 2005], "sentence": dur(days=100),
                   "offence_class": "stealing"},
                  note="remission stays in days, R6.7; roll-forward sequence 106-11, 76-12, 45-1, 14-2 (R4.2)"))
    C.append(case("p05-6-years", 5, "simple",
                  {"date_of_sentence": [17, 11, 2004], "sentence": dur(years=6),
                   "offence_class": "stealing"}))

    # ---- p.7 impossible dates and the debtor -----------------------------
    C.append(case("p07-debtor-6-months", 7, "simple",
                  {"date_of_sentence": [31, 8, 72], "sentence": dur(months=6),
                   "offence_class": "debt"},
                  note="terminal impossible date clamps back, written 28(30)-2-73 (R4.4, R4.5)"))
    C.append(case("p07-1-month-over-feb-76", 7, "simple",
                  {"date_of_sentence": [31, 1, 76], "sentence": dur(months=1),
                   "offence_class": "stealing"},
                  note="leap February, 29(30)-2-76"))
    C.append(case("p07-3-months-ihl", 7, "simple",
                  {"date_of_sentence": [1, 12, 71], "sentence": dur(months=3),
                   "offence_class": "stealing"},
                  note="month-end preserved across whole-month subtraction (R4.7)"))

    # ---- p.8 additional sentence -----------------------------------------
    C.append(case("p08-paul-mensah", 8, "additional",
                  {"date_of_sentence": [25, 7, 2005],
                   "first": dur(months=6), "first_class": "debt",
                   "second": dur(months=9, days=14), "second_class": "assault"},
                  note="remission on the 9mths 14days only (R6.6, R8.1)"))
    C.append(case("p08-ex2", 8, "additional",
                  {"date_of_sentence": [24, 10, 2003],
                   "first": dur(months=15), "first_class": "stealing",
                   "second": dur(years=3, months=7, days=26), "second_class": "assault"}))

    # ---- p.9 concurrent and consecutive ----------------------------------
    C.append(case("p09-ex1-concurrent", 9, "counts",
                  {"date_of_sentence": [26, 11, 66], "offence_class": "stealing",
                   "groups": [[dur(years=1, months=10), dur(years=1, months=6)]]},
                  booklet_says={"epd": "16-3-68"},
                  note="booklet prints EPD 16-3-68, a misprint (R8.2)"))
    C.append(case("p09-ex2-grouped", 9, "counts",
                  {"date_of_sentence": [28, 3, 2007], "offence_class": "stealing",
                   "groups": [
                       [dur(months=10), dur(months=18), dur(months=6)],
                       [dur(months=9), dur(years=2), dur(years=1, months=5, days=11)],
                   ]},
                  booklet_says={"remission_label": "1yr 10mths"},
                  note="right figure under a label reading '1yr 10mths' (R8.2, R8.3)"))

    # ---- p.10 reduction on appeal (Yaw Atta) -----------------------------
    # The question gives 10yrs 3mths and an appeal decided on 17/11/99; the
    # working uses 10yrs 4mths and never touches the appeal date (rule (d)).
    C.append(case("p10-appeal-reduction", 10, "reduction",
                  {"date_of_sentence": [31, 3, 1998],
                   "sentence": dur(years=10, months=4), "cut": dur(years=3),
                   "offence_class": "felony"},
                  booklet_says={"sentence_in_question": "10yrs 3mths"},
                  note="worked from the original D/S; the date of the appeal is recorded, not used (R8.4, p.10 rule d)"))

    # ---- p.11 presidential pardon ----------------------------------------
    C.append(case("p11-pardon", 11, "reduction",
                  {"date_of_sentence": [30, 12, 1998],
                   "sentence": dur(years=14, months=3, days=1), "cut": dur(years=2),
                   "offence_class": "fraud"},
                  booklet_says={"remission_label": "13yrs 3mths 1day"},
                  note="intermediate 30-2-2007 rolls forward (R4.6); right figure under a wrong label (R8.4)"))

    # ---- p.12 single escape: the A1 contradiction ------------------------
    C.append(case("p12-period-served", 12, "date_diff",
                  {"later": [10, 3, 2007], "earlier": [15, 12, 2006]},
                  note="borrowing February 2007 = 28 (R4.8)"))
    C.append(case("p12-residue", 12, "duration_sub",
                  {"a": dur(years=2), "b": dur(months=2, days=23)},
                  note="2yrs less 2mths 23days at 30 days to the month (R2.2)"))
    C.append(case("p12-escape-residue-basis", 12, "single_escape",
                  {"date_of_sentence": [15, 12, 2006], "sentence": dur(years=2),
                   "date_of_escape": [10, 3, 2007], "date_of_recapture": [25, 8, 2007],
                   "offence_class": "stealing"},
                  policy=Policy(escape_remission_base="residue"),
                  note="the booklet's own worked example takes remission on the residue (A1)"))
    C.append(case("p12-escape-original-basis", 12, "single_escape",
                  {"date_of_sentence": [15, 12, 2006], "sentence": dur(years=2),
                   "date_of_escape": [10, 3, 2007], "date_of_recapture": [25, 8, 2007],
                   "offence_class": "stealing"},
                  policy=Policy(escape_remission_base="original"),
                  note="rule (h): remission on the original 2yrs, the engine default (A1)"))

    # ---- p.14/15 double escape -------------------------------------------
    C.append(case("p15-q1-double-escape", 15, "double_escape",
                  {"date_of_sentence": [17, 8, 80], "sentence": dur(years=3),
                   "date_of_escape_1": [27, 10, 80], "date_of_recapture_1": [10, 2, 81],
                   "date_of_escape_2": [25, 4, 81], "date_of_recapture_2": [22, 11, 81],
                   "offence_class": "fraud"},
                  note="R8.6"))
    C.append(case("p16-q2-double-escape", 16, "double_escape",
                  {"date_of_sentence": [19, 5, 71], "sentence": dur(years=3),
                   "date_of_escape_1": [2, 8, 72], "date_of_recapture_1": [28, 10, 72],
                   "date_of_escape_2": [22, 12, 72], "date_of_recapture_2": [13, 12, 72],
                   "extra_sentence": dur(months=6), "cut": dur(months=12),
                   "offence_class": "stealing"},
                  note="the question's dates are impossible (escape 22/12/72, recapture 20/12/72); "
                       "the working uses 13-12-72 as the 2nd date of recapture"))

    # ---- p.18 hospital ---------------------------------------------------
    C.append(case("p18-hospital-period", 18, "date_diff",
                  {"later": [26, 12, 2004], "earlier": [20, 9, 2004]},
                  note="3mths 6days in hospital (R4.8)"))
    C.append(case("p18-hospital-loss", 18, "hospital",
                  {"date_of_sentence": [25, 8, 2004], "sentence": dur(years=6),
                   "offence_class": "stealing",
                   "hospital_from": [20, 9, 2004], "hospital_to": [26, 12, 2004]},
                  note="96 days / 3 = 32 days = 1mth 2days lost, added back to the EPD (R7.2)"))

    # ---- rounding rule (R6.4) --------------------------------------------
    for n, why in ((284, "rounds up on remainder 2"), (100, "discards remainder 1"),
                   (1766, "rounds up"), (4411, "discards")):
        C.append(case(f"r64-one-third-{n}", None, "one_third", {"n": n}, note=f"R6.4 {why}"))

    # ---- licence (R8.8) --------------------------------------------------
    C.append(case("r88-male-3yrs-stealing", 18, "licence",
                  {"sex": "male", "sentence": dur(years=3), "offence": "stealing"}))
    C.append(case("r88-female-excluded", 18, "licence",
                  {"sex": "female", "sentence": dur(years=3), "offence": "stealing"},
                  note="p.18(b), the Ordinance's definition of 'convict'"))
    C.append(case("r88-under-two-years", 18, "licence",
                  {"sex": "male", "sentence": dur(years=1), "offence": "stealing"}))

    # ---- engine-derived extras: scenarios the booklet pages do not show --
    # These have no booklet authority. They exist so the TypeScript port is
    # exercised on every code path, and they carry source "engine".
    C.append(case("x-bailed-out", None, "bailed_out",
                  {"date_of_sentence": [1, 3, 2005], "sentence": dur(years=2),
                   "date_of_bail": [1, 6, 2005], "date_of_readmission": [1, 9, 2006],
                   "offence_class": "stealing"},
                  source="engine",
                  note="R8.7; the worked example is on p.13, which was not supplied"))
    C.append(case("x-forfeiture-30-days", None, "forfeiture",
                  {"date_of_sentence": [17, 11, 2004], "sentence": dur(years=6),
                   "offence_class": "stealing", "forfeited_days": 30},
                  source="engine", note="R7.1 forfeiture added back to the EPD"))
    C.append(case("x-forfeiture-capped-at-lpd", None, "forfeiture",
                  {"date_of_sentence": [17, 10, 2006], "sentence": dur(weeks=5, days=2),
                   "offence_class": "stealing", "forfeited_days": 20},
                  source="engine", note="R7.4 hard cap: forfeiture may not push past the LPD"))
    C.append(case("x-punishment-same-date", None, "punishment_loss",
                  {"close_days": 6, "diet_days": 3, "same_date": True},
                  source="engine", note="R7.3 same date: higher of the two, divided by three"))
    C.append(case("x-punishment-different-dates", None, "punishment_loss",
                  {"close_days": 6, "diet_days": 3, "same_date": False},
                  source="engine", note="R7.3 different dates: added, one third forfeited"))
    C.append(case("x-leap-1900-gregorian", None, "simple",
                  {"date_of_sentence": [1, 2, 1900], "sentence": dur(days=29),
                   "offence_class": "stealing"},
                  source="engine", note="R2.4 true rule: 1900 is not leap; 30-2-1900 rolls forward to 2-3-1900 before grace, D/R 1-3-1900"))
    C.append(case("x-leap-1900-divide-by-4", None, "simple",
                  {"date_of_sentence": [1, 2, 1900], "sentence": dur(days=29),
                   "offence_class": "stealing"},
                  policy=Policy(leap_rule="divide_by_4"),
                  source="engine", note="R2.4 booklet rule: 1900 treated as leap; 30-2-1900 rolls to 1-3-1900, grace gives D/R 29-2-1900"))
    C.append(case("x-month-end-preservation-off", None, "simple",
                  {"date_of_sentence": [1, 12, 71], "sentence": dur(months=3),
                   "offence_class": "stealing"},
                  policy=Policy(month_end_preservation=False),
                  source="engine", note="A4 switch off: 29-2-72 less 1 month stays 29-1-72, EPD 30-1-72"))
    return C


# --------------------------------------------------------------------------
# entry points
# --------------------------------------------------------------------------

def dump(cases: List[Dict[str, Any]]) -> str:
    return json.dumps({
        "format": 1,
        "generator": "reference/export_vectors.py",
        "ruleset": "booklet-as-supplied-2026-09",
        "cases": cases,
    }, indent=2, ensure_ascii=False) + "\n"


def export() -> int:
    cases = build_cases()
    for c in cases:
        assert c["expect"], f"empty expect in {c['id']}"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dump(cases), encoding="utf-8")
    print(f"wrote {len(cases)} cases to {OUT}")
    return 0


def verify() -> int:
    doc = json.loads(OUT.read_text(encoding="utf-8"))
    bad = 0
    for c in doc["cases"]:
        got = run_case(c)
        if got != c["expect"]:
            bad += 1
            print(f"MISMATCH {c['id']} (p.{c['page']})")
            for k in sorted(set(got) | set(c["expect"])):
                if got.get(k) != c["expect"].get(k):
                    print(f"    {k}: committed {c['expect'].get(k)!r}, engine {got!r}"
                          if k == "render" else
                          f"    {k}: committed {c['expect'].get(k)!r}, engine {got.get(k)!r}")
    # the generator must also still produce the committed file byte for byte
    regenerated = dump(build_cases())
    committed = OUT.read_text(encoding="utf-8")
    if regenerated != committed:
        bad += 1
        print("MISMATCH: regenerating the file does not reproduce the committed bytes")
    print(f"{len(doc['cases'])} cases, {bad} mismatch(es)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(verify() if "--verify" in sys.argv else export())
