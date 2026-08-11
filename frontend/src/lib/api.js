import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export const authApi = {
  exchange: (session_id) => api.post('/auth/session', { session_id }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const chatApi = {
  send: (text) => api.post('/chat/message', { text }),
  history: () => api.get('/chat/history'),
  clear: () => api.delete('/chat/history'),
  models: () => api.get('/chat/models'),
  setModel: (provider, model) => api.post('/chat/model', { provider, model }),
};

export const mediaApi = {
  generatePhoto: (prompt = '') => api.post('/media/generate-photo', { prompt }),
  generateVideo: (prompt = '') => api.post('/media/generate-video', { prompt }),
  job: (jobId) => api.get(`/media/job/${jobId}`),
  gallery: () => api.get('/media/gallery'),
  fileUrl: (fileUrl) => `${BACKEND_URL}${fileUrl}`,
};

export const didApi = {
  config: () => api.get('/did/config'),
  createStream: () => api.post('/did/stream'),
  submitSdp: (streamId, answer) => api.post(`/did/stream/${streamId}/sdp`, { answer }),
  submitIce: (streamId, candidate) => api.post(`/did/stream/${streamId}/ice`, candidate || {}),
  speak: (streamId, text, voiceId) =>
    api.post(`/did/stream/${streamId}/talk`, { text, voice_provider: 'elevenlabs', voice_id: voiceId }),
  close: (streamId) => api.delete(`/did/stream/${streamId}`),
};

export const ttsApi = {
  config: () => api.get('/tts/config'),
  voices: () => api.get('/tts/voices'),
  setVoice: (voice_id) => api.post('/tts/voice', { voice_id }),
  speakUrl: () => `${API}/tts/speak`,
  speak: async (text, voiceId) => {
    const res = await fetch(`${API}/tts/speak`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return res.blob();
  },
};

export const ambientApi = {
  ensure: () => api.post('/media/ensure-ambient'),
};

export const whatsappApi = {
  config: () => api.get('/whatsapp/config'),
  call: (to_number, first_message) =>
    api.post('/whatsapp/call', { to_number, first_message }),
};

export const sttApi = {
  transcribe: async (blob, filename = 'audio.webm') => {
    const form = new FormData();
    form.append('file', blob, filename);
    const res = await fetch(`${API}/stt/transcribe`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      let detail = 'Transcripción falló';
      try {
        detail = (await res.json()).detail || detail;
      } catch { /* ignore */ }
      throw new Error(detail);
    }
    return (await res.json()).text;
  },
};
