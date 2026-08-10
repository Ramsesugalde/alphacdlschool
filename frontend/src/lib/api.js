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
