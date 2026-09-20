#!/usr/bin/env python3
"""Task 4.1 acceptance: valid persists, a `name` key is 422, malformed body survives."""
import json
import os
import sqlite3
import sys
import tempfile

tmp = tempfile.mkdtemp()
os.environ["COMPUTATION_DB"] = os.path.join(tmp, "t.sqlite3")
os.environ["COMPUTATION_RATE"] = "20"

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import to_vectors  # noqa: E402

c = TestClient(main.app)
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")


VALID = {
    "reviewer_token": "abc123",
    "engine_version": "1.0.0",
    "ruleset_version": "booklet-as-supplied-2026-09",
    "build_date": "2026-09-14T00:00:00Z",
    "scenario": "simple",
    "inputs": {
        "date_of_sentence": [6, 11, 2005],
        "sentence": {"days": 100, "months": 0, "years": 0},
        "offence_class": "stealing",
        "policy": {"leap_rule": "gregorian", "month_end_preservation": True, "escape_remission_base": "original"},
    },
    "engine_lpd": "13-2-2006",
    "engine_epd": "12-1-2006",
    "reviewer_lpd": "13-2-2006",
    "reviewer_epd": "11-1-2006",
    "comment": "I make it one day earlier.",
}

r = c.post("/feedback", json=VALID, headers={"user-agent": "test-agent"})
check("valid payload is 201", r.status_code == 201, r.text)
row = sqlite3.connect(os.environ["COMPUTATION_DB"]).execute(
    "SELECT engine_version, ruleset_version, build_date, scenario, inputs_json, reviewer_epd, user_agent FROM feedback"
).fetchone()
check("row persisted with versions intact", row is not None and row[0] == "1.0.0"
      and row[1] == "booklet-as-supplied-2026-09" and row[2] == "2026-09-14T00:00:00Z", str(row))
check("inputs stored as compact JSON", row is not None and json.loads(row[4])["sentence"]["days"] == 100)

bad = json.loads(json.dumps(VALID))
bad["inputs"]["name"] = "Kwesi Mensah"
r = c.post("/feedback", json=bad)
check("a `name` key in inputs is rejected with 422", r.status_code == 422, r.text[:120])

bad = json.loads(json.dumps(VALID))
bad["prison_number"] = "1234"
r = c.post("/feedback", json=bad)
check("an unexpected top-level key is rejected with 422", r.status_code == 422)

bad = json.loads(json.dumps(VALID))
bad["inputs"]["offence_class"] = "Kwesi Mensah"
r = c.post("/feedback", json=bad)
check("free text in an enumerated field is rejected with 422", r.status_code == 422)

bad = json.loads(json.dumps(VALID))
bad["reviewer_lpd"] = bad["reviewer_epd"] = ""
r = c.post("/feedback", json=bad)
check("no reviewer answer at all is rejected with 422", r.status_code == 422)

r = c.post("/feedback", content=b"{not json", headers={"content-type": "application/json"})
check("malformed body is 422, not 500", r.status_code == 422, r.text[:80])
r = c.post("/feedback", content=b"\xff\xfe\x00", headers={"content-type": "application/json"})
check("binary garbage is 422, not 500", r.status_code == 422)
r = c.post("/feedback", content=b"x" * 40000, headers={"content-type": "application/json"})
check("oversize body is 413", r.status_code == 413)
r = c.post("/feedback", json=[1, 2, 3])
check("a JSON array is 422", r.status_code == 422)

# rate limit: 20 per hour, counted on every POST whether or not it validates
codes = [c.post("/feedback", json=VALID).status_code for _ in range(20)]
check("rate limit kicks in with 429", 429 in codes and 201 in codes, str(sorted(set(codes))))

r = c.get("/feedback")
check("GET is not a route", r.status_code == 405)

# Task 4.3: rows convert into vector cases
cases = to_vectors.convert(os.environ["COMPUTATION_DB"])
check("to_vectors converts the rows", len(cases) >= 1 and cases[0]["source"] == "reviewer")
check("policy lifted out of inputs", "policy" not in cases[0]["inputs"] and cases[0]["policy"]["leap_rule"] == "gregorian")
check("expect holds the reviewer's dates", cases[0]["expect"] == {"lpd": "13-2-2006", "epd": "11-1-2006"})
out = os.path.join(tmp, "reviewer.json")
with open(out, "w") as f:
    json.dump({"format": 1, "cases": cases}, f)
print(f"wrote sample reviewer vectors to {out}")

print("\n".join(PASS + FAIL))
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
