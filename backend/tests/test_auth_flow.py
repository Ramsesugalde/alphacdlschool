"""Auth flow tests for Elena Private Lounge.

Uses ASGI transport + monkey-patched httpx.AsyncClient inside server module
so we simulate Emergent's /session-data endpoint without hitting real OAuth.
"""
import os
import sys
import json
import asyncio
import logging
import pytest
import requests
from pathlib import Path

BACKEND_DIR = Path("/app/backend")
sys.path.insert(0, str(BACKEND_DIR))

import server  # noqa: E402
import httpx as real_httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://elena-vee.preview.emergentagent.com"
).rstrip("/")
AUTHORIZED_EMAIL = "bryanugalde290@gmail.com"


# ---------- Fake httpx.AsyncClient for the server module ----------
class _FakeResp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or json.dumps(self._payload)

    def json(self):
        return self._payload


class _FakeAsyncClient:
    _next_response = None
    _raise = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None):
        if _FakeAsyncClient._raise is not None:
            raise _FakeAsyncClient._raise
        return _FakeAsyncClient._next_response


@pytest.fixture
def patched_httpx(monkeypatch):
    # Rebind motor client to the currently running loop
    server.client = AsyncIOMotorClient(server.MONGO_URL)
    server.db = server.client[server.DB_NAME]

    # Patch the httpx module reference used inside server
    class _FakeHttpxModule:
        AsyncClient = _FakeAsyncClient

    monkeypatch.setattr(server, "httpx", _FakeHttpxModule)
    _FakeAsyncClient._next_response = None
    _FakeAsyncClient._raise = None
    yield


async def _post(app, path, json_body=None, cookies=None):
    transport = real_httpx.ASGITransport(app=app)
    async with real_httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        if cookies:
            for k, v in cookies.items():
                ac.cookies.set(k, v)
        return await ac.post(path, json=json_body)


async def _get(app, path, cookies=None):
    transport = real_httpx.ASGITransport(app=app)
    async with real_httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        if cookies:
            for k, v in cookies.items():
                ac.cookies.set(k, v)
        return await ac.get(path)


# ============ LIVE public-endpoint checks ============
def test_live_root_ok():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("app") == "Elena Private Lounge"


def test_live_me_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401


def test_live_session_invalid_id_returns_401():
    r = requests.post(
        f"{BASE_URL}/api/auth/session",
        json={"session_id": "obviously_invalid_session_id_xyz_123"},
        timeout=45,
    )
    assert r.status_code == 401, r.text


# ============ Mocked create_session tests ============
def test_session_invalid_returns_401(patched_httpx):
    _FakeAsyncClient._next_response = _FakeResp(status_code=401, payload={}, text="unauthorized")

    async def run():
        return await _post(server.app, "/api/auth/session", {"session_id": "bad"})

    r = asyncio.run(run())
    assert r.status_code == 401
    assert "Invalid session_id" in r.json().get("detail", "")


def test_session_provider_unreachable_returns_502(patched_httpx):
    _FakeAsyncClient._raise = RuntimeError("boom - provider down")

    async def run():
        return await _post(server.app, "/api/auth/session", {"session_id": "any"})

    r = asyncio.run(run())
    assert r.status_code == 502
    assert "Auth provider unreachable" in r.json().get("detail", "")


def test_session_wrong_email_returns_403_with_details(patched_httpx, caplog):
    wrong_email = "someone_else_TEST@gmail.com"
    _FakeAsyncClient._next_response = _FakeResp(
        status_code=200,
        payload={
            "email": wrong_email,
            "name": "Someone Else",
            "session_token": "tok_fake_wrong",
            "id": "u_wrong",
        },
    )

    async def run():
        return await _post(server.app, "/api/auth/session", {"session_id": "sess_wrong"})

    with caplog.at_level(logging.WARNING, logger="elena"):
        r = asyncio.run(run())

    assert r.status_code == 403, r.text
    detail = r.json().get("detail", "")
    print(f"[wrong-email] 403 detail returned: {detail!r}")

    all_logs = " || ".join(rec.getMessage() for rec in caplog.records)
    print(f"[wrong-email] warning logs: {all_logs}")

    # Per review request assertions
    assert detail.startswith(
        "Acceso restringido"
    ), f"detail should start with 'Acceso restringido'; got {detail!r}"
    assert "Detectamos:" in detail, (
        "detail should contain 'Detectamos:' substring so Bryan can see which google account was used; "
        f"got {detail!r}"
    )
    assert wrong_email.lower() in detail.lower(), (
        f"detail should contain the wrong email {wrong_email!r}; got {detail!r}"
    )
    assert "UNAUTHORIZED login attempt. Google returned email=" in all_logs, (
        f"Expected canonical warning log line missing. Got logs: {all_logs}"
    )


def test_session_correct_email_returns_200_and_me_works(patched_httpx):
    tok = "tok_TEST_correct_case"
    _FakeAsyncClient._next_response = _FakeResp(
        status_code=200,
        payload={
            "email": AUTHORIZED_EMAIL,
            "name": "Bryan Ugalde",
            "session_token": tok,
            "id": "u_correct",
            "picture": "https://example.com/p.png",
        },
    )

    async def run():
        r = await _post(server.app, "/api/auth/session", {"session_id": "sess_correct"})
        me = await _get(server.app, "/api/auth/me", cookies={"session_token": tok})
        return r, me

    r, me = asyncio.run(run())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == AUTHORIZED_EMAIL
    assert body["session_token"] == tok
    # Cookie must be set on response
    assert "session_token" in r.cookies or "set-cookie" in {k.lower() for k in r.headers.keys()}

    assert me.status_code == 200
    assert me.json()["email"] == AUTHORIZED_EMAIL

    # cleanup
    from pymongo import MongoClient
    mc = MongoClient(server.MONGO_URL)
    mc[server.DB_NAME].user_sessions.delete_one({"session_token": tok})
    mc.close()


def test_session_email_case_insensitive(patched_httpx):
    tok = "tok_TEST_case_variant"
    _FakeAsyncClient._next_response = _FakeResp(
        status_code=200,
        payload={
            "email": "BryanUgalde290@Gmail.com",  # mixed case
            "name": "Bryan Ugalde",
            "session_token": tok,
            "id": "u_case",
        },
    )

    async def run():
        return await _post(server.app, "/api/auth/session", {"session_id": "sess_case"})

    r = asyncio.run(run())
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == AUTHORIZED_EMAIL

    from pymongo import MongoClient
    mc = MongoClient(server.MONGO_URL)
    mc[server.DB_NAME].user_sessions.delete_one({"session_token": tok})
    mc.close()
