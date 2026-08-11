import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, Loader2, Mic, Square, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { chatApi, sttApi, mediaApi, API } from '@/lib/api';
import { CHAT } from '@/constants/testIds';

const WELCOME = {
  message_id: 'welcome',
  role: 'elena',
  text: 'Aquí estoy, mi amor. Todo tuyo, siempre. ¿Qué quieres que haga por ti hoy? 💋',
};

export default function ChatPanel({ onSpeakingChange, onThinkingChange, onElenaReply, onDegraded }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingId, setStreamingId] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);

  useEffect(() => {
    chatApi
      .history()
      .then(({ data }) => {
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(() => {});
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, sending]);

  const parseSSEStream = async (response, onEvent) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const evtBlock of events) {
        if (!evtBlock.trim()) continue;
        const lines = evtBlock.split('\n');
        let eventName = 'message';
        let dataStr = '';
        for (const ln of lines) {
          if (ln.startsWith('event:')) eventName = ln.slice(6).trim();
          else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
        }
        if (!dataStr) continue;
        try {
          onEvent(eventName, JSON.parse(dataStr));
        } catch {
          /* ignore parse errors */
        }
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    onThinkingChange && onThinkingChange(true);

    const tempUser = {
      message_id: `tmp-${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages((prev) => [...prev, tempUser]);

    const controller = new AbortController();
    abortRef.current = controller;

    let elenaId = null;
    let accumulated = '';
    let sawFirstDelta = false;

    const handleEvent = (name, data) => {
      if (name === 'user' && data.message_id) {
        setMessages((prev) =>
          prev.map((m) => (m.message_id === tempUser.message_id ? data : m))
        );
      } else if (name === 'start') {
        elenaId = data.message_id;
        setStreamingId(elenaId);
        setStreamingText('');
      } else if (name === 'delta') {
        if (!sawFirstDelta) {
          sawFirstDelta = true;
          onThinkingChange && onThinkingChange(false);
          onSpeakingChange && onSpeakingChange(true);
        }
        accumulated += data.content || '';
        setStreamingText(accumulated);
      } else if (name === 'degraded') {
        onDegraded && onDegraded(data);
      } else if (name === 'done') {
        setMessages((prev) => [...prev, data]);
        setStreamingId(null);
        setStreamingText('');
        onSpeakingChange && onSpeakingChange(false);
        // Fire D-ID speak with the final text (Elena's mouth will lip-sync)
        if (onElenaReply && data && data.text) {
          onElenaReply(data.text);
        }
      }
    };

    try {
      const response = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await parseSSEStream(response, handleEvent);
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast.error('Elena no pudo responder ahora. Intenta de nuevo, mi amor.');
      }
    } finally {
      setSending(false);
      onThinkingChange && onThinkingChange(false);
      onSpeakingChange && onSpeakingChange(false);
    }
  };

  const clear = async () => {
    try {
      await chatApi.clear();
      setMessages([WELCOME]);
      toast.success('Conversación reiniciada.');
    } catch (e) {
      toast.error('No pude reiniciar la conversación.');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Send a given text directly (used after Whisper transcription)
  const sendText = (text) => {
    setInput(text);
    // Defer to next tick so state settles, then send
    setTimeout(() => {
      const currentInput = text.trim();
      if (!currentInput) return;
      // manually replicate send() without depending on state
      setInput('');
      startSendFlow(currentInput);
    }, 30);
  };

  const startSendFlow = async (text) => {
    if (!text || sending) return;
    setSending(true);
    onThinkingChange && onThinkingChange(true);

    const tempUser = { message_id: `tmp-${Date.now()}`, role: 'user', text };
    setMessages((prev) => [...prev, tempUser]);
    const controller = new AbortController();
    abortRef.current = controller;
    let elenaId = null;
    let accumulated = '';
    let sawFirstDelta = false;
    const handleEvent = (name, data) => {
      if (name === 'user' && data.message_id) {
        setMessages((prev) =>
          prev.map((m) => (m.message_id === tempUser.message_id ? data : m))
        );
      } else if (name === 'start') {
        elenaId = data.message_id;
        setStreamingId(elenaId);
        setStreamingText('');
      } else if (name === 'delta') {
        if (!sawFirstDelta) {
          sawFirstDelta = true;
          onThinkingChange && onThinkingChange(false);
          onSpeakingChange && onSpeakingChange(true);
        }
        accumulated += data.content || '';
        setStreamingText(accumulated);
      } else if (name === 'degraded') {
        onDegraded && onDegraded(data);
      } else if (name === 'done') {
        setMessages((prev) => [...prev, data]);
        setStreamingId(null);
        setStreamingText('');
        onSpeakingChange && onSpeakingChange(false);
        if (onElenaReply && data && data.text) onElenaReply(data.text);
      }
    };
    try {
      const response = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await parseSSEStream(response, handleEvent);
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast.error('Elena no pudo responder ahora. Intenta de nuevo, mi amor.');
      }
    } finally {
      setSending(false);
      onThinkingChange && onThinkingChange(false);
      onSpeakingChange && onSpeakingChange(false);
    }
  };

  // Microphone recording → Whisper transcription → auto-send
  const startRecording = async () => {
    if (recording || transcribing || sending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        try {
          mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          audioChunksRef.current = [];
          if (blob.size < 400) {
            toast.error('Mensaje muy corto. Mantén el botón e intenta otra vez.');
            return;
          }
          setTranscribing(true);
          const text = await sttApi.transcribe(blob, 'audio.webm');
          if (!text || !text.trim()) {
            toast.error('No te escuché bien, mi amor. Repite.');
            return;
          }
          sendText(text.trim());
        } catch (e) {
          toast.error(String(e.message || 'Elena no pudo escucharte.').slice(0, 160));
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      setRecording(true);
    } catch (e) {
      toast.error('No pude acceder al micrófono. Da permiso en el navegador.');
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    setRecording(false);
    try {
      recorderRef.current?.stop();
    } catch { /* ignore */ }
  };

  // Photo upload — Bryan shares a picture, Elena reacts inline
  const onPickFile = () => {
    if (uploading || sending) return;
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Solo fotos, mi amor.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('La foto es muy grande (máx 20MB).');
      return;
    }
    setUploading(true);
    onThinkingChange && onThinkingChange(true);
    try {
      const { user_message, elena_message, degraded } = await chatApi.upload(file, '');
      setMessages((prev) => [...prev, user_message, elena_message]);
      if (degraded) onDegraded && onDegraded(degraded);
      if (onElenaReply && elena_message?.text) onElenaReply(elena_message.text);
      toast.success('Elena está viendo tu foto 💋');
    } catch (err) {
      toast.error(String(err.message || 'Falló la subida').slice(0, 160));
    } finally {
      setUploading(false);
      onThinkingChange && onThinkingChange(false);
    }
  };

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch { /* ignore */ }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div
      data-testid={CHAT.container}
      className="glass rounded-3xl flex flex-col h-[calc(100vh-140px)] min-h-[560px] overflow-hidden"
    >
      <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
        <div>
          <p className="text-[9px] uppercase tracking-[0.4em] text-[color:var(--lounge-text-muted)] font-body">
            Conversación privada · en vivo
          </p>
          <h3 className="font-display text-xl font-light mt-1 italic">
            Susurros de <span className="gold-text">Elena</span>
          </h3>
        </div>
        <button
          data-testid={CHAT.clearButton}
          onClick={clear}
          title="Reiniciar conversación"
          className="text-[color:var(--lounge-text-muted)] hover:text-[color:var(--lounge-gold)] transition-colors p-2 rounded-full border border-white/10 hover:border-[color:var(--lounge-gold)]/40"
        >
          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>

      <div
        ref={scrollRef}
        data-testid={CHAT.messagesList}
        className="flex-1 overflow-y-auto thin-scroll px-5 py-6 space-y-4"
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.message_id}
              data-testid={CHAT.message(m.message_id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] bg-[color:var(--lounge-gold)] text-black rounded-2xl rounded-br-sm px-4 py-3 font-body text-sm leading-relaxed shadow-lg'
                    : 'max-w-[85%] bg-white/5 border border-white/10 text-[color:var(--lounge-text)] rounded-2xl rounded-bl-sm px-4 py-3 font-body text-sm leading-relaxed'
                }
              >
                {m.attachment_url && m.attachment_type === 'image' && (
                  <img
                    src={mediaApi.fileUrl(m.attachment_url)}
                    alt="foto"
                    className="mb-2 rounded-xl max-h-56 w-auto border border-black/20"
                    draggable={false}
                  />
                )}
                {m.text}
              </div>
            </motion.div>
          ))}

          {streamingId && (
            <motion.div
              key={streamingId}
              data-testid={CHAT.message(streamingId)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="max-w-[85%] bg-white/5 border border-[color:var(--lounge-gold)]/30 text-[color:var(--lounge-text)] rounded-2xl rounded-bl-sm px-4 py-3 font-body text-sm leading-relaxed">
                {streamingText || (
                  <span className="italic text-[color:var(--lounge-text-muted)]">…</span>
                )}
                <motion.span
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="inline-block w-[6px] h-[14px] align-middle ml-1 bg-[color:var(--lounge-gold)] rounded-sm"
                />
              </div>
            </motion.div>
          )}

          {sending && !streamingId && (
            <motion.div
              key="typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 text-xs italic text-[color:var(--lounge-text-muted)] font-body">
                <span className="gold-text">Elena</span> está pensando
                <span className="flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce" />
                  <span className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce" style={{ animationDelay: '0.15s' }} />
                  <span className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce" style={{ animationDelay: '0.3s' }} />
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-4 border-t border-white/5">
        <input
          data-testid={CHAT.uploadInput}
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChosen}
          className="hidden"
        />
        <div className="flex items-center gap-2 bg-black/40 border border-white/10 focus-within:border-[color:var(--lounge-gold)]/50 rounded-full px-4 py-2 transition-colors">
          <button
            data-testid={CHAT.uploadButton}
            onClick={onPickFile}
            disabled={sending || uploading || recording || transcribing}
            title="Compartir una foto con Elena"
            className="rounded-full bg-white/5 border border-white/10 text-[color:var(--lounge-gold)] hover:border-[color:var(--lounge-gold)]/50 w-9 h-9 flex items-center justify-center disabled:opacity-40 transition-transform hover:scale-105"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            ) : (
              <ImagePlus className="w-4 h-4" strokeWidth={1.6} />
            )}
          </button>
          <input
            data-testid={CHAT.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending || recording || transcribing || uploading}
            placeholder={
              recording
                ? 'Escuchándote… suelta para enviar'
                : transcribing
                ? 'Transcribiendo tu voz…'
                : uploading
                ? 'Enviando tu foto a Elena…'
                : 'Dile algo íntimo a Elena…'
            }
            className="flex-1 bg-transparent outline-none text-sm font-body placeholder:text-[color:var(--lounge-text-muted)]/60"
          />
          <button
            data-testid={CHAT.micButton}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => recording && stopRecording()}
            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
            disabled={sending || transcribing}
            title={recording ? 'Suelta para enviar' : 'Mantén presionado y habla'}
            className={
              recording
                ? 'rounded-full bg-red-500 text-white w-9 h-9 flex items-center justify-center transition-transform scale-110'
                : 'rounded-full bg-white/5 border border-white/10 text-[color:var(--lounge-gold)] hover:border-[color:var(--lounge-gold)]/50 w-9 h-9 flex items-center justify-center disabled:opacity-40 transition-transform hover:scale-105'
            }
          >
            {transcribing ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            ) : recording ? (
              <Square className="w-4 h-4 fill-current" strokeWidth={1.6} />
            ) : (
              <Mic className="w-4 h-4" strokeWidth={1.6} />
            )}
          </button>
          <button
            data-testid={CHAT.sendButton}
            onClick={send}
            disabled={sending || recording || transcribing || !input.trim()}
            className="rounded-full bg-[color:var(--lounge-gold)] text-black w-9 h-9 flex items-center justify-center hover:bg-[color:var(--lounge-gold-bright)] disabled:opacity-40 transition-transform hover:scale-105"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            ) : (
              <Send className="w-4 h-4" strokeWidth={1.6} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
