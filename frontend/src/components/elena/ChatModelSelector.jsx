import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { chatApi } from '@/lib/api';

const TEST_ID = {
  trigger: 'chat-model-selector-trigger',
  menu: 'chat-model-selector-menu',
  option: (provider, model) => `chat-model-selector-option-${provider}-${model}`,
};

export default function ChatModelSelector() {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    chatApi
      .models()
      .then(({ data }) => {
        setModels(data.models || []);
        setCurrent(data.current);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const close = (e) => {
      if (!e.target.closest('[data-chat-model-selector]')) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const select = async (m) => {
    if (current && current.provider === m.provider && current.model === m.model) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await chatApi.setModel(m.provider, m.model);
      setCurrent({ provider: m.provider, model: m.model });
      toast.success(`Elena piensa ahora con ${m.name} 💋`);
    } catch (e) {
      toast.error('No pude cambiar el motor.');
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const currentModel = models.find(
    (m) => current && m.provider === current.provider && m.model === current.model
  );

  if (models.length === 0) return null;

  return (
    <div data-chat-model-selector className="relative">
      <button
        data-testid={TEST_ID.trigger}
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        title="Cambiar el motor de conversación de Elena"
        className="flex items-center gap-2 px-3 py-2 rounded-full glass border border-white/10 hover:border-[color:var(--lounge-gold)]/40 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 gold-text" strokeWidth={1.5} />
        <span className="text-[10px] uppercase tracking-[0.3em] font-body text-[color:var(--lounge-text)] hidden md:inline">
          {currentModel ? currentModel.name : 'Motor'}
        </span>
        <ChevronDown className="w-3 h-3 text-[color:var(--lounge-text-muted)]" strokeWidth={1.5} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            data-testid={TEST_ID.menu}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 mt-2 w-80 z-[80] rounded-2xl border border-white/10 overflow-hidden gold-glow"
            style={{ backgroundColor: 'rgba(8, 8, 10, 0.98)', backdropFilter: 'blur(24px)' }}
          >
            <div className="px-4 py-3 border-b border-white/5">
              <p className="text-[9px] uppercase tracking-[0.4em] gold-text font-body">
                El motor de Elena
              </p>
              <p className="text-[11px] font-body text-[color:var(--lounge-text-muted)] mt-1 italic">
                Cambia cómo piensa y contesta.
              </p>
            </div>
            <ul className="max-h-80 overflow-y-auto thin-scroll py-1">
              {models.map((m) => {
                const isCurrent =
                  current && current.provider === m.provider && current.model === m.model;
                return (
                  <li key={`${m.provider}-${m.model}`}>
                    <button
                      data-testid={TEST_ID.option(m.provider, m.model)}
                      onClick={() => select(m)}
                      disabled={saving}
                      className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-start gap-3"
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isCurrent ? 'bg-[color:var(--lounge-gold)]' : 'bg-white/20'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-display italic text-base leading-tight">{m.name}</p>
                          {isCurrent && (
                            <Check className="w-3.5 h-3.5 gold-text flex-shrink-0" strokeWidth={2} />
                          )}
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.2em] gold-text font-body mt-0.5">
                          {m.vibe}
                        </p>
                        <p className="text-[11px] text-[color:var(--lounge-text-muted)] font-body mt-1 leading-relaxed">
                          {m.description}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
