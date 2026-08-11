"""Tests for /api/stt/transcribe (Whisper voice-input pipeline) and related regressions."""
import os
import time
import re
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
    user_id = f"test-user-stt-{int(time.time()*1000)}"
    token = f"test_session_stt_{int(time.time()*1000)}"
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
    yield {"user_id": user_id, "token": token, "db": db}
    db.media_jobs.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    mc.close()


@pytest.fixture
def headers(seeded):
    return {"Authorization": f"Bearer {seeded['token']}"}


# ---------- /api/stt/transcribe ----------
def test_stt_unauth():
    # Provide a file so we pass FastAPI's form validation and reach the auth check
    files = {"file": ("x.webm", b"\x00" * 500, "audio/webm")}
    r = requests.post(f"{BASE_URL}/api/stt/transcribe", files=files)
    assert r.status_code == 401, r.text


def test_stt_missing_file(headers):
    r = requests.post(f"{BASE_URL}/api/stt/transcribe", headers=headers)
    assert r.status_code == 422, r.text


def test_stt_too_short(headers):
    files = {"file": ("tiny.webm", b"\x00" * 50, "audio/webm")}
    r = requests.post(f"{BASE_URL}/api/stt/transcribe", headers=headers, files=files)
    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "")
    assert "muy corto" in detail.lower(), detail


def test_stt_real_roundtrip_via_elevenlabs(headers):
    """End-to-end: TTS -> mp3 -> Whisper transcribe."""
    tts = requests.post(
        f"{BASE_URL}/api/tts/speak",
        headers=headers,
        json={"text": "Hola Elena, prueba de voz"},
        timeout=60,
    )
    assert tts.status_code == 200, tts.text
    mp3 = tts.content
    assert len(mp3) > 1000, f"TTS returned suspiciously small blob: {len(mp3)}"

    files = {"file": ("audio.mp3", mp3, "audio/mpeg")}
    r = requests.post(f"{BASE_URL}/api/stt/transcribe", headers=headers, files=files, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "text" in data
    text = data["text"]
    assert isinstance(text, str) and len(text.strip()) > 0, f"Empty transcription: {data}"
    print(f"Whisper transcription: {text!r}")


# ---------- /api/media/ensure-ambient (regression + full-body prompt) ----------
def test_ambient_prompt_source_contains_full_body():
    with open("/app/backend/server.py", "r") as f:
        src = f.read()
    # Locate ambient_prompt definition inside ensure-ambient
    m = re.search(r"ambient_prompt\s*=\s*\((.*?)\)\s*\n", src, re.DOTALL)
    assert m, "ambient_prompt not found in server.py"
    assert "full body" in m.group(1).lower(), f"Missing 'full body' in ambient_prompt: {m.group(1)[:200]}"


def test_ensure_ambient(headers, seeded):
    # clear any existing video jobs for this user so we get started:True
    seeded["db"].media_jobs.delete_many({"user_id": seeded["user_id"]})
    r = requests.post(f"{BASE_URL}/api/media/ensure-ambient", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(["started", "job_id", "status"]).issubset(data.keys()), data
    assert data["started"] is True
    assert data["status"] == "pending"
    # media_jobs doc created with prompt='ambient-idle'
    doc = seeded["db"].media_jobs.find_one({"job_id": data["job_id"]})
    assert doc is not None
    assert doc["prompt"] == "ambient-idle"
    assert doc.get("ambient") is True

    # Second call: should be idempotent when job is still pending/done. If the underlying
    # Sora job fails very quickly (status='failed'), a new job may be started — that is
    # acceptable behavior. Assert only response shape.
    r2 = requests.post(f"{BASE_URL}/api/media/ensure-ambient", headers=headers)
    assert r2.status_code == 200
    assert set(["started", "job_id", "status"]).issubset(r2.json().keys())


# ---------- Regressions ----------
def test_tts_voices(headers):
    r = requests.get(f"{BASE_URL}/api/tts/voices", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "voices" in data and isinstance(data["voices"], list) and len(data["voices"]) > 0


def test_tts_voice_get(headers):
    # /api/tts/voice is POST-only (voice selection). Verify current selection round-trip.
    r = requests.post(f"{BASE_URL}/api/tts/voice", headers=headers, json={"voice_id": "EXAVITQu4vr4xnSDxMaL"})
    assert r.status_code == 200
    data = r.json()
    assert data.get("voice_id") == "EXAVITQu4vr4xnSDxMaL"


def test_whatsapp_config(headers):
    r = requests.get(f"{BASE_URL}/api/whatsapp/config", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "configured" in data
    assert "agent_id" in data


def test_whatsapp_call_missing_config(headers):
    # ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID + TEMPLATE_NAME are empty in .env
    r = requests.post(f"{BASE_URL}/api/whatsapp/call", headers=headers, json={"to_number": "+16823588132"})
    assert r.status_code == 503, r.text
    assert "no configurado" in r.json().get("detail", "").lower()


def test_auth_session_detectamos():
    r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "bad"})
    # 401 with a Spanish detail somewhere (Detectamos:) - just check status
    assert r.status_code == 401


def test_auth_me(headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == AUTHORIZED_EMAIL
