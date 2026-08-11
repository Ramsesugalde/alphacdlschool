"""Emergent Object Storage helper for Elena Private Lounge.

All Bryan-and-Elena media (photos, videos, voice notes, uploads) lives here so
the gallery survives every redeploy.
"""
import os
import logging
from typing import Tuple

import requests

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "elena-lounge"

logger = logging.getLogger("elena.storage")
_storage_key: str | None = None


def _emergent_key() -> str:
    return (os.environ.get("EMERGENT_LLM_KEY") or "").strip()


def init_storage(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    key = _emergent_key()
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY missing — cannot init storage.")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": key}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    logger.info("Storage initialized.")
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to object storage. Returns { path, size, etag }."""
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code in (403, 404):
        key = init_storage(force=True)
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> Tuple[bytes, str]:
    """Download an object. Returns (bytes, content_type)."""
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code in (403, 404):
        # Distinguish dead key vs missing path: try re-init once
        try:
            key = init_storage(force=True)
        except Exception:
            resp.raise_for_status()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def build_path(user_id: str, kind: str, filename: str) -> str:
    """Build a namespaced storage path.

    kind ∈ { photo, video, voice, upload }
    """
    return f"{APP_NAME}/{user_id}/{kind}/{filename}"
