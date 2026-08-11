// Test IDs for Elena Private Lounge feature (auth callback, dashboard, chat, media).

export const AUTH = {
  loginButton: 'auth-login-google-button',
  callbackSpinner: 'auth-callback-spinner',
  unauthorized: 'auth-unauthorized-message',
};

export const DASHBOARD = {
  root: 'dashboard-root',
  header: 'dashboard-header',
  statusIndicator: 'dashboard-status-indicator',
  logoutButton: 'dashboard-logout-button',
  playerContainer: 'dashboard-player-container',
  playerImage: 'dashboard-player-image',
  playerVideo: 'dashboard-player-video',
};

export const CHAT = {
  container: 'chat-container',
  messagesList: 'chat-messages-list',
  input: 'chat-input',
  sendButton: 'chat-send-button',
  clearButton: 'chat-clear-button',
  micButton: 'chat-mic-button',
  uploadButton: 'chat-upload-button',
  uploadInput: 'chat-upload-input',
  message: (id) => `chat-message-${id}`,
};

export const MEDIA = {
  photoButton: 'media-generate-photo-button',
  videoButton: 'media-generate-video-button',
  gallery: 'media-gallery',
  galleryItem: (id) => `media-gallery-item-${id}`,
  jobStatus: 'media-job-status',
  callButton: 'wa-call-button',
};

export const DID = {
  connectButton: 'did-connect-button',
  disconnectButton: 'did-disconnect-button',
  video: 'did-video',
  status: 'did-status',
};
