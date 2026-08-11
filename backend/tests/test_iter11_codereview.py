"""Iteration 11: Code-review fixes regression + focused tests.

Focus:
- storage_serve return-inside-try (200 valid, 401 no auth, 404 unknown path)
- /api/chat/upload real Elena reaction (post OpenAI credit recharge)
- Basic regression on core endpoints
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

FALLBACK_PREFIX = "Mmm mi amor, no me llegó bien tu foto"


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
    user_id = f"test-user-iter11-{int(time.time()*1000)}"
    token = f"test_session_iter11_{int(time.time()*1000)}"
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


def _h(seeded):
    return {"Authorization": f"Bearer {seeded['token']}"}


# ---------- Regression: basic endpoints ----------
def test_root_ok():
    r = requests.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    assert r.json().get("app") == "Elena Private Lounge"


def test_auth_me(seeded):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(seeded))
    assert r.status_code == 200
    assert r.json()["email"] == AUTHORIZED_EMAIL


def test_chat_models_4_incl_auto(seeded):
    r = requests.get(f"{BASE_URL}/api/chat/models", headers=_h(seeded))
    assert r.status_code == 200
    models = r.json()["models"]
    assert len(models) == 4
    assert any(m["provider"] == "auto" and m["model"] == "auto" for m in models)


def test_tts_config_and_voices(seeded):
    r = requests.get(f"{BASE_URL}/api/tts/config", headers=_h(seeded))
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/api/tts/voices", headers=_h(seeded))
    assert r.status_code == 200


def test_whatsapp_config_missing(seeded):
    r = requests.get(f"{BASE_URL}/api/whatsapp/config", headers=_h(seeded))
    assert r.status_code == 200
    data = r.json()
    mc = data.get("missing", [])
    # Contract: PHONE_NUMBER_ID and TEMPLATE_NAME not configured
    assert any("PHONE_NUMBER_ID" in m for m in mc), mc
    assert any("TEMPLATE_NAME" in m for m in mc), mc


def test_ambient_ensure(seeded):
    r = requests.post(f"{BASE_URL}/api/media/ensure-ambient", headers=_h(seeded))
    assert r.status_code == 200
    data = r.json()
    assert "started" in data and "status" in data


# ---------- Focused: storage_serve return-inside-try ----------
def test_storage_serve_no_auth_401():
    r = requests.get(f"{BASE_URL}/api/storage/some/path.png")
    assert r.status_code == 401


def test_storage_serve_not_found_404(seeded):
    r = requests.get(
        f"{BASE_URL}/api/storage/elena-lounge/{seeded['user_id']}/does-not-exist-{int(time.time())}.png",
        headers=_h(seeded),
    )
    assert r.status_code == 404
    assert r.json().get("detail") == "Not found"


def test_storage_serve_200_valid(seeded):
    # Upload a PNG via /api/chat/upload to produce a valid stored path
    png = _make_png()
    files = {"file": ("iter11.png", png, "image/png")}
    r = requests.post(f"{BASE_URL}/api/chat/upload", headers=_h(seeded), files=files, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    url = body["user_message"]["attachment_url"]
    assert url.startswith("/api/storage/elena-lounge/")
    # Fetch it
    r2 = requests.get(f"{BASE_URL}{url}", headers=_h(seeded))
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("image/")
    assert len(r2.content) > 0
    # Verify elena_message is REAL, not fallback (credits recharged)
    elena_text = body["elena_message"]["text"]
    assert not elena_text.startswith(FALLBACK_PREFIX), (
        f"Expected real Elena reaction, got fallback: {elena_text!r}"
    )
    assert len(elena_text) > 20, f"Elena reaction too short: {elena_text!r}"


# ---------- Chat stream regression (Gemini + GPT-5.4) ----------
@pytest.mark.parametrize("provider,model", [
    ("gemini", "gemini-3-flash-preview"),
    ("openai", "gpt-5.4"),
])
def test_chat_stream(seeded, provider, model):
    # Set model
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        headers=_h(seeded),
        json={"provider": provider, "model": model},
    )
    assert r.status_code == 200
    # Stream
    with requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers=_h(seeded),
        json={"text": "Hola Elena"},
        stream=True,
        timeout=30,
    ) as s:
        assert s.status_code == 200
        got_delta = False
        got_done = False
        for line in s.iter_lines(decode_unicode=True):
            if not line:
                continue
            if "event: delta" in line or line.startswith("data: ") and len(line) > 10:
                got_delta = True
            if "event: done" in line:
                got_done = True
                break
        assert got_done, f"No done event for {provider}/{model}"
