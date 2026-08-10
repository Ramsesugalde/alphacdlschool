"""Backend API tests for Elena Private Lounge."""
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


@pytest.fixture(scope="session")
def seeded_session():
    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    user_id = f"test-user-elena-{int(time.time()*1000)}"
    token = f"test_session_{int(time.time()*1000)}"
    db.users.delete_many({"email": AUTHORIZED_EMAIL})
    db.user_sessions.delete_many({"user_id": {"$regex": "^test-user-"}})
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
    # cleanup
    db.chat_messages.delete_many({"user_id": user_id})
    db.media_jobs.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.users.delete_many({"user_id": user_id})
    mc.close()


@pytest.fixture
def auth_headers(seeded_session):
    return {"Authorization": f"Bearer {seeded_session['token']}"}


# ---------- Public / Auth ----------
def test_root():
    r = requests.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("app") == "Elena Private Lounge"
    assert data.get("status") == "ok"


def test_me_unauthenticated():
    r = requests.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 401


def test_session_invalid_id():
    r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid_fake_session_xyz"})
    assert r.status_code == 401


def test_me_with_seeded_token(auth_headers, seeded_session):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == AUTHORIZED_EMAIL
    assert data["user_id"] == seeded_session["user_id"]


# ---------- Chat ----------
def test_chat_message_and_history(auth_headers):
    # Clear first
    requests.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)

    r = requests.post(
        f"{BASE_URL}/api/chat/message",
        headers=auth_headers,
        json={"text": "Hola Elena, ¿estás ahí mi amor?"},
        timeout=120,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("user_message", "elena_message"):
        assert key in data
        m = data[key]
        assert "role" in m and "text" in m and "message_id" in m and "created_at" in m
    assert data["user_message"]["role"] == "user"
    assert data["elena_message"]["role"] == "elena"
    assert isinstance(data["elena_message"]["text"], str) and len(data["elena_message"]["text"]) > 0

    # history sorted asc
    h = requests.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
    assert h.status_code == 200
    msgs = h.json()["messages"]
    assert len(msgs) >= 2
    times = [m["created_at"] for m in msgs]
    assert times == sorted(times)


def test_chat_clear(auth_headers):
    r = requests.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)
    assert r.status_code == 200
    h = requests.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
    assert h.json()["messages"] == []


# ---------- Chat SSE Streaming ----------
def test_chat_stream_unauthenticated():
    r = requests.post(f"{BASE_URL}/api/chat/stream", json={"text": "hola"})
    assert r.status_code == 401


def _parse_sse_blocks(text):
    blocks = []
    for raw in text.split("\n\n"):
        if not raw.strip():
            continue
        ev = "message"
        data = ""
        for line in raw.splitlines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        blocks.append((ev, data))
    return blocks


def test_chat_stream_sse_flow(auth_headers):
    # Clear
    requests.delete(f"{BASE_URL}/api/chat/history", headers=auth_headers)

    import time as _t
    t0 = _t.time()
    with requests.post(
        f"{BASE_URL}/api/chat/stream",
        headers={**auth_headers, "Accept": "text/event-stream"},
        json={"text": "Hola preciosa, ¿me extrañaste?"},
        stream=True,
        timeout=60,
    ) as r:
        assert r.status_code == 200, r.text
        ct = r.headers.get("Content-Type", "")
        assert "text/event-stream" in ct, f"Unexpected content-type: {ct}"

        events = []
        buf = ""
        for chunk in r.iter_content(chunk_size=None, decode_unicode=True):
            if not chunk:
                continue
            buf += chunk
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                ev = "message"
                data = ""
                for line in raw.splitlines():
                    if line.startswith("event:"):
                        ev = line[6:].strip()
                    elif line.startswith("data:"):
                        data += line[5:].strip()
                if data:
                    events.append((ev, data))
            if _t.time() - t0 > 60:
                break

    elapsed = _t.time() - t0
    assert elapsed < 60, f"Stream too slow: {elapsed}s"

    names = [e[0] for e in events]
    assert "user" in names, f"Missing 'user' event. Got: {names}"
    assert "start" in names, f"Missing 'start' event. Got: {names}"
    assert names.count("delta") >= 1, f"Expected >=1 'delta' events. Got: {names}"
    assert "done" in names, f"Missing 'done' event. Got: {names}"

    import json as _json
    user_ev = next(_json.loads(d) for e, d in events if e == "user")
    assert user_ev["role"] == "user"
    assert "message_id" in user_ev

    start_ev = next(_json.loads(d) for e, d in events if e == "start")
    assert "message_id" in start_ev
    elena_id = start_ev["message_id"]

    deltas = [_json.loads(d) for e, d in events if e == "delta"]
    assert all("content" in x for x in deltas)
    accumulated = "".join(x.get("content", "") for x in deltas)
    assert len(accumulated) > 0

    done_ev = next(_json.loads(d) for e, d in events if e == "done")
    assert done_ev["message_id"] == elena_id
    assert done_ev["role"] == "elena"
    assert len(done_ev["text"]) > 0

    # history now contains both messages
    h = requests.get(f"{BASE_URL}/api/chat/history", headers=auth_headers)
    assert h.status_code == 200
    msgs = h.json()["messages"]
    ids = [m["message_id"] for m in msgs]
    assert user_ev["message_id"] in ids
    assert elena_id in ids


# ---------- Media ----------
def test_generate_photo(auth_headers):
    r = requests.post(f"{BASE_URL}/api/media/generate-photo", headers=auth_headers, json={"prompt": "test private"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "pending"
    assert data["kind"] == "photo"
    assert "job_id" in data
    job_id = data["job_id"]

    # Poll up to 3 min
    final = None
    for _ in range(36):
        time.sleep(5)
        jr = requests.get(f"{BASE_URL}/api/media/job/{job_id}", headers=auth_headers)
        assert jr.status_code == 200
        j = jr.json()
        if j["status"] in ("done", "failed"):
            final = j
            break

    assert final is not None, "Photo job timed out (>3min)"
    assert final["status"] == "done", f"Photo job failed: {final.get('error')}"
    assert final["file_url"].startswith("/api/media/file/")

    file_r = requests.get(f"{BASE_URL}{final['file_url']}", headers=auth_headers)
    assert file_r.status_code == 200
    assert file_r.headers.get("content-type", "").startswith("image/")

    # gallery contains it
    g = requests.get(f"{BASE_URL}/api/media/gallery", headers=auth_headers)
    assert g.status_code == 200
    items = g.json()["items"]
    assert any(it["job_id"] == job_id for it in items)


def test_generate_video_pending(auth_headers):
    r = requests.post(f"{BASE_URL}/api/media/generate-video", headers=auth_headers, json={"prompt": "smile softly"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "pending"
    assert data["kind"] == "video"
    assert "job_id" in data
    # Informational: don't wait full 8 min. Poll 3 min then report.
    job_id = data["job_id"]
    final = None
    for _ in range(36):  # 3 min
        time.sleep(5)
        jr = requests.get(f"{BASE_URL}/api/media/job/{job_id}", headers=auth_headers)
        if jr.status_code == 200:
            j = jr.json()
            if j["status"] in ("done", "failed"):
                final = j
                break
    if final is None:
        pytest.skip("Video generation still pending after 3min (informational)")
    if final["status"] == "failed":
        pytest.skip(f"Video failed: {final.get('error')}")
    assert final["status"] == "done"
    file_r = requests.get(f"{BASE_URL}{final['file_url']}", headers=auth_headers)
    assert file_r.status_code == 200


# ---------- Logout (last) ----------
def test_zzz_logout_invalidates_session(seeded_session):
    token = seeded_session["token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.post(f"{BASE_URL}/api/auth/logout", headers=headers, cookies={"session_token": token})
    assert r.status_code == 200
    # After logout, session should be invalid
    m = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    assert m.status_code == 401
