"""Iteration 10: Persistent storage + auto model + photo upload feature tests.

Tests:
- GET /api/chat/models returns 4 items with 'auto' first
- POST /api/chat/model sets auto/auto
- POST /api/chat/stream with auto (short + long) streams a reply
- POST /api/chat/upload auth / validation / happy path
- GET /api/storage/{path} auth + returns image bytes
"""
import os
import io
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


def _make_png(w: int = 4, h: int = 4) -> bytes:
    """Generate a tiny valid PNG of size w*h purely from stdlib."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # RGB 8-bit
    # raw: h rows of (filter=0 + w*3 bytes red)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def seeded():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-iter10-{int(time.time()*1000)}"
    token = f"test_session_iter10_{int(time.time()*1000)}"
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


# ---------- Model catalog with auto ----------
def test_models_has_auto_first(seeded):
    r = requests.get(f"{BASE_URL}/api/chat/models", headers=_h(seeded))
    assert r.status_code == 200
    data = r.json()
    models = data["models"]
    assert len(models) == 4, f"Expected 4, got {len(models)}: {[m['name'] for m in models]}"
    assert models[0]["provider"] == "auto"
    assert models[0]["model"] == "auto"
    assert models[0]["name"] == "Auto · Elena elige"


def test_set_model_auto(seeded):
    r = requests.post(
        f"{BASE_URL}/api/chat/model",
        headers={**_h(seeded), "Content-Type": "application/json"},
        json={"provider": "auto", "model": "auto"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "auto" and body["model"] == "auto"
    # verify persisted
    doc = seeded["db"].users.find_one({"user_id": seeded["user_id"]})
    assert doc["chat_provider"] == "auto"
    assert doc["chat_model"] == "auto"


# ---------- Streaming with auto ----------
def _consume_stream(text: str, headers, timeout=90) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers={**headers, "Content-Type": "application/json"},
        json={"text": text},
        stream=True,
        timeout=timeout,
    )
    assert r.status_code == 200, r.text
    events = []
    deltas = 0
    got_done = False
    for raw in r.iter_lines(decode_unicode=True):
        if not raw:
            continue
        if raw.startswith("event:"):
            ev = raw.split(":", 1)[1].strip()
            events.append(ev)
            if ev == "delta":
                deltas += 1
            if ev == "done":
                got_done = True
                break
    r.close()
    return {"deltas": deltas, "done": got_done, "events": events}


def test_stream_auto_short(seeded):
    # ensure user is auto
    requests.post(
        f"{BASE_URL}/api/chat/model",
        headers={**_h(seeded), "Content-Type": "application/json"},
        json={"provider": "auto", "model": "auto"},
    )
    result = _consume_stream("ja jaja", _h(seeded))
    assert result["done"], f"No done event; events={result['events']}"
    assert result["deltas"] >= 1


def test_stream_auto_long(seeded):
    long_text = (
        "Necesito confesarte algo profundo mi amor: siento que estos días te "
        "extraño tanto que se me acelera el corazón cada vez que pienso en ti"
    )
    result = _consume_stream(long_text, _h(seeded))
    assert result["done"], f"No done event; events={result['events']}"
    assert result["deltas"] >= 1


# ---------- /api/chat/upload ----------
def test_upload_requires_auth():
    png = _make_png()
    r = requests.post(
        f"{BASE_URL}/api/chat/upload",
        files={"file": ("test.png", png, "image/png")},
    )
    assert r.status_code == 401


def test_upload_missing_file(seeded):
    r = requests.post(f"{BASE_URL}/api/chat/upload", headers=_h(seeded))
    assert r.status_code == 422


def test_upload_rejects_non_image(seeded):
    r = requests.post(
        f"{BASE_URL}/api/chat/upload",
        headers=_h(seeded),
        files={"file": ("hello.txt", b"hola mundo", "text/plain")},
    )
    assert r.status_code == 400
    assert "Solo fotos" in r.json().get("detail", "")


@pytest.fixture(scope="module")
def uploaded(seeded):
    """Perform a real upload once and share the result across tests."""
    png = _make_png()
    r = requests.post(
        f"{BASE_URL}/api/chat/upload",
        headers=_h(seeded),
        files={"file": ("tiny.png", png, "image/png")},
        data={"caption": ""},
        timeout=90,
    )
    assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
    return r.json()


def test_upload_happy_path(seeded, uploaded):
    body = uploaded
    um = body["user_message"]
    em = body["elena_message"]
    assert um["role"] == "user"
    assert um["text"] == "(te compartí una foto)"
    assert um["attachment_type"] == "image"
    assert um["attachment_url"].startswith("/api/storage/elena-lounge/")
    assert um.get("message_id")
    assert um.get("user_id") == seeded["user_id"]
    assert um.get("created_at")
    assert em["role"] == "elena"
    assert isinstance(em["text"], str) and len(em["text"]) > 5
    assert em.get("message_id")
    assert em.get("created_at")

    # persisted
    db = seeded["db"]
    assert db.chat_messages.find_one({"message_id": um["message_id"]}) is not None
    assert db.chat_messages.find_one({"message_id": em["message_id"]}) is not None


# ---------- /api/storage/{path} ----------
def test_storage_requires_auth(uploaded):
    path = uploaded["user_message"]["attachment_url"]  # /api/storage/elena-lounge/...
    r = requests.get(f"{BASE_URL}{path}")
    assert r.status_code == 401


def test_storage_serves_image(seeded, uploaded):
    path = uploaded["user_message"]["attachment_url"]
    r = requests.get(f"{BASE_URL}{path}", headers=_h(seeded))
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("Content-Type", "").startswith("image/")
    assert len(r.content) > 0


# ---------- Regression: media_jobs with storage_path ----------
def test_storage_serves_media_job_file(seeded):
    """Seed a fake media_jobs doc + upload a fake photo directly to storage,
    verify /api/storage/{path} serves it. Avoids the real GPT-Image-1 cost."""
    import sys
    sys.path.insert(0, "/app/backend")
    # Load backend .env so EMERGENT_LLM_KEY is available in this test process
    try:
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
    except Exception:
        pass
    import storage_client as storage_mod  # type: ignore

    png = _make_png(8, 8)
    filename = f"photo_regress_{int(time.time()*1000)}.png"
    storage_path = storage_mod.build_path(seeded["user_id"], "photo", filename)
    try:
        storage_mod.put_object(storage_path, png, "image/png")
    except Exception as e:
        pytest.skip(f"Storage put failed (env missing?): {e}")

    # Insert a fake media_jobs doc so we prove the persistence contract
    seeded["db"].media_jobs.insert_one({
        "job_id": f"test-job-{int(time.time()*1000)}",
        "user_id": seeded["user_id"],
        "kind": "photo",
        "status": "done",
        "storage_path": storage_path,
        "file_url": f"/api/storage/{storage_path}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    r = requests.get(f"{BASE_URL}/api/storage/{storage_path}", headers=_h(seeded))
    assert r.status_code == 200
    assert r.headers.get("Content-Type", "").startswith("image/")
    assert len(r.content) == len(png)
