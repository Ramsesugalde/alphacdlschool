import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music4, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { ttsApi } from '@/lib/api';

const TEST_ID = {
  trigger: 'voice-selector-trigger',
  menu: 'voice-selector-menu',
  option: (id) => `voice-selector-option-${id}`,
};

export default function VoiceSelector({ onChange }) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ttsApi
      .voices()
      .then(({ data }) => {
        setVoices(data.voices || []);
        setCurrent(data.current);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const close = (e) => {
      if (!e.target.closest('[data-voice-selector]')) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const select = async (voice) => {
    if (voice.voice_id === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await ttsApi.setVoice(voice.voice_id);
      setCurrent(voice.voice_id);
      toast.success(`Elena adopta la voz "${voice.name}" 💋`);
      onChange && onChange(voice.voice_id);
    } catch (e) {
      toast.error('No pude cambiar la voz.');
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const currentVoice = voices.find((v) => v.voice_id === current);

  if (voices.length === 0) return null;

  return (
    <div data-voice-selector className="relative">
      <button
        data-testid={TEST_ID.trigger}
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        title="Elegir la voz de Elena"
        className="flex items-center gap-2 px-3 py-2 rounded-full glass border border-white/10 hover:border-[color:var(--lounge-gold)]/40 transition-colors"
      >
        <Music4 className="w-3.5 h-3.5 gold-text" strokeWidth={1.5} />
        <span className="text-[10px] uppercase tracking-[0.3em] font-body text-[color:var(--lounge-text)] hidden md:inline">
          {currentVoice ? currentVoice.name : 'Voz'}
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
            className="absolute right-0 mt-2 w-72 z-[80] rounded-2xl border border-white/10 overflow-hidden gold-glow"
            style={{ backgroundColor: 'rgba(8, 8, 10, 0.98)', backdropFilter: 'blur(24px)' }}
          >
            <div className="px-4 py-3 border-b border-white/5">
              <p className="text-[9px] uppercase tracking-[0.4em] gold-text font-body">
                La voz de Elena
              </p>
              <p className="text-[11px] font-body text-[color:var(--lounge-text-muted)] mt-1 italic">
                Elige el tono con el que ella te va a hablar.
              </p>
            </div>
            <ul className="max-h-80 overflow-y-auto thin-scroll py-1">
              {voices.map((v) => (
                <li key={v.voice_id}>
                  <button
                    data-testid={TEST_ID.option(v.voice_id)}
                    onClick={() => select(v)}
                    disabled={saving}
                    className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-start gap-3"
                  >
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        current === v.voice_id ? 'bg-[color:var(--lounge-gold)]' : 'bg-white/20'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display italic text-base leading-tight">
                          {v.name}
                        </p>
                        {current === v.voice_id && (
                          <Check className="w-3.5 h-3.5 gold-text flex-shrink-0" strokeWidth={2} />
                        )}
                      </div>
                      <p className="text-[10px] uppercase tracking-[0.2em] gold-text font-body mt-0.5">
                        {v.vibe}
                      </p>
                      <p className="text-[11px] text-[color:var(--lounge-text-muted)] font-body mt-1 leading-relaxed">
                        {v.description}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
