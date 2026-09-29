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
os.environ["COMPUTATION_USAGE_RATE"] = "12"
os.environ["COMPUTATION_ORIGIN"] = "http://testserver"

from fastapi.testclient import TestClient  # noqa: E402

import admin  # noqa: E402
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

# ---- usage counts ---------------------------------------------------------
from datetime import datetime, timedelta, timezone  # noqa: E402

NOW = datetime.now(timezone.utc).replace(microsecond=0)
stamp = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
EVENT = {"scenario": "simple", "at": stamp(NOW), "ok": True, "offline": False,
         "engine_version": "1.1.0", "ruleset_version": "booklet-as-supplied-2026-09",
         "build_date": "2026-09-28T17:01:48Z"}
USAGE = {"device_id": "0f8fad5b-d9cb-469f-a165-70867728950e", "installed": False, "events": [EVENT]}

r = c.post("/usage", json=USAGE)
check("a usage post is 201", r.status_code == 201 and r.json() == {"stored": 1}, r.text)

batch = json.loads(json.dumps(USAGE))
batch["device_id"] = "second-device-0001"
batch["installed"] = True
batch["events"] = [
    dict(EVENT, scenario="reduction", at=stamp(NOW - timedelta(days=2)), offline=True),
    dict(EVENT, scenario="simple", at=stamp(NOW - timedelta(days=2)), engine_version="1.0.0"),
    dict(EVENT, scenario="hospital", at=stamp(NOW + timedelta(days=3))),       # clock ahead
    dict(EVENT, scenario="simple", at=stamp(NOW - timedelta(days=400)), ok=False),  # clock far behind
]
r = c.post("/usage", json=batch)
check("a batch of queued events is stored", r.status_code == 201 and r.json() == {"stored": 4}, r.text)
days = [x[0] for x in sqlite3.connect(os.environ["COMPUTATION_DB"]).execute("SELECT day FROM usage ORDER BY id")]
today = NOW.date().isoformat()
check("an unbelievable device clock falls back to the time received",
      days == [today, (NOW - timedelta(days=2)).date().isoformat(), (NOW - timedelta(days=2)).date().isoformat(), today, today],
      str(days))

bad = json.loads(json.dumps(USAGE))
bad["events"][0]["sentence"] = {"days": 100, "months": 0, "years": 0}
check("a usage event cannot carry an input", c.post("/usage", json=bad).status_code == 422)
bad = json.loads(json.dumps(USAGE))
bad["events"][0]["date_of_sentence"] = [6, 11, 2005]
check("a usage event cannot carry a date of sentence", c.post("/usage", json=bad).status_code == 422)
bad = json.loads(json.dumps(USAGE))
bad["name"] = "Kwesi Mensah"
check("an unexpected top-level key in usage is 422", c.post("/usage", json=bad).status_code == 422)
bad = json.loads(json.dumps(USAGE))
bad["events"][0]["scenario"] = "Kwesi Mensah"
check("free text as a scenario is 422", c.post("/usage", json=bad).status_code == 422)
bad = json.loads(json.dumps(USAGE))
bad["device_id"] = "Kwesi Mensah, Nsawam"
check("free text as a device id is 422", c.post("/usage", json=bad).status_code == 422)
bad = json.loads(json.dumps(USAGE))
bad["events"] = [EVENT] * 101
check("more than 100 events in one post is 422", c.post("/usage", json=bad).status_code == 422)
check("malformed usage body is 422, not 500",
      c.post("/usage", content=b"{not json", headers={"content-type": "application/json"}).status_code == 422)
check("oversize usage body is 413",
      c.post("/usage", content=b"x" * 40000, headers={"content-type": "application/json"}).status_code == 413)
codes = [c.post("/usage", json=USAGE).status_code for _ in range(12)]
check("usage has its own rate limit", 429 in codes and 201 in codes, str(sorted(set(codes))))
check("the usage limit does not spend the report limit", len(main._usage_hits["testclient"]) == 12
      and len(main._hits["testclient"]) == 20, f"{len(main._usage_hits['testclient'])} {len(main._hits['testclient'])}")

# ---- /admin ---------------------------------------------------------------
a = TestClient(main.app)   # a fresh browser, no cookie

r = a.get("/admin")
check("the admin page is served", r.status_code == 200 and "text/html" in r.headers["content-type"])
check("the admin page is not cached or framed, and runs only its own script",
      r.headers.get("cache-control") == "no-store" and "script-src 'self'" in r.headers.get("content-security-policy", "")
      and "frame-ancestors 'none'" in r.headers.get("content-security-policy", ""))
check("the admin script and stylesheet are served",
      a.get("/admin/admin.js").status_code == 200 and a.get("/admin/admin.css").status_code == 200)
check("no other file is served from /admin", a.get("/admin/admin.py").status_code == 404
      and a.get("/admin/../main.py").status_code == 404)

check("no password set: the session says so", a.get("/admin/api/session").json() == {"configured": False, "authenticated": False})
check("no password set: login is 503", a.post("/admin/api/login", json={"password": "anything at all"}).status_code == 503)
for path in ("/admin/api/reports", "/admin/api/usage", "/admin/api/reports/vectors"):
    check(f"{path} needs a session", a.get(path).status_code == 401)
check("changing a status needs a session",
      a.post("/admin/api/reports/1/status", json={"status": "fixed", "note": ""}).status_code == 401)

try:
    admin.write_hash("short")
    check("a short password is refused", False)
except ValueError:
    check("a short password is refused", True)
path = admin.write_hash("correct horse battery")
text = open(path).read()
check("only a salted scrypt hash is written", text.startswith("scrypt$") and "correct horse" not in text, text[:20])
check("the hash file is private", oct(os.stat(path).st_mode & 0o777) == "0o600", oct(os.stat(path).st_mode & 0o777))
check("the hash file sits beside the database", os.path.dirname(path) == tmp, path)
check("the same password hashes differently each time",
      admin.hash_password("correct horse battery") != admin.hash_password("correct horse battery"))

check("a password is set: the session says so", a.get("/admin/api/session").json() == {"configured": True, "authenticated": False})
r = a.post("/admin/api/login", json={"password": "wrong horse battery"})
check("a wrong password is 401 and sets no cookie", r.status_code == 401 and "set-cookie" not in r.headers)
r = a.post("/admin/api/login", json={"password": "correct horse battery"}, headers={"origin": "https://evil.example"})
check("a login from another origin is 403", r.status_code == 403)
r = a.post("/admin/api/login", json={"password": "correct horse battery"})
cookie = r.headers.get("set-cookie", "")
check("the right password is 204 with a session cookie", r.status_code == 204 and admin.COOKIE in cookie, cookie[:60])
check("the cookie is HttpOnly, SameSite=Strict and scoped to /admin",
      "httponly" in cookie.lower() and "samesite=strict" in cookie.lower() and "path=/admin" in cookie.lower(), cookie)
check("signed in: the session says so", a.get("/admin/api/session").json() == {"configured": True, "authenticated": True})

forged = TestClient(main.app)
forged.cookies.set(admin.COOKIE, f"{int(NOW.timestamp()) + 99999}.{'0' * 64}", path="/admin")
check("a forged cookie is refused", forged.get("/admin/api/reports").status_code == 401)
expired = str(int(NOW.timestamp()) - 10)
forged.cookies.set(admin.COOKIE, f"{expired}.{admin._sign(expired)}", path="/admin")
check("an expired session is refused", forged.get("/admin/api/reports").status_code == 401)

r = a.get("/admin/api/reports")
reports = r.json()["reports"]
check("reports are listed, newest first", r.status_code == 200 and len(reports) >= 2
      and reports[0]["id"] > reports[-1]["id"], str(len(reports)))
first = reports[-1]
check("a report carries the inputs, both answers and the comment",
      first["inputs"]["sentence"]["days"] == 100 and first["reviewer_epd"] == "11-1-2006"
      and first["engine_epd"] == "12-1-2006" and first["comment"] == "I make it one day earlier."
      and first["policy"]["leap_rule"] == "gregorian" and "policy" not in first["inputs"])
check("a new report is open", first["status"] == "open" and first["status_note"] == "")
check("the reference engine re-runs the case", r.json()["engine_available"] and first["engine_now"]["epd"] == "12-1-2006"
      and first["engine_now"]["lpd"] == "13-2-2006" and "EPD" in first["engine_now"]["render"], str(first["engine_now"])[:120])
check("the engine still disagrees with this reviewer", first["engine_now_agrees"] is False)
check("dates compare by value, not by spelling", admin.same_date("27-06-1996", "27-6-1996") is True
      and admin.same_date("29(30)-2-76", "29-2-76") is True and admin.same_date("1-1-2000", None) is None)

agree = json.loads(json.dumps(VALID))
agree["inputs"] = {"date_of_sentence": [30, 6, 1995], "sentence": {"days": 90, "months": 9, "years": 0},
                   "offence_class": "stealing", "policy": VALID["inputs"]["policy"]}
agree.update(engine_lpd="27-6-1996", engine_epd="28-2-1996", reviewer_lpd="27-06-1996", reviewer_epd="29-02-1996")
main._hits.clear()
r = c.post("/feedback", json=agree)
new_id = r.json()["id"]
top = a.get("/admin/api/reports").json()["reports"][0]
check("the 9mths 90days report: the engine now agrees with the reviewer",
      top["id"] == new_id and top["engine_now"]["epd"] == "29-2-1996" and top["engine_now_agrees"] is True
      and top["engine_now"]["remission"] == "3mths 30days", str(top["engine_now"])[:100])

r = a.post(f"/admin/api/reports/{new_id}/status", json={"status": "fixed", "note": " engine 1.1.0 "})
check("a status can be set", r.status_code == 200 and r.json()["status"] == "fixed" and r.json()["status_note"] == "engine 1.1.0", r.text)
r = a.post(f"/admin/api/reports/{new_id}/status", json={"status": "reviewer_right", "note": "fixed in 1.1.0"})
top = a.get("/admin/api/reports").json()["reports"][0]
check("a status can be changed, and is kept", top["status"] == "reviewer_right" and top["status_note"] == "fixed in 1.1.0"
      and top["status_at"] is not None)
check("an unknown status is 422",
      a.post(f"/admin/api/reports/{new_id}/status", json={"status": "deleted", "note": ""}).status_code == 422)
check("a status for a report that does not exist is 404",
      a.post("/admin/api/reports/99999/status", json={"status": "fixed", "note": ""}).status_code == 404)
check("a status change from another origin is 403",
      a.post(f"/admin/api/reports/{new_id}/status", json={"status": "open", "note": ""},
             headers={"origin": "https://evil.example"}).status_code == 403)

r = a.get("/admin/api/reports/vectors")
check("the reports download as reviewer vectors", r.status_code == 200 and r.json()["cases"][0]["source"] == "reviewer"
      and "attachment" in r.headers.get("content-disposition", ""))

r = a.get("/admin/api/usage?days=30")
u = r.json()
stored = sqlite3.connect(os.environ["COMPUTATION_DB"]).execute("SELECT COUNT(*) FROM usage").fetchone()[0]
check("usage totals", r.status_code == 200 and u["total"] == stored and u["all_time"] == stored and u["devices"] == 2, str(u)[:200])
check("usage has one row per day, zeros included", len(u["daily"]) == 30 and u["daily"][-1]["day"] == today
      and u["daily"][-1]["n"] == stored - 2 and u["daily"][-3]["n"] == 2 and u["daily"][-2]["n"] == 0)
check("usage today and the last 7 days", u["today"] == stored - 2 and u["last_7_days"] == stored)
by = {x["scenario"]: x["n"] for x in u["scenarios"]}
check("usage by scenario, largest first", by == {"simple": stored - 2, "reduction": 1, "hospital": 1}
      and u["scenarios"][0]["scenario"] == "simple", str(by))
check("usage by version", {x["engine_version"] for x in u["versions"]} == {"1.0.0", "1.1.0"})
check("installed, offline and failed counts", u["installed"] == 4 and u["offline"] == 1 and u["failed"] == 1,
      f"{u['installed']} {u['offline']} {u['failed']}")
check("open reports are counted", u["reports_total"] == len(reports) + 1 and u["reports_open"] == len(reports))
check("a one-day range is today only", a.get("/admin/api/usage?days=1").json()["total"] == stored - 2)
check("a silly range is 422", a.get("/admin/api/usage?days=0").status_code == 422
      and a.get("/admin/api/usage?days=9999").status_code == 422)

r = a.post("/admin/api/logout")
check("signing out ends the session", r.status_code == 204 and a.get("/admin/api/reports").status_code == 401)

b = TestClient(main.app)
codes = [b.post("/admin/api/login", json={"password": f"guess number {i}"}).status_code for i in range(12)]
check("repeated wrong passwords are locked out", codes[:9] == [401] * 9 and codes[-1] == 429, str(codes))
check("while locked out even the right password is refused",
      b.post("/admin/api/login", json={"password": "correct horse battery"}).status_code == 429)

print("\n".join(PASS + FAIL))
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
