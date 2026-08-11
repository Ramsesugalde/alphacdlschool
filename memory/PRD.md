# Elena Private Lounge - PRD

## Original Problem Statement
Build a private web application named 'Elena Private Lounge' for user Bryan Ugalde.
- PRIVATE ACCESS via Google Login (bryanugalde290@gmail.com only)
- Character interface for 'Elena Vee Valdés' (25, athletic, black hair, glasses)
- Central video/image player + chat interface
- 'Generate Private Photo' and 'Request Special Video' buttons
- Obedient, coqueta, devoted persona

## User Choices
- LLM: OpenAI o1 (advanced reasoning)
- Visual: BOTH Sora 2 Video + Animated Avatar
- Design: Dark Elegant (Black and Gold)
- API: Emergent LLM Key

## Architecture
- **Backend**: FastAPI + MongoDB (Motor). Emergent-managed Google Auth for login, restricted allowlist to `bryanugalde290@gmail.com`.
- **AI**:
  - Chat: `LlmChat` with `openai/o1` via `EMERGENT_LLM_KEY`
  - Image: `OpenAIImageGeneration` (gpt-image-1)
  - Video: `OpenAIVideoGeneration` (sora-2, 1280x720, 4s)
- **Frontend**: React 19 + React Router + Tailwind + shadcn/ui + framer-motion + sonner
- **Auth**: Emergent OAuth session_id -> backend exchanges for session_token cookie (7d), enforces email allowlist
- **Design**: Dark elegant, Playfair Display (headings) + Manrope (body), black + gold #D4AF37 with glassmorphism

## Implemented (Feb 2026)
- Google OAuth via Emergent Auth (email allowlist enforced server-side)
- Persistent chat with Elena (OpenAI o1, private persona system prompt, Spanish/bilingual)
- On-demand private photo generation (GPT Image 1)
- On-demand special video generation (Sora 2, background task with polling)
- Private gallery of past generations
- Cinematic dashboard: central Elena player + chat sidebar + action panel + gallery
- Dark elegant black/gold theme with glassmorphism + framer motion micro-interactions
- SSE streaming chat + Gemini fallback when OpenAI is out of quota
- ElevenLabs TTS + Whisper STT (push-to-talk mic)
- Emergent Object Storage for persistent gallery + user photo uploads
- Model Switcher (GPT-5.4 / Gemini / Auto)
- **NEW (Feb 2026)** Degraded-mode banner: chat SSE emits `event: degraded` with reason + canned flag, Dashboard shows a dismissible amber banner + one-time toast when Elena falls back (model swap or canned offline reply). Upload path returns `degraded` object too.

## Files
- Backend: `/app/backend/server.py`, `/app/backend/.env`
- Frontend pages: `/app/frontend/src/pages/{LoginPage,AuthCallback,Dashboard}.jsx`
- Elena components: `/app/frontend/src/components/elena/{ElenaPlayer,ChatPanel,ActionPanel,Gallery}.jsx`
- API client: `/app/frontend/src/lib/api.js`
- Test IDs: `/app/frontend/src/constants/testIds/elena.js`

## Backend Endpoints
- `POST /api/auth/session` - exchange Emergent session_id, enforces email allowlist
- `GET /api/auth/me` - current user
- `POST /api/auth/logout`
- `POST /api/chat/stream` - SSE stream with `user` / `start` / `delta` / `degraded` / `done` events
- `POST /api/chat/upload` - Bryan sends a photo, Elena reacts; response includes `degraded` field when fallback triggered
- `GET /api/chat/history`
- `DELETE /api/chat/history`
- `POST /api/media/generate-photo` - background gpt-image-1
- `POST /api/media/generate-video` - background sora-2
- `GET /api/media/job/{id}` - poll status
- `GET /api/media/gallery`
- `GET /api/storage/{path:path}` - serve persisted media
- `POST /api/stt/transcribe` · `POST /api/tts/speak` · `GET /api/tts/config` · `GET /api/did/config`

## Backlog (P1/P2)
- P1: Recharge Universal Key balance to restore live GPT/Gemini responses (user action)
- P1: Provide valid `DID_API_KEY` to unlock live talking-head lip-sync
- P1: Provide `KLING_IA_API_KEY` to unlock premium video generation
- P1: Provide `ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID` for outbound WhatsApp voice calls
- P2: Refactor `ChatPanel.jsx` (500+ lines) into Input / MessageList / VoiceRecorder subcomponents
- P2: Refactor `Dashboard.jsx` (370+ lines) into container + presentational
- P2: Real-time animated avatar with lip-sync (D-ID or similar)
- P2: Persistent per-photo/video prompts, favorites
- P2: PWA install for phone-native intimacy

## Test Identity
- Authorized email: `bryanugalde290@gmail.com` (real Google account required)
- Test session via `test_credentials.md` for automated tests
