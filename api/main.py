#!/usr/bin/env python3
"""
Feedback API. One route: POST /feedback. SQLite via sqlite3, no ORM, no auth.

Receives a reviewer's disagreement with the engine: the abstract inputs, the
engine's answer, the reviewer's answer, and a reason. Nothing else is
accepted. inputs_json may contain only the known abstract input keys; any
unexpected key (a name, a prison number, anything) is rejected with 422.

Run:  uvicorn main:app --host 127.0.0.1 --port 8001
Env:  COMPUTATION_DB      path to the SQLite file (default ./feedback.sqlite3)
      COMPUTATION_ORIGIN  the site origin allowed by CORS
      COMPUTATION_RATE    requests per hour per IP (default 30)
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DB_PATH = os.environ.get("COMPUTATION_DB", os.path.join(os.path.dirname(__file__), "feedback.sqlite3"))
ORIGIN = os.environ.get("COMPUTATION_ORIGIN", "https://computation.example.org")
RATE_PER_HOUR = int(os.environ.get("COMPUTATION_RATE", "30"))
MAX_BODY = 32 * 1024

# --------------------------------------------------------------------------
# The abstract vocabulary. Mirrors web/src/engine/cases.ts and the vectors.
# --------------------------------------------------------------------------

SCENARIOS = {
    "simple", "additional", "counts", "reduction", "single_escape", "double_escape",
    "bailed_out", "hospital", "forfeiture", "date_diff", "duration_sub", "one_third",
    "punishment_loss", "licence",
}
DATE_KEYS = {
    "date_of_sentence", "date_of_escape", "date_of_recapture", "date_of_escape_1",
    "date_of_recapture_1", "date_of_escape_2", "date_of_recapture_2", "date_of_bail",
    "date_of_readmission", "hospital_from", "hospital_to", "later", "earlier",
}
DURATION_KEYS = {"sentence", "first", "second", "cut", "extra_sentence", "a", "b"}
CLASS_KEYS = {"offence_class", "first_class", "second_class", "offence"}
INT_KEYS = {"forfeited_days", "n", "close_days", "diet_days"}
BOOL_KEYS = {"same_date"}
OTHER_KEYS = {"groups", "sex", "policy"}
INPUT_KEYS = DATE_KEYS | DURATION_KEYS | CLASS_KEYS | INT_KEYS | BOOL_KEYS | OTHER_KEYS

OFFENCE_CLASSES = {
    "stealing", "fraud", "burglary", "robbery", "arson", "assault", "felony", "misdemeanour",
    "murder", "attempted murder", "conspiracy to murder", "debt", "debtor", "contempt",
    "condemned", "life", "lifer",
}
POLICY = {
    "leap_rule": {"gregorian", "divide_by_4"},
    "month_end_preservation": {True, False},
    "escape_remission_base": {"original", "residue"},
}
DATE_RE = re.compile(r"^\d{1,2}(\(\d{1,2}\))?-\d{1,2}-\d{1,4}$")


def _int(v: Any, lo: int = 0, hi: int = 100_000) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
        raise ValueError(f"expected an integer between {lo} and {hi}")
    return v


def _date(v: Any) -> list:
    if not isinstance(v, list) or len(v) != 3:
        raise ValueError("a date is [d, m, y]")
    return [_int(v[0], 1, 31), _int(v[1], 1, 12), _int(v[2], 1, 9999)]


def _duration(v: Any) -> dict:
    if not isinstance(v, dict) or not set(v) <= {"days", "months", "years"}:
        raise ValueError("a duration is {days, months, years}")
    return {k: _int(v.get(k, 0)) for k in ("days", "months", "years")}


def validate_inputs(obj: Any) -> Dict[str, Any]:
    """Accept only the abstract vocabulary. Reject any unexpected key or free text."""
    if not isinstance(obj, dict):
        raise ValueError("inputs must be an object")
    unknown = set(obj) - INPUT_KEYS
    if unknown:
        raise ValueError(f"unexpected input key(s): {', '.join(sorted(unknown))}")
    out: Dict[str, Any] = {}
    for k, v in obj.items():
        if k in DATE_KEYS:
            out[k] = _date(v)
        elif k in DURATION_KEYS:
            out[k] = _duration(v)
        elif k in CLASS_KEYS:
            if not isinstance(v, str) or v.lower() not in OFFENCE_CLASSES:
                raise ValueError(f"{k}: not a known offence class")
            out[k] = v.lower()
        elif k in INT_KEYS:
            out[k] = _int(v)
        elif k in BOOL_KEYS:
            if not isinstance(v, bool):
                raise ValueError(f"{k}: expected true or false")
            out[k] = v
        elif k == "sex":
            if v not in ("male", "female", "m", "f"):
                raise ValueError("sex: expected male or female")
            out[k] = v
        elif k == "groups":
            if not isinstance(v, list) or not v or len(v) > 12:
                raise ValueError("groups: a list of 1 to 12 groups")
            out[k] = [[_duration(d) for d in (g if isinstance(g, list) and 0 < len(g) <= 12 else [None])] for g in v]
        elif k == "policy":
            if not isinstance(v, dict) or not set(v) <= set(POLICY):
                raise ValueError("policy: unexpected key")
            for pk, pv in v.items():
                if pv not in POLICY[pk]:
                    raise ValueError(f"policy.{pk}: unexpected value")
            out[k] = dict(v)
    return out


# --------------------------------------------------------------------------
# Request model
# --------------------------------------------------------------------------

class Feedback(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=2000)

    reviewer_token: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    engine_version: str = Field(max_length=32, pattern=r"^[0-9A-Za-z.+-]+$")
    ruleset_version: str = Field(max_length=64, pattern=r"^[0-9A-Za-z.+-]+$")
    build_date: Optional[str] = Field(None, max_length=32, pattern=r"^[0-9A-Za-z:.TZ-]+$")
    scenario: str
    inputs: Dict[str, Any]
    engine_lpd: Optional[str] = None
    engine_epd: Optional[str] = None
    reviewer_lpd: str = ""
    reviewer_epd: str = ""
    comment: str = Field("", max_length=2000)

    @field_validator("scenario")
    @classmethod
    def _scenario(cls, v: str) -> str:
        if v not in SCENARIOS:
            raise ValueError("unknown scenario")
        return v

    @field_validator("inputs")
    @classmethod
    def _inputs(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        return validate_inputs(v)

    @field_validator("engine_lpd", "engine_epd", "reviewer_lpd", "reviewer_epd")
    @classmethod
    def _dates(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        if not DATE_RE.match(v):
            raise ValueError("a date is written d-m-y")
        return v

    @model_validator(mode="after")
    def _one_answer(self) -> "Feedback":
        if not self.reviewer_lpd and not self.reviewer_epd:
            raise ValueError("give at least one of reviewer_lpd, reviewer_epd")
        return self


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at     TEXT NOT NULL,
  reviewer_token  TEXT,
  engine_version  TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  build_date      TEXT,
  scenario        TEXT NOT NULL,
  inputs_json     TEXT NOT NULL,
  engine_lpd      TEXT,
  engine_epd      TEXT,
  reviewer_lpd    TEXT,
  reviewer_epd    TEXT,
  comment         TEXT,
  user_agent      TEXT
);
"""

_db_lock = threading.Lock()


def db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def store(fb: Feedback, user_agent: str) -> Dict[str, Any]:
    received_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _db_lock, db() as conn:
        cur = conn.execute(
            "INSERT INTO feedback (received_at, reviewer_token, engine_version, ruleset_version, "
            "build_date, scenario, inputs_json, engine_lpd, engine_epd, reviewer_lpd, reviewer_epd, "
            "comment, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                received_at, fb.reviewer_token, fb.engine_version, fb.ruleset_version, fb.build_date,
                fb.scenario, json.dumps(fb.inputs, separators=(",", ":"), sort_keys=True),
                fb.engine_lpd, fb.engine_epd, fb.reviewer_lpd, fb.reviewer_epd,
                fb.comment.strip(), user_agent[:256],
            ),
        )
        return {"id": cur.lastrowid, "received_at": received_at}


# --------------------------------------------------------------------------
# Rate limit by IP, in memory
# --------------------------------------------------------------------------

_hits: Dict[str, Deque[float]] = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _hits_lock:
        q = _hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= RATE_PER_HOUR:
            return True
        q.append(now)
        return False


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = FastAPI(title="computation-feedback", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
    max_age=600,
)


@app.post("/feedback", status_code=201)
async def post_feedback(request: Request) -> JSONResponse:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY:
        raise HTTPException(413, "body too large")
    if rate_limited(client_ip(request)):
        raise HTTPException(429, "too many reports from this address; try again later")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "body too large")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "body is not valid JSON")
    try:
        fb = Feedback.model_validate(data)
    except Exception as e:  # pydantic ValidationError
        return JSONResponse(status_code=422, content={"detail": _short_errors(e)})
    rec = store(fb, request.headers.get("user-agent", ""))
    return JSONResponse(status_code=201, content=rec)


def _short_errors(e: Exception) -> Any:
    errors = getattr(e, "errors", None)
    if callable(errors):
        return [{"loc": [str(x) for x in err.get("loc", [])], "msg": err.get("msg", "")} for err in errors()]
    return str(e)


@app.get("/feedback/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}
