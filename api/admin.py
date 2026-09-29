#!/usr/bin/env python3
"""
The private side: /admin, behind one shared password.

  GET  /admin                           the page (static HTML, CSS and JS from admin_ui/)
  GET  /admin/api/session               is a password set, is this browser signed in
  POST /admin/api/login                 {password} -> session cookie
  POST /admin/api/logout
  GET  /admin/api/reports               every report, with its status and what the engine says now
  POST /admin/api/reports/{id}/status   {status, note}
  GET  /admin/api/reports/vectors       the reports as reviewer vectors (what to_vectors.py prints)
  GET  /admin/api/usage?days=30         usage counts

The password
------------
Only a scrypt hash is kept, in a file beside the database (admin.hash, in the
data volume, never in the image or the repository). Set or change it with

    python admin.py set-password        reads the password from stdin

which is what deploy/set-admin-password.sh runs inside the container. Until
the file exists the page says so and every login is refused.

Sessions are a signed expiry time in an HttpOnly, SameSite=Strict cookie. The
signing key is made fresh when the process starts, so a redeploy signs
everyone out. Failed logins are limited per address and in total.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

import to_vectors

HERE = Path(__file__).resolve().parent
UI_DIR = HERE / "admin_ui"

COOKIE = "computation_admin"
SESSION_SECONDS = 12 * 3600
MIN_PASSWORD = 10
LOGIN_PER_IP = 10        # failed attempts per address per hour
LOGIN_TOTAL = 60         # failed attempts from everywhere per hour
STATUSES = ("open", "engine_right", "reviewer_right", "fixed")

_SECRET = secrets.token_bytes(32)


def _cfg():
    """main.py owns the configuration; read it late so tests can set the environment first."""
    import main
    return main


def hash_path() -> str:
    explicit = os.environ.get("COMPUTATION_ADMIN_HASH_FILE")
    if explicit:
        return explicit
    return os.path.join(os.path.dirname(os.path.abspath(_cfg().DB_PATH)), "admin.hash")


# --------------------------------------------------------------------------
# Password hash
# --------------------------------------------------------------------------

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, want = stored.strip().split("$")
        if kind != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt),
                            n=int(n), r=int(r), p=int(p), dklen=len(want) // 2)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), want)


def stored_hash() -> Optional[str]:
    try:
        with open(hash_path(), "r", encoding="ascii") as f:
            text = f.read().strip()
    except OSError:
        return None
    return text or None


def write_hash(password: str) -> str:
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"the password must be at least {MIN_PASSWORD} characters")
    path = hash_path()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(hash_password(password) + "\n")
    os.replace(tmp, path)
    return path


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------

def _sign(payload: str) -> str:
    return hmac.new(_SECRET, payload.encode("ascii"), hashlib.sha256).hexdigest()


def new_session() -> str:
    payload = str(int(time.time()) + SESSION_SECONDS)
    return f"{payload}.{_sign(payload)}"


def session_ok(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    payload, sig = token.split(".", 1)
    if not hmac.compare_digest(sig, _sign(payload) if payload.isdigit() else ""):
        return False
    return int(payload) > time.time()


def require_session(request: Request) -> None:
    if not session_ok(request.cookies.get(COOKIE)):
        raise HTTPException(401, "sign in first")


def same_origin(request: Request) -> None:
    """A write must come from this site. SameSite=Strict already says so; this says it twice."""
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != _cfg().ORIGIN.rstrip("/"):
        raise HTTPException(403, "cross-origin request refused")


_fails: Dict[str, Deque[float]] = defaultdict(deque)
_fails_lock = threading.Lock()


def _recent(q: Deque[float], now: float) -> int:
    while q and now - q[0] > 3600:
        q.popleft()
    return len(q)


def login_locked(ip: str) -> bool:
    now = time.monotonic()
    with _fails_lock:
        return _recent(_fails[ip], now) >= LOGIN_PER_IP or _recent(_fails["*"], now) >= LOGIN_TOTAL


def login_failed(ip: str) -> None:
    now = time.monotonic()
    with _fails_lock:
        _fails[ip].append(now)
        _fails["*"].append(now)


# --------------------------------------------------------------------------
# What the engine says now
# --------------------------------------------------------------------------

def _load_engine():
    """The reference engine, if it is beside us (../reference). The admin page works without it."""
    ref = HERE.parent / "reference"
    if not (ref / "export_vectors.py").exists():
        return None
    if str(ref) not in sys.path:
        sys.path.insert(0, str(ref))
    try:
        import export_vectors  # type: ignore
        return export_vectors.run_case
    except Exception:
        return None


_run_case = _load_engine()


def engine_now(scenario: str, inputs: Dict[str, Any], policy: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if _run_case is None:
        return None
    try:
        got = _run_case({"id": "admin", "scenario": scenario, "inputs": inputs, "policy": policy})
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"[:200]}
    return {
        "lpd": got.get("lpd"),
        "epd": got.get("epd") or got.get("dr"),
        "is_dr": bool(got.get("dr")) and not got.get("epd"),
        "remission": got.get("remission"),
        "flags": got.get("flags", []),
        "render": got.get("render"),
    }


def same_date(a: Optional[str], b: Optional[str]) -> Optional[bool]:
    """'27-06-1996' and '27-6-1996' are the same date. None when either side is missing."""
    if not a or not b:
        return None

    def parts(s: str) -> Optional[List[int]]:
        try:
            d, m, y = s.split("-")
            return [int(d.split("(")[0]), int(m), int(y)]
        except ValueError:
            return None

    pa, pb = parts(a), parts(b)
    return None if pa is None or pb is None else pa == pb


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    conn = _cfg().db()
    conn.row_factory = sqlite3.Row
    return conn


def list_reports() -> List[Dict[str, Any]]:
    with _cfg()._db_lock, _conn() as conn:
        rows = conn.execute(
            "SELECT f.*, s.status AS status, s.note AS status_note, s.updated_at AS status_at "
            "FROM feedback f LEFT JOIN report_status s ON s.feedback_id = f.id ORDER BY f.id DESC"
        ).fetchall()
    out = []
    for r in rows:
        inputs = json.loads(r["inputs_json"])
        policy = inputs.pop("policy", {}) or {}
        now = engine_now(r["scenario"], inputs, policy)
        agrees = None
        if now and "error" not in now:
            checks = [c for c in (same_date(now["lpd"], r["reviewer_lpd"]),
                                  same_date(now["epd"], r["reviewer_epd"])) if c is not None]
            agrees = all(checks) if checks else None
        out.append({
            "id": r["id"],
            "received_at": r["received_at"],
            "scenario": r["scenario"],
            "inputs": inputs,
            "policy": policy,
            "engine_version": r["engine_version"],
            "ruleset_version": r["ruleset_version"],
            "build_date": r["build_date"],
            "engine_lpd": r["engine_lpd"],
            "engine_epd": r["engine_epd"],
            "reviewer_lpd": r["reviewer_lpd"] or None,
            "reviewer_epd": r["reviewer_epd"] or None,
            "reviewer_token": r["reviewer_token"],
            "comment": r["comment"] or "",
            "status": r["status"] or "open",
            "status_note": r["status_note"] or "",
            "status_at": r["status_at"],
            "engine_now": now,
            "engine_now_agrees": agrees,
        })
    return out


def usage_summary(days: int, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or datetime.now(timezone.utc).date()
    first = today - timedelta(days=days - 1)
    lo, hi = first.isoformat(), today.isoformat()
    week = (today - timedelta(days=6)).isoformat()
    with _cfg()._db_lock, _conn() as conn:
        q = lambda sql, *a: conn.execute(sql, a).fetchall()  # noqa: E731
        one = lambda sql, *a: conn.execute(sql, a).fetchone()[0] or 0  # noqa: E731
        in_range = "day BETWEEN ? AND ?"
        daily = {r["day"]: r for r in q(
            f"SELECT day, COUNT(*) AS n, COUNT(DISTINCT device_id) AS devices FROM usage WHERE {in_range} GROUP BY day",
            lo, hi)}
        scenarios = q(f"SELECT scenario, COUNT(*) AS n FROM usage WHERE {in_range} GROUP BY scenario ORDER BY n DESC, scenario",
                      lo, hi)
        versions = q(
            f"SELECT engine_version, build_date, COUNT(*) AS n, COUNT(DISTINCT device_id) AS devices, MAX(at) AS last_at "
            f"FROM usage WHERE {in_range} GROUP BY engine_version, build_date ORDER BY build_date DESC, engine_version DESC",
            lo, hi)
        total = one(f"SELECT COUNT(*) FROM usage WHERE {in_range}", lo, hi)
        out = {
            "days": days,
            "from": lo,
            "to": hi,
            "total": total,
            "today": one("SELECT COUNT(*) FROM usage WHERE day = ?", hi),
            "last_7_days": one("SELECT COUNT(*) FROM usage WHERE day BETWEEN ? AND ?", week, hi),
            "all_time": one("SELECT COUNT(*) FROM usage"),
            "first_day": conn.execute("SELECT MIN(day) FROM usage").fetchone()[0],
            "devices": one(f"SELECT COUNT(DISTINCT device_id) FROM usage WHERE {in_range}", lo, hi),
            "devices_all_time": one("SELECT COUNT(DISTINCT device_id) FROM usage"),
            "installed": one(f"SELECT COUNT(*) FROM usage WHERE installed = 1 AND {in_range}", lo, hi),
            "offline": one(f"SELECT COUNT(*) FROM usage WHERE offline = 1 AND {in_range}", lo, hi),
            "failed": one(f"SELECT COUNT(*) FROM usage WHERE ok = 0 AND {in_range}", lo, hi),
            "reports_open": one(
                "SELECT COUNT(*) FROM feedback f LEFT JOIN report_status s ON s.feedback_id = f.id "
                "WHERE COALESCE(s.status, 'open') = 'open'"),
            "reports_total": one("SELECT COUNT(*) FROM feedback"),
        }
    out["daily"] = []
    for i in range(days):
        d = (first + timedelta(days=i)).isoformat()
        r = daily.get(d)
        out["daily"].append({"day": d, "n": r["n"] if r else 0, "devices": r["devices"] if r else 0})
    out["scenarios"] = [{"scenario": r["scenario"], "n": r["n"]} for r in scenarios]
    out["versions"] = [{"engine_version": r["engine_version"], "build_date": r["build_date"], "n": r["n"],
                        "devices": r["devices"], "last_at": r["last_at"]} for r in versions]
    return out


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

router = APIRouter()

PAGE_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
        "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    ),
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}
NO_STORE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _file(name: str, media: str) -> FileResponse:
    return FileResponse(UI_DIR / name, media_type=media, headers=PAGE_HEADERS)


@router.get("/admin")
@router.get("/admin/")
async def page() -> FileResponse:
    return _file("index.html", "text/html; charset=utf-8")


@router.get("/admin/admin.css")
async def page_css() -> FileResponse:
    return _file("admin.css", "text/css; charset=utf-8")


@router.get("/admin/admin.js")
async def page_js() -> FileResponse:
    return _file("admin.js", "text/javascript; charset=utf-8")


@router.get("/admin/api/session")
async def session(request: Request) -> JSONResponse:
    return JSONResponse(
        {"configured": stored_hash() is not None, "authenticated": session_ok(request.cookies.get(COOKIE))},
        headers=NO_STORE,
    )


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)


@router.post("/admin/api/login")
async def login(request: Request, body: Login) -> Response:
    same_origin(request)
    cfg = _cfg()
    ip = cfg.client_ip(request)
    stored = stored_hash()
    if stored is None:
        raise HTTPException(503, "no admin password has been set on the server")
    if login_locked(ip):
        raise HTTPException(429, "too many failed attempts; try again in an hour")
    ok = await asyncio.to_thread(verify_password, body.password, stored)
    if not ok:
        login_failed(ip)
        await asyncio.sleep(0.4)
        raise HTTPException(401, "wrong password")
    res = Response(status_code=204, headers=NO_STORE)
    res.set_cookie(
        COOKIE, new_session(), max_age=SESSION_SECONDS, path="/admin", httponly=True,
        samesite="strict", secure=not cfg.ORIGIN.startswith("http://"),
    )
    return res


@router.post("/admin/api/logout")
async def logout(request: Request) -> Response:
    same_origin(request)
    res = Response(status_code=204, headers=NO_STORE)
    res.delete_cookie(COOKIE, path="/admin")
    return res


@router.get("/admin/api/reports")
async def reports(request: Request) -> JSONResponse:
    require_session(request)
    rows = await asyncio.to_thread(list_reports)
    return JSONResponse({"reports": rows, "statuses": list(STATUSES), "engine_available": _run_case is not None},
                        headers=NO_STORE)


@router.get("/admin/api/reports/vectors")
async def reports_vectors(request: Request) -> JSONResponse:
    require_session(request)
    cfg = _cfg()
    with cfg._db_lock:
        cases = to_vectors.convert(cfg.DB_PATH)
    doc = {"format": 1, "generator": "api/to_vectors.py", "cases": cases}
    return JSONResponse(doc, headers={**NO_STORE, "Content-Disposition": 'attachment; filename="reviewer.json"'})


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    note: str = Field("", max_length=500)


@router.post("/admin/api/reports/{report_id}/status")
async def set_status(report_id: int, body: StatusChange, request: Request) -> JSONResponse:
    require_session(request)
    same_origin(request)
    if body.status not in STATUSES:
        raise HTTPException(422, "unknown status")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cfg = _cfg()
    with cfg._db_lock, _conn() as conn:
        if conn.execute("SELECT 1 FROM feedback WHERE id = ?", (report_id,)).fetchone() is None:
            raise HTTPException(404, "no such report")
        conn.execute(
            "INSERT INTO report_status (feedback_id, status, note, updated_at) VALUES (?,?,?,?) "
            "ON CONFLICT(feedback_id) DO UPDATE SET status = excluded.status, note = excluded.note, "
            "updated_at = excluded.updated_at",
            (report_id, body.status, body.note.strip(), now),
        )
    return JSONResponse({"id": report_id, "status": body.status, "status_note": body.note.strip(), "status_at": now},
                        headers=NO_STORE)


@router.get("/admin/api/usage")
async def usage(request: Request, days: int = 30) -> JSONResponse:
    require_session(request)
    if not 1 <= days <= 366:
        raise HTTPException(422, "days must be between 1 and 366")
    return JSONResponse(await asyncio.to_thread(usage_summary, days), headers=NO_STORE)


# --------------------------------------------------------------------------
# Command line: set the password
# --------------------------------------------------------------------------

def _cli(argv: List[str]) -> int:
    if argv[1:] != ["set-password"]:
        print("usage: python admin.py set-password   (the password is read from stdin)", file=sys.stderr)
        return 2
    password = sys.stdin.readline().rstrip("\r\n")
    try:
        path = write_hash(password)
    except ValueError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(f"admin password set; hash written to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv))
