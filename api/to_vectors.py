#!/usr/bin/env python3
"""
Convert feedback rows into the vectors/booklet.json case format, so that a
reviewer's disagreement becomes a test case directly.

    python3 to_vectors.py [--db feedback.sqlite3] [--out ../vectors/reviewer.json] [--since ID]

Each row becomes a case with source "reviewer". The `expect` block holds
only the dates the reviewer supplied, so the Vitest suite fails on that
case until the engine (or the reviewer) is shown to be right. `engine_said`
records what the engine gave at the time, with its versions.

Review every case before committing it. The comment is free text written
by a reviewer; the UI tells them not to include case details, but check.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from typing import Any, Dict, List


def row_to_case(r: sqlite3.Row) -> Dict[str, Any]:
    inputs = json.loads(r["inputs_json"])
    policy = inputs.pop("policy", {})
    expect: Dict[str, Any] = {}
    if r["reviewer_lpd"]:
        expect["lpd"] = r["reviewer_lpd"]
    if r["reviewer_epd"]:
        # a reviewer's "EPD" on a no-remission case is the D/R; keep both keys honest
        expect["epd"] = r["reviewer_epd"]
    return {
        "id": f"reviewer-{r['id']}",
        "page": None,
        "source": "reviewer",
        "scenario": r["scenario"],
        "inputs": inputs,
        "policy": {
            "leap_rule": policy.get("leap_rule", "gregorian"),
            "month_end_preservation": policy.get("month_end_preservation", True),
            "escape_remission_base": policy.get("escape_remission_base", "original"),
        },
        "expect": expect,
        "booklet_says": None,
        "engine_said": {
            "lpd": r["engine_lpd"],
            "epd": r["engine_epd"],
            "engine_version": r["engine_version"],
            "ruleset_version": r["ruleset_version"],
            "build_date": r["build_date"],
        },
        "reviewer_token": r["reviewer_token"],
        "received_at": r["received_at"],
        "note": (r["comment"] or "")[:500],
    }


def convert(db_path: str, since: int = 0) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM feedback WHERE id > ? ORDER BY id", (since,)).fetchall()
    return [row_to_case(r) for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="feedback.sqlite3")
    ap.add_argument("--out", default="-")
    ap.add_argument("--since", type=int, default=0)
    a = ap.parse_args()
    doc = {"format": 1, "generator": "api/to_vectors.py", "cases": convert(a.db, a.since)}
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    if a.out == "-":
        sys.stdout.write(text)
    else:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {len(doc['cases'])} case(s) to {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
