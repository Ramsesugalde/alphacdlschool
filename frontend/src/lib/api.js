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
