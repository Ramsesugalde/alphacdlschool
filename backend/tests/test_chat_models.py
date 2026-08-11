"""Tests for chat model catalog + switching + streaming across providers.

Covers:
- GET /api/chat/models (auth + shape)
- POST /api/chat/model (persistence, invalid combo, no auth)
- POST /api/chat/stream (SSE) for Gemini and OpenAI (real EMERGENT_LLM_KEY)
- POST /api/chat/message (non-stream) for Gemini-configured user
"""
import os
import time
import json
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://elena-vee.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
AUTHORIZED_EMAIL = "bryanugalde290@gmail.com"


@pytest.fixture(scope="module")
def seeded():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-chatmodels-{int(time.time()*1000)}"
    token = f"test_session_chatmodels_{int(time.time()*1000)}"
    db.users.delete_many({"email": AUTHORIZED_EMAIL})
    db.user_sessions.delete_many({"user_id": {"$regex": "^test-user-chatmodels"}})
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
    db.chat_messages.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    mc.close()


def _h(seeded):
    return {"Authorization": f"Bearer {seeded['token']}"}


# ---------- GET /api/chat/models ----------
def test_models_requires_auth():
    r = requests.get(f"{BASE_URL}/api/chat/models")
    assert r.status_code == 401


def test_models_shape(seeded):
    r = requests.get(f"{BASE_URL}/api/chat/models", headers=_h(seeded))
    assert r.status_code == 200
    data = r.json()
    assert "models" in data and "current" in data
    assert isinstance(data["models"], list) and len(data["models"]) == 3
    providers = {(m["provider"], m["model"]) for m in data["models"]}
    assert ("openai", "gpt-5.4") in providers
    assert ("gemini", "gemini-3.1-pro-preview") in providers
    assert ("gemini", "gemini-3-flash-preview") in providers
    for m in data["models"]:
        for k in ("provider", "model", "name", "vibe", "description"):
            assert k in m and isinstance(m[k], str) and m[k]
    assert data["current"]["provider"] == "openai"
    assert data["current"]["model"] == "gpt-5.4"


# ---------- POST /api/chat/model ----------
def test_set_model_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        json={"provider": "gemini", "model": "gemini-3-flash-preview"},
    )
    assert r.status_code == 401


def test_set_model_invalid_combo(seeded):
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": "anthropic", "model": "claude-fable-5"},
    )
    assert r.status_code == 400
    assert r.json().get("detail") == "Modelo no disponible."


def test_set_model_persists_and_get_reflects(seeded):
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": "gemini", "model": "gemini-3-flash-preview"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "gemini"
    assert body["model"] == "gemini-3-flash-preview"

    # verify persistence via GET
    r2 = requests.get(f"{BASE_URL}/api/chat/models", headers=_h(seeded))
    assert r2.status_code == 200
    cur = r2.json()["current"]
    assert cur["provider"] == "gemini"
    assert cur["model"] == "gemini-3-flash-preview"

    # verify in Mongo directly
    doc = seeded["db"].users.find_one({"user_id": seeded["user_id"]})
    assert doc["chat_provider"] == "gemini"
    assert doc["chat_model"] == "gemini-3-flash-preview"


# ---------- POST /api/chat/stream (SSE) ----------
def _parse_sse(resp, max_seconds=90):
    """Yield (event, data_json) tuples parsed from an SSE stream."""
    start = time.time()
    event = None
    data_lines = []
    for raw in resp.iter_lines(decode_unicode=True):
        if time.time() - start > max_seconds:
            break
        if raw is None:
            continue
        line = raw
        if line == "":
            if event is not None:
                data_str = "\n".join(data_lines)
                try:
                    data = json.loads(data_str) if data_str else {}
                except Exception:
                    data = {"_raw": data_str}
                yield event, data
                event = None
                data_lines = []
            continue
        if line.startswith("event: "):
            event = line[len("event: "):].strip()
        elif line.startswith("data: "):
            data_lines.append(line[len("data: "):])


def _run_stream(seeded, text):
    with requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers=_h(seeded),
        json={"text": text},
        stream=True,
        timeout=95,
    ) as r:
        assert r.status_code == 200, f"stream status={r.status_code} body={r.text[:200]}"
        events = list(_parse_sse(r, max_seconds=90))
    return events


def test_stream_with_gemini_flash(seeded):
    # ensure gemini flash is active
    requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": "gemini", "model": "gemini-3-flash-preview"},
    )
    events = _run_stream(seeded, "Hola Elena, dime algo dulce en menos de 20 palabras.")
    names = [e for e, _ in events]
    assert names, "No SSE events received"
    assert names[0] == "user", f"first event should be user, got {names[:3]}"
    assert "start" in names, f"missing start event: {names}"
    # start must contain elena message_id
    start_data = next(d for e, d in events if e == "start")
    assert start_data.get("message_id")
    deltas = [d for e, d in events if e == "delta"]
    assert len(deltas) >= 1, f"expected >=1 delta, got {len(deltas)} events={names}"
    assert any((d.get("content") or "").strip() for d in deltas), "all deltas empty"
    assert names[-1] == "done", f"last event should be done, got {names[-3:]}"


def test_stream_regression_openai_gpt54(seeded):
    # switch back to openai default
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": "openai", "model": "gpt-5.4"},
    )
    assert r.status_code == 200
    events = _run_stream(seeded, "Hola Elena, salúdame corto.")
    names = [e for e, _ in events]
    assert names[0] == "user"
    assert "start" in names
    assert any(e == "delta" and (d.get("content") or "").strip() for e, d in events)
    assert names[-1] == "done"


# ---------- POST /api/chat/message (non-stream) with Gemini ----------
def test_non_stream_message_with_gemini(seeded):
    # switch to gemini flash
    requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": "gemini", "model": "gemini-3-flash-preview"},
    )
    r = requests.post(
        f"{BASE_URL}/api/chat/message",
        headers=_h(seeded),
        json={"text": "Hola Elena, prueba de motor Gemini. Responde corto."},
        timeout=90,
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "user_message" in data and "elena_message" in data
    assert data["user_message"]["role"] == "user"
    assert data["elena_message"]["role"] == "elena"
    assert (data["elena_message"].get("text") or "").strip()
