"""Sign-in for operators and supervisors.

Accounts come from the SAFE_TWIN_USERS environment variable ("username:role:password", comma separated).
The built-in defaults are demo accounts: change them before the app is reachable by anyone else.
A sign-in returns a signed token; every sign-in and sign-out is written to the shift log.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

from fastapi import Header, HTTPException

from . import config

ROLES = ("operator", "supervisor")
TOKEN_HOURS = 12


def _users() -> dict[str, dict]:
    users = {}
    for item in config.USERS.split(","):
        parts = item.strip().split(":", 2)
        if len(parts) == 3 and parts[1] in ROLES:
            users[parts[0]] = {"username": parts[0], "role": parts[1], "password": parts[2]}
    return users


def _sign(body: str) -> str:
    return hmac.new(config.AUTH_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()


def check_password(username: str, password: str) -> dict | None:
    user = _users().get(username.strip())
    # Compare against a dummy value for unknown users so timing does not reveal which names exist.
    expected = user["password"] if user else uuid.uuid4().hex
    ok = hmac.compare_digest(expected.encode(), password.encode())
    return {"username": user["username"], "role": user["role"]} if user and ok else None


def issue_token(user: dict) -> tuple[str, str]:
    session_id = str(uuid.uuid4())
    payload = {"u": user["username"], "r": user["role"], "sid": session_id, "exp": int(time.time()) + TOKEN_HOURS * 3600}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    return f"{body}.{_sign(body)}", session_id


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body.encode()))
        if payload["exp"] < time.time():
            return None
        return {"username": payload["u"], "role": payload["r"], "session_id": payload["sid"]}
    except Exception:  # noqa: BLE001 - any malformed token is simply not valid
        return None


def current_user(authorization: str | None = Header(default=None)) -> dict:
    token = (authorization or "").removeprefix("Bearer ").strip()
    user = read_token(token) if token else None
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


def supervisor_only(authorization: str | None = Header(default=None)) -> dict:
    user = current_user(authorization)
    if user["role"] != "supervisor":
        raise HTTPException(403, "This page is for supervisors.")
    return user
