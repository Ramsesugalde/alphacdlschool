"""Tests for Voice Personality + Ambient Loop features (iteration 6)."""
import os
import time
import subprocess
import json
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://elena-vee.preview.emergentagent.com').rstrip('/')

# ------------------------------------------------------------------
# Seed a test session (mongosh helper)
# ------------------------------------------------------------------
def _seed_session():
    ts = int(time.time() * 1000)
    user_id = f"test-user-voice-{ts}"
    token = f"test_session_voice_{ts}"
    js = f"""
    db = db.getSiblingDB('test_database');
    db.users.insertOne({{ user_id: '{user_id}', email: 'bryanugalde290@gmail.com', name: 'Bryan Ugalde', picture: '', created_at: new Date().toISOString() }});
    db.user_sessions.insertOne({{ user_id: '{user_id}', session_token: '{token}', expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString(), created_at: new Date().toISOString() }});
    """
    subprocess.run(['mongosh', '--quiet', '--eval', js], check=True, capture_output=True)
    return user_id, token


def _cleanup(user_id):
    js = f"""
    db = db.getSiblingDB('test_database');
    db.users.deleteMany({{ user_id: '{user_id}' }});
    db.user_sessions.deleteMany({{ user_id: '{user_id}' }});
    db.media_jobs.deleteMany({{ user_id: '{user_id}' }});
    """
    subprocess.run(['mongosh', '--quiet', '--eval', js], capture_output=True)


@pytest.fixture(scope="module")
def session():
    user_id, token = _seed_session()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    s.user_id = user_id
    s.token = token
    yield s
    _cleanup(user_id)


# ------------------------------------------------------------------
# GET /api/tts/voices
# ------------------------------------------------------------------
def test_voices_list_returns_five(session):
    r = session.get(f"{BASE_URL}/api/tts/voices")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "voices" in data and "current" in data
    assert len(data["voices"]) == 5
    for v in data["voices"]:
        for k in ("voice_id", "name", "vibe", "description"):
            assert k in v and isinstance(v[k], str)
    assert isinstance(data["current"], str)


# POST /api/tts/voice — persists selection
def test_set_voice_persists(session):
    r = session.post(f"{BASE_URL}/api/tts/voice", json={"voice_id": "XrExE9yKIg1WjnnlVkGX"})
    assert r.status_code == 200, r.text
    assert r.json()["voice_id"] == "XrExE9yKIg1WjnnlVkGX"

    r2 = session.get(f"{BASE_URL}/api/tts/voices")
    assert r2.status_code == 200
    assert r2.json()["current"] == "XrExE9yKIg1WjnnlVkGX"


def test_set_voice_unknown_400(session):
    r = session.post(f"{BASE_URL}/api/tts/voice", json={"voice_id": "not-a-real-voice"})
    assert r.status_code == 400
    assert r.json().get("detail") == "Voz no disponible."


def test_set_voice_unauth_401():
    r = requests.post(f"{BASE_URL}/api/tts/voice", json={"voice_id": "XrExE9yKIg1WjnnlVkGX"})
    assert r.status_code == 401


# POST /api/tts/speak uses persisted voice when not in body
def test_speak_uses_persisted_voice(session):
    # set Matilda
    session.post(f"{BASE_URL}/api/tts/voice", json={"voice_id": "XrExE9yKIg1WjnnlVkGX"})
    r = session.post(f"{BASE_URL}/api/tts/speak", json={"text": "Hola"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    assert r.headers.get("content-type", "").startswith("audio/mpeg")
    assert len(r.content) > 500


# ------------------------------------------------------------------
# POST /api/media/ensure-ambient
# ------------------------------------------------------------------
def test_ensure_ambient_first_call_starts(session):
    # Ensure no prior job for this user
    subprocess.run(['mongosh', '--quiet', '--eval',
                    f"db=db.getSiblingDB('test_database');db.media_jobs.deleteMany({{user_id:'{session.user_id}'}});"],
                   capture_output=True)
    r = session.post(f"{BASE_URL}/api/media/ensure-ambient")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["started"] is True
    assert isinstance(data["job_id"], str) and len(data["job_id"]) > 0
    assert data["status"] == "pending"
    session.first_job_id = data["job_id"]

    # Verify DB doc
    out = subprocess.run(
        ['mongosh', '--quiet', '--eval',
         f"db=db.getSiblingDB('test_database');printjson(db.media_jobs.findOne({{job_id:'{data['job_id']}'}}, {{_id:0,kind:1,prompt:1,ambient:1}}));"],
        capture_output=True, text=True)
    assert "'video'" in out.stdout or '"video"' in out.stdout
    assert "ambient-idle" in out.stdout
    assert "true" in out.stdout.lower()


def test_ensure_ambient_second_call_idempotent(session):
    r = session.post(f"{BASE_URL}/api/media/ensure-ambient")
    assert r.status_code == 200
    data = r.json()
    assert data["started"] is False
    assert data["job_id"] == getattr(session, "first_job_id", data["job_id"])
    assert data["status"] in ("pending", "done")


def test_ensure_ambient_with_seeded_done_returns_started_false(session):
    # Wipe pending, seed a done doc
    js = f"""
    db=db.getSiblingDB('test_database');
    db.media_jobs.deleteMany({{user_id:'{session.user_id}'}});
    db.media_jobs.insertOne({{job_id:'seededdone01', user_id:'{session.user_id}', kind:'video', status:'done', prompt:'ambient-idle', ambient:true, created_at: new Date().toISOString(), file_url:'/api/media/file/nope.mp4'}});
    """
    subprocess.run(['mongosh', '--quiet', '--eval', js], capture_output=True)
    r = session.post(f"{BASE_URL}/api/media/ensure-ambient")
    assert r.status_code == 200
    data = r.json()
    assert data["started"] is False
    assert data["job_id"] == "seededdone01"
    assert data["status"] == "done"


def test_ensure_ambient_unauth_401():
    r = requests.post(f"{BASE_URL}/api/media/ensure-ambient")
    assert r.status_code == 401
