import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { chatApi, API } from '@/lib/api';
import { CHAT } from '@/constants/testIds';

const WELCOME = {
  message_id: 'welcome',
  role: 'elena',
  text: 'Aquí estoy, mi amor. Todo tuyo, siempre. ¿Qué quieres que haga por ti hoy? 💋',
};

export default function ChatPanel({ onSpeakingChange, onThinkingChange }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingId, setStreamingId] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

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
      } else if (name === 'done') {
        setMessages((prev) => [...prev, data]);
        setStreamingId(null);
        setStreamingText('');
        onSpeakingChange && onSpeakingChange(false);
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
        <div className="flex items-center gap-2 bg-black/40 border border-white/10 focus-within:border-[color:var(--lounge-gold)]/50 rounded-full px-4 py-2 transition-colors">
          <input
            data-testid={CHAT.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            placeholder="Dile algo íntimo a Elena…"
            className="flex-1 bg-transparent outline-none text-sm font-body placeholder:text-[color:var(--lounge-text-muted)]/60"
          />
          <button
            data-testid={CHAT.sendButton}
            onClick={send}
            disabled={sending || !input.trim()}
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
