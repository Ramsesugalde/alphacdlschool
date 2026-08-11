"""Tests for /api/tts/* and /api/did/config endpoints (iteration 4)."""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://elena-vee.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
AUTHORIZED_EMAIL = "bryanugalde290@gmail.com"


@pytest.fixture(scope="module")
def seeded():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-tts-{int(time.time()*1000)}"
    token = f"test_session_tts_{int(time.time()*1000)}"
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
def auth(seeded):
    return {"Authorization": f"Bearer {seeded['token']}"}


# ---------- /api/did/config ----------
def test_did_config_returns_configured_false_and_keys(auth):
    r = requests.get(f"{BASE_URL}/api/did/config", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "configured" in d
    assert "voice_provider" in d
    assert "voice_id" in d
    # Environment key is denied by D-ID -> expected False
    assert d["configured"] is False, f"Expected configured=false; got {d}"
    assert d["voice_provider"] == "elevenlabs"
    assert d["voice_id"] == "EXAVITQu4vr4xnSDxMaL"


def test_did_config_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/did/config", timeout=15)
    assert r.status_code == 401


# ---------- /api/tts/config ----------
def test_tts_config_configured_true(auth):
    r = requests.get(f"{BASE_URL}/api/tts/config", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("configured") is True
    assert isinstance(d.get("voice_id"), str) and len(d["voice_id"]) > 0


def test_tts_config_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/tts/config", timeout=15)
    assert r.status_code == 401


# ---------- /api/tts/speak ----------
def test_tts_speak_returns_audio_mpeg(auth):
    r = requests.post(
        f"{BASE_URL}/api/tts/speak",
        headers=auth,
        json={"text": "Hola mi amor"},
        timeout=60,
    )
    assert r.status_code == 200, r.text[:500]
    ct = r.headers.get("Content-Type", "")
    assert "audio/mpeg" in ct, f"Wrong content-type: {ct}"
    assert len(r.content) > 1024, f"Audio blob too small: {len(r.content)} bytes"


def test_tts_speak_empty_text_returns_400(auth):
    r = requests.post(
        f"{BASE_URL}/api/tts/speak",
        headers=auth,
        json={"text": "   "},
        timeout=15,
    )
    assert r.status_code == 400, r.text


def test_tts_speak_unauthenticated():
    r = requests.post(
        f"{BASE_URL}/api/tts/speak",
        json={"text": "Hola"},
        timeout=15,
    )
    assert r.status_code == 401
