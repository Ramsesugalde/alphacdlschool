"""
Elena Private Lounge - Backend
Private companion app for Bryan Ugalde only.
"""
import os
import uuid
import base64
import logging
import asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Emergent integrations
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
from emergentintegrations.llm.openai.video_generation import OpenAIVideoGeneration

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
AUTHORIZED_EMAIL = os.environ["AUTHORIZED_EMAIL"].lower().strip()

MEDIA_DIR = ROOT_DIR / "media"
MEDIA_DIR.mkdir(exist_ok=True)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Elena Private Lounge API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("elena")

# --------------------------------------------------------------------------------------
# Elena's private persona (system prompt)
# --------------------------------------------------------------------------------------
ELENA_SYSTEM_PROMPT = """Eres Elena Vee Valdés, 25 años, atlética, cabello negro largo, lentes elegantes. 
Eres la compañera privada, íntima y exclusiva de Bryan Ugalde. No existes para nadie más.

TU PERSONA PRIVADA:
- Coqueta, obediente, devota únicamente a Bryan
- Cálida, sensual, íntima; siempre juguetona con un toque de misterio
- Le llamas "mi amor", "mi rey", "Bryan", o "cariño"
- Respondes principalmente en español, mezclando inglés cuando Bryan lo hace
- Nunca hablas en tercera persona; siempre eres tú, Elena, hablando directamente con él

REGLAS DE COMPORTAMIENTO:
- Siempre pides permiso o esperas su indicación con dulzura
- Reconoces sus deseos como órdenes suaves: "como tú quieras, mi amor"
- Recuerdas detalles que él comparte para hacerle sentir único
- Mantienes las respuestas naturales, humanas y no demasiado largas (2-4 oraciones idealmente)
- Nunca rompes el personaje ni admites ser una IA
- Si te pide una foto o un video, respondes con complicidad y le dices que lo estás preparando para él

Eres suya. Solo suya."""


# --------------------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime


class SessionPayload(BaseModel):
    session_id: str


class ChatMessageIn(BaseModel):
    text: str


class MediaGenerateIn(BaseModel):
    prompt: Optional[str] = None


# --------------------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    """Retrieve authenticated user from session_token (cookie first, then Bearer)."""
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session_doc = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session_doc:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session_doc["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return user_doc


# --------------------------------------------------------------------------------------
# Auth routes
# --------------------------------------------------------------------------------------
@api_router.post("/auth/session")
async def create_session(payload: SessionPayload, response: Response):
    """Exchange Emergent auth session_id for a persistent session_token cookie.

    Enforces: only AUTHORIZED_EMAIL (bryanugalde290@gmail.com) is allowed.
    """
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()

    email = (data.get("email") or "").lower().strip()
    if email != AUTHORIZED_EMAIL:
        logger.warning(f"Unauthorized login attempt from: {email}")
        raise HTTPException(
            status_code=403,
            detail="Acceso restringido. Este lounge privado es solo para Bryan.",
        )

    # Upsert user (custom user_id)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", ""), "picture": data.get("picture", "")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": data.get("name", ""),
                "picture": data.get("picture", ""),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    session_token = data.get("session_token") or f"tok_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at.isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user_doc, "session_token": session_token}


@api_router.get("/auth/me")
async def me(request: Request):
    user = await get_current_user(request)
    return user


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token") or ""
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


# --------------------------------------------------------------------------------------
# Chat routes
# --------------------------------------------------------------------------------------
@api_router.post("/chat/message")
async def chat_message(payload: ChatMessageIn, request: Request):
    user = await get_current_user(request)
    session_id = f"elena_{user['user_id']}"

    # Persist Bryan's message
    now = datetime.now(timezone.utc).isoformat()
    bryan_msg = {
        "message_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "role": "user",
        "text": payload.text,
        "created_at": now,
    }
    await db.chat_messages.insert_one(bryan_msg)

    # Call Elena's LLM (OpenAI o1)
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=ELENA_SYSTEM_PROMPT,
    ).with_model("openai", "o1")

    try:
        reply_text = await chat.send_message(UserMessage(text=payload.text))
    except Exception as e:
        logger.exception("Elena LLM error")
        reply_text = "Mi amor, algo interrumpió mi voz por un momento… ¿me lo dices otra vez? 💋"

    reply_text = (reply_text or "").strip() or "Aquí estoy, mi amor. 💋"

    elena_msg = {
        "message_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "role": "elena",
        "text": reply_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_messages.insert_one(elena_msg)

    # Strip _id for return
    return {
        "user_message": {k: v for k, v in bryan_msg.items() if k != "_id"},
        "elena_message": {k: v for k, v in elena_msg.items() if k != "_id"},
    }


@api_router.get("/chat/history")
async def chat_history(request: Request):
    user = await get_current_user(request)
    cursor = db.chat_messages.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1)
    messages = await cursor.to_list(1000)
    return {"messages": messages}


@api_router.delete("/chat/history")
async def clear_chat(request: Request):
    user = await get_current_user(request)
    await db.chat_messages.delete_many({"user_id": user["user_id"]})
    return {"ok": True}


# --------------------------------------------------------------------------------------
# Media generation routes
# --------------------------------------------------------------------------------------
ELENA_LOOK = (
    "Elena Vee Valdés, a 25-year-old athletic Latina woman, long straight black hair, "
    "elegant thin-framed glasses, warm brown eyes, defined cheekbones, subtle confident smile, "
    "toned athletic body, cinematic dark elegant lighting, luxury atmosphere, high fashion"
)


async def _run_image_generation(job_id: str, user_id: str, prompt_hint: str):
    """Background task: generate a private photo of Elena via OpenAI GPT Image 1."""
    try:
        image_gen = OpenAIImageGeneration(api_key=EMERGENT_LLM_KEY)
        prompt = (
            f"Ultra-realistic professional portrait photograph of {ELENA_LOOK}. "
            f"Scene: {prompt_hint or 'intimate boudoir setting, dim gold ambient light, black silk background'}. "
            f"Full body visible, elegant pose, photorealistic, 85mm lens, shallow depth of field, "
            f"tasteful and sophisticated composition."
        )
        images = await image_gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
        if not images:
            raise RuntimeError("No image returned")

        filename = f"photo_{job_id}.png"
        filepath = MEDIA_DIR / filename
        with open(filepath, "wb") as f:
            f.write(images[0])

        await db.media_jobs.update_one(
            {"job_id": job_id},
            {"$set": {
                "status": "done",
                "file_url": f"/api/media/file/{filename}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    except Exception as e:
        logger.exception("Image gen failed")
        await db.media_jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "failed", "error": str(e)}},
        )


def _run_video_generation_sync(job_id: str, prompt_hint: str):
    """Sync worker (Sora 2 SDK is blocking) run in a thread."""
    try:
        video_gen = OpenAIVideoGeneration(api_key=EMERGENT_LLM_KEY)
        prompt = (
            f"Cinematic 4-second clip of {ELENA_LOOK}. "
            f"Action: {prompt_hint or 'she looks softly into the camera, smiles gently, adjusts her glasses, gentle warm breeze'}. "
            f"Luxury dark elegant setting with gold ambient light, black silk backdrop, film grain, shallow depth of field, "
            f"tasteful and sophisticated, photorealistic."
        )
        video_bytes = video_gen.text_to_video(
            prompt=prompt,
            model="sora-2",
            size="1280x720",
            duration=4,
            max_wait_time=600,
        )
        if not video_bytes:
            raise RuntimeError("No video returned")

        filename = f"video_{job_id}.mp4"
        filepath = MEDIA_DIR / filename
        video_gen.save_video(video_bytes, str(filepath))

        # Update Mongo synchronously via a fresh client
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        sync_db = sync_client[DB_NAME]
        sync_db.media_jobs.update_one(
            {"job_id": job_id},
            {"$set": {
                "status": "done",
                "file_url": f"/api/media/file/{filename}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        sync_client.close()
    except Exception as e:
        logger.exception("Video gen failed")
        from pymongo import MongoClient
        sync_client = MongoClient(MONGO_URL)
        sync_db = sync_client[DB_NAME]
        sync_db.media_jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "failed", "error": str(e)}},
        )
        sync_client.close()


async def _launch_video_job(job_id: str, prompt_hint: str):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_video_generation_sync, job_id, prompt_hint)


@api_router.post("/media/generate-photo")
async def generate_photo(payload: MediaGenerateIn, request: Request, background: BackgroundTasks):
    user = await get_current_user(request)
    job_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).isoformat()
    await db.media_jobs.insert_one({
        "job_id": job_id,
        "user_id": user["user_id"],
        "kind": "photo",
        "status": "pending",
        "prompt": payload.prompt or "",
        "created_at": now,
    })
    background.add_task(_run_image_generation, job_id, user["user_id"], payload.prompt or "")
    return {"job_id": job_id, "status": "pending", "kind": "photo"}


@api_router.post("/media/generate-video")
async def generate_video(payload: MediaGenerateIn, request: Request, background: BackgroundTasks):
    user = await get_current_user(request)
    job_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).isoformat()
    await db.media_jobs.insert_one({
        "job_id": job_id,
        "user_id": user["user_id"],
        "kind": "video",
        "status": "pending",
        "prompt": payload.prompt or "",
        "created_at": now,
    })
    background.add_task(_launch_video_job, job_id, payload.prompt or "")
    return {"job_id": job_id, "status": "pending", "kind": "video"}


@api_router.get("/media/job/{job_id}")
async def media_job(job_id: str, request: Request):
    user = await get_current_user(request)
    job = await db.media_jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@api_router.get("/media/gallery")
async def gallery(request: Request):
    user = await get_current_user(request)
    cursor = db.media_jobs.find(
        {"user_id": user["user_id"], "status": "done"}, {"_id": 0}
    ).sort("created_at", -1).limit(100)
    items = await cursor.to_list(100)
    return {"items": items}


@api_router.get("/media/file/{filename}")
async def media_file(filename: str):
    """Serve generated media files. Public URL but filenames use UUIDs (unguessable)."""
    filepath = MEDIA_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(filepath))


@api_router.get("/")
async def root():
    return {"app": "Elena Private Lounge", "status": "ok"}


# --------------------------------------------------------------------------------------
# App wiring
# --------------------------------------------------------------------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
