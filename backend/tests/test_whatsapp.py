"""Backend tests for ElevenLabs Convai WhatsApp outbound call endpoints.

Tests /api/whatsapp/config and /api/whatsapp/call.
Uses BASE_URL for HTTP-level tests (auth, not-configured 503).
Uses in-process ASGI TestClient + monkeypatch for the fully-configured
scenario so we never fire a real request to the ElevenLabs Convai API.
"""
import os
import sys
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

# Load backend .env so MONGO_URL/DB_NAME/etc are available for in-process import
from dotenv import load_dotenv
load_dotenv(Path("/app/backend/.env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
AUTHORIZED_EMAIL = "bryanugalde290@gmail.com"

sys.path.insert(0, "/app/backend")


@pytest.fixture(scope="module")
def seeded_session():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-wa-{int(time.time()*1000)}"
    token = f"test_session_wa_{int(time.time()*1000)}"
    db.users.insert_one({
        "user_id": user_id, "email": AUTHORIZED_EMAIL,
        "name": "Bryan Ugalde", "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield {"user_id": user_id, "token": token}
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    mc.close()


@pytest.fixture
def auth_headers(seeded_session):
    return {"Authorization": f"Bearer {seeded_session['token']}"}


# ---------- /api/whatsapp/config ----------
def test_wa_config_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/whatsapp/config")
    assert r.status_code == 401


def test_wa_config_authenticated_reports_missing(auth_headers):
    r = requests.get(f"{BASE_URL}/api/whatsapp/config", headers=auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["configured"] is False
    assert isinstance(data["missing"], list)
    # PHONE_NUMBER_ID + TEMPLATE_NAME intentionally empty
    assert "ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID" in data["missing"]
    assert "ELEVENLABS_WHATSAPP_TEMPLATE_NAME" in data["missing"]
    assert data["agent_id"] == "agent_8301ka4g11aceyrs4fyk6xpypege"
    assert data["template_lang"] == "es_MX"


# ---------- /api/whatsapp/call (HTTP against deployed backend) ----------
def test_wa_call_unauthenticated():
    r = requests.post(f"{BASE_URL}/api/whatsapp/call", json={})
    assert r.status_code == 401


def test_wa_call_authenticated_but_missing_config(auth_headers):
    r = requests.post(f"{BASE_URL}/api/whatsapp/call", headers=auth_headers, json={})
    assert r.status_code == 503, r.text
    detail = r.json().get("detail", "")
    assert "WhatsApp outbound no configurado. Falta:" in detail
    assert "ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID" in detail
    assert "ELEVENLABS_WHATSAPP_TEMPLATE_NAME" in detail


# ---------- In-process fully-configured simulation ----------
@pytest.fixture
def in_process_client(seeded_session, monkeypatch):
    """Import server module fresh with fully-populated WA env, return TestClient."""
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_AGENT_ID", "agent_8301ka4g11aceyrs4fyk6xpypege")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID", "phone_test_123")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_TEMPLATE_NAME", "elena_call_permission")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_TEMPLATE_LANG", "es_MX")
    monkeypatch.setenv("BRYAN_WHATSAPP_USER_ID", "+16823588132")

    # Force reload the server module so module-level constants pick up new env
    import importlib
    if "server" in sys.modules:
        del sys.modules["server"]
    import server as srv  # noqa: E402
    importlib.reload(srv)

    from fastapi.testclient import TestClient
    return srv, TestClient(srv.app)


class _FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data or {"conversation_id": "conv_mocked_abc123", "success": True}
        self.content = b'{"conversation_id":"conv_mocked_abc123","success":true}'
        self.text = '{"conversation_id":"conv_mocked_abc123","success":true}'

    @property
    def is_error(self):
        return self.status_code >= 400

    def json(self):
        return self._json


class _FakeAsyncClient:
    """Records the last POST call for assertion."""
    last_call = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeAsyncClient.last_call = {"url": url, "json": json, "headers": headers}
        return _FakeResponse()


def test_wa_call_configured_fires_upstream_and_returns_response(in_process_client, seeded_session, monkeypatch):
    srv, client = in_process_client
    monkeypatch.setattr(srv.httpx, "AsyncClient", _FakeAsyncClient)

    r = client.post(
        "/api/whatsapp/call",
        json={"to_number": "+16823588132"},
        headers={"Authorization": f"Bearer {seeded_session['token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"conversation_id": "conv_mocked_abc123", "success": True}

    call = _FakeAsyncClient.last_call
    assert call["url"] == "https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call"
    assert call["headers"]["xi-api-key"] == srv.ELEVENLABS_API_KEY
    body = call["json"]
    assert body["whatsapp_phone_number_id"] == "phone_test_123"
    assert body["whatsapp_user_id"] == "+16823588132"
    assert body["whatsapp_call_permission_request_template_name"] == "elena_call_permission"
    assert body["whatsapp_call_permission_request_template_language_code"] == "es_MX"
    assert body["agent_id"] == "agent_8301ka4g11aceyrs4fyk6xpypege"
    cid = body["conversation_initiation_client_data"]
    assert "agent" in cid["conversation_config_override"]
    assert cid["conversation_config_override"]["agent"]["first_message"]
    assert "voice_id" in cid["conversation_config_override"]["tts"]


def test_wa_call_configured_defaults_to_bryan_when_to_number_omitted(in_process_client, seeded_session, monkeypatch):
    srv, client = in_process_client
    monkeypatch.setattr(srv.httpx, "AsyncClient", _FakeAsyncClient)

    r = client.post(
        "/api/whatsapp/call",
        json={},
        headers={"Authorization": f"Bearer {seeded_session['token']}"},
    )
    assert r.status_code == 200, r.text
    assert _FakeAsyncClient.last_call["json"]["whatsapp_user_id"] == "+16823588132"


def test_wa_call_configured_but_no_to_number_and_no_bryan(seeded_session, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_AGENT_ID", "agent_x")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID", "phone_test_123")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_TEMPLATE_NAME", "tmpl")
    monkeypatch.setenv("ELEVENLABS_WHATSAPP_TEMPLATE_LANG", "es_MX")
    monkeypatch.setenv("BRYAN_WHATSAPP_USER_ID", "")

    import importlib
    if "server" in sys.modules:
        del sys.modules["server"]
    import server as srv  # noqa: E402
    importlib.reload(srv)
    from fastapi.testclient import TestClient
    client = TestClient(srv.app)

    r = client.post(
        "/api/whatsapp/call",
        json={"to_number": ""},
        headers={"Authorization": f"Bearer {seeded_session['token']}"},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "Falta el número de WhatsApp de destino."
