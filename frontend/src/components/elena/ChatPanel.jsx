import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { chatApi } from '@/lib/api';
import { CHAT } from '@/constants/testIds';

const WELCOME = {
  message_id: 'welcome',
  role: 'elena',
  text: 'Aquí estoy, mi amor. Todo tuyo, siempre. ¿Qué quieres que haga por ti hoy? 💋',
};

export default function ChatPanel() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    chatApi
      .history()
      .then(({ data }) => {
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    const tempUser = {
      message_id: `tmp-${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages((prev) => [...prev, tempUser]);
    try {
      const { data } = await chatApi.send(text);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.message_id !== tempUser.message_id);
        return [...filtered, data.user_message, data.elena_message];
      });
    } catch (e) {
      toast.error('Elena no pudo responder ahora. Intenta de nuevo, mi amor.');
    } finally {
      setSending(false);
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
            Conversación privada
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
          {sending && (
            <motion.div
              key="typing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 text-xs italic text-[color:var(--lounge-text-muted)] font-body">
                <span className="gold-text">Elena</span> está escribiendo
                <span className="flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce" />
                  <span
                    className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce"
                    style={{ animationDelay: '0.15s' }}
                  />
                  <span
                    className="w-1 h-1 rounded-full bg-[color:var(--lounge-gold)] animate-bounce"
                    style={{ animationDelay: '0.3s' }}
                  />
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
