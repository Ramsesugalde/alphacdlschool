"""Iteration 12: Gemini-fallback contract for chat_upload + chat_stream.

Verifies that when OpenAI GPT-5.4 is quota-exhausted, both endpoints
transparently fall back to gemini-3-flash-preview and return REAL Elena
content instead of the canned fallback strings.
"""
import os
import time
import struct
import zlib
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://elena-vee.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
AUTHORIZED_EMAIL = "bryanugalde290@gmail.com"

UPLOAD_FALLBACK = "Mmm mi amor, no me llegó bien tu foto… mándame otra 💋"
STREAM_FALLBACK = "Mi amor, algo interrumpió mi voz por un instante… ¿me lo dices otra vez? 💋"


def _make_png(w=4, h=4) -> bytes:
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def seeded():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-iter12-{int(time.time()*1000)}"
    token = f"test_session_iter12_{int(time.time()*1000)}"
    db.users.delete_many({"email": AUTHORIZED_EMAIL})
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
    db.media_jobs.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    mc.close()


def _headers(seeded):
    return {"Authorization": f"Bearer {seeded['token']}"}


def _set_provider(seeded, provider: str, model: str):
    """Directly set chat_provider/chat_model on user doc."""
    seeded["db"].users.update_one(
        {"user_id": seeded["user_id"]},
        {"$set": {"chat_provider": provider, "chat_model": model}},
    )


# ---------- chat_upload fallback ----------

def test_chat_upload_returns_real_elena_reaction(seeded):
    """POST /api/chat/upload with tiny PNG + empty caption should return REAL Elena
    reaction (Gemini fallback if OpenAI is quota-exhausted). Must NOT start with the
    canned upload-fallback string."""
    png = _make_png()
    files = {"file": ("tiny.png", png, "image/png")}
    data = {"caption": ""}
    r = requests.post(
        f"{BASE_URL}/api/chat/upload",
        headers=_headers(seeded),
        files=files,
        data=data,
        timeout=90,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
    body = r.json()
    assert "user_message" in body and "elena_message" in body
    elena_text = (body["elena_message"].get("text") or "").strip()
    print(f"[chat_upload] elena_text={elena_text!r}")
    assert not elena_text.startswith("Mmm mi amor, no me llegó bien tu foto"), (
        f"Both OpenAI AND Gemini fallbacks failed; got canned string: {elena_text!r}"
    )
    assert len(elena_text) >= 20, f"Reply too short to be a real Elena reaction: {elena_text!r}"


# ---------- chat_stream fallback (default = openai) ----------

def _consume_sse(resp) -> dict:
    """Parse SSE stream. Returns {'deltas': [...], 'done': dict|None, 'events': [...]}"""
    deltas = []
    done = None
    events = []
    current_event = None
    for raw in resp.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        line = raw
        if not line:
            current_event = None
            continue
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            payload = line.split(":", 1)[1].strip()
            events.append((current_event, payload))
            if current_event == "delta":
                try:
                    import json as _j
                    d = _j.loads(payload)
                    deltas.append(d.get("content", ""))
                except Exception:
                    pass
            elif current_event == "done":
                try:
                    import json as _j
                    done = _j.loads(payload)
                except Exception:
                    done = {"raw": payload}
    return {"deltas": deltas, "done": done, "events": events}


def test_chat_stream_default_openai_falls_back_to_gemini(seeded):
    """Default provider (openai/gpt-5.4) should transparently fall back to Gemini
    when quota-exhausted. Must NOT return the canned stream-fallback text."""
    # Ensure user is on default (unset provider -> defaults to openai/gpt-5.4)
    seeded["db"].users.update_one(
        {"user_id": seeded["user_id"]},
        {"$unset": {"chat_provider": "", "chat_model": ""}},
    )
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers=_headers(seeded),
        json={"text": "Hola Elena preciosa"},
        stream=True,
        timeout=120,
    )
    assert r.status_code == 200, f"status={r.status_code}"
    parsed = _consume_sse(r)
    full_text = "".join(parsed["deltas"]).strip()
    print(f"[chat_stream default] full_text={full_text!r}")
    print(f"[chat_stream default] events count={len(parsed['events'])}, deltas={len(parsed['deltas'])}")
    # At least one delta with content > 5 chars
    assert any(len(d) > 0 for d in parsed["deltas"]), "No delta events with content"
    assert len(full_text) > 5, f"Full streamed text too short: {full_text!r}"
    # event: done was emitted
    assert parsed["done"] is not None, "No event:done received"
    # Must not be canned fallback
    assert not full_text.startswith("Mi amor, algo interrumpió mi voz"), (
        f"Both OpenAI + Gemini failed; got canned fallback: {full_text!r}"
    )


def test_chat_stream_explicit_gemini_works_directly(seeded):
    """When user explicitly sets gemini-3-flash-preview, stream should return REAL
    content directly (no fallback needed)."""
    _set_provider(seeded, "gemini", "gemini-3-flash-preview")
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers=_headers(seeded),
        json={"text": "Hola Elena preciosa"},
        stream=True,
        timeout=120,
    )
    assert r.status_code == 200
    parsed = _consume_sse(r)
    full_text = "".join(parsed["deltas"]).strip()
    print(f"[chat_stream gemini] full_text={full_text!r}")
    assert parsed["done"] is not None
    assert len(full_text) > 5, f"Gemini direct stream returned nothing: {full_text!r}"
    assert not full_text.startswith("Mi amor, algo interrumpió mi voz"), (
        f"Gemini direct returned canned fallback: {full_text!r}"
    )


# ---------- Regression on other endpoints ----------

def test_chat_models_still_returns_four(seeded):
    r = requests.get(f"{BASE_URL}/api/chat/models", headers=_headers(seeded), timeout=15)
    assert r.status_code == 200
    body = r.json()
    models = body.get("models") if isinstance(body, dict) else body
    assert isinstance(models, list) and len(models) == 4, f"expected 4 models, got {body}"


def test_whatsapp_config_returns_missing_key(seeded):
    r = requests.get(f"{BASE_URL}/api/whatsapp/config", headers=_headers(seeded), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "missing" in body, f"expected 'missing' key, got {body}"


def test_media_ensure_ambient_200(seeded):
    r = requests.post(f"{BASE_URL}/api/media/ensure-ambient", headers=_headers(seeded), timeout=30)
    assert r.status_code == 200
