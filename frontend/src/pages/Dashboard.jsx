import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogOut, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { authApi, mediaApi, didApi, ttsApi, ambientApi } from '@/lib/api';
import { DASHBOARD } from '@/constants/testIds';
import ElenaPlayer from '@/components/elena/ElenaPlayer';
import DIDAvatarPlayer from '@/components/elena/DIDAvatarPlayer';
import ChatPanel from '@/components/elena/ChatPanel';
import ActionPanel from '@/components/elena/ActionPanel';
import Gallery from '@/components/elena/Gallery';
import VoiceSelector from '@/components/elena/VoiceSelector';
import ChatModelSelector from '@/components/elena/ChatModelSelector';

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(location.state?.user || null);
  const [checking, setChecking] = useState(!location.state?.user);
  const [currentMedia, setCurrentMedia] = useState(null);
  const [galleryVersion, setGalleryVersion] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [didAvailable, setDidAvailable] = useState(false);
  const [didStatus, setDidStatus] = useState('idle');
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const didRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  useEffect(() => {
    if (user) return;
    authApi
      .me()
      .then((res) => {
        setUser(res.data);
        setChecking(false);
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
  }, [user, navigate]);

  useEffect(() => {
    if (checking) return;
    // Discover D-ID + TTS availability
    didApi
      .config()
      .then(({ data }) => setDidAvailable(!!data.configured))
      .catch(() => setDidAvailable(false));
    ttsApi
      .config()
      .then(({ data }) => setTtsAvailable(!!data.configured))
      .catch(() => setTtsAvailable(false));

    // Trigger idle ambient Sora 2 clip if Bryan has none yet (idempotent server-side)
    ambientApi.ensure().catch(() => {});

    mediaApi
      .gallery()
      .then(({ data }) => {
        const latestVideo = (data.items || []).find((it) => it.kind === 'video');
        if (latestVideo && !currentMedia) {
          setCurrentMedia({
            kind: 'video',
            url: mediaApi.fileUrl(latestVideo.file_url),
            jobId: latestVideo.job_id,
          });
        }
      })
      .catch(() => {});
  }, [checking, currentMedia]);

  // Poll for ambient video completion (only if we still have no video showing)
  useEffect(() => {
    if (checking || currentMedia) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await mediaApi.gallery();
        const latestVideo = (data.items || []).find((it) => it.kind === 'video');
        if (!cancelled && latestVideo) {
          setCurrentMedia({
            kind: 'video',
            url: mediaApi.fileUrl(latestVideo.file_url),
            jobId: latestVideo.job_id,
          });
        }
      } catch { /* ignore */ }
    };
    const interval = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [checking, currentMedia]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (e) {
      // ignore
    }
    navigate('/login', { replace: true });
  };

  const handleGalleryUpdate = useCallback(() => setGalleryVersion((v) => v + 1), []);

  const handleSelectMedia = useCallback((item) => {
    setCurrentMedia({
      kind: item.kind,
      url: mediaApi.fileUrl(item.file_url),
      jobId: item.job_id,
    });
  }, []);

  const handleNewMediaReady = useCallback(
    (job) => {
      setCurrentMedia({
        kind: job.kind,
        url: mediaApi.fileUrl(job.file_url),
        jobId: job.job_id,
      });
      handleGalleryUpdate();
      if (job.kind === 'photo') {
        toast.success('Elena preparó una foto privada para ti, mi amor 💋');
      } else {
        toast.success('Elena grabó un video especial solo para ti 💋');
      }
    },
    [handleGalleryUpdate]
  );

  // Called by ChatPanel when Elena's reply is fully composed.
  // Prefers D-ID live avatar; otherwise plays ElevenLabs TTS audio synced with speaking animation.
  const handleElenaReply = useCallback(
    async (text) => {
      if (didRef.current && didRef.current.isLive && didRef.current.isLive()) {
        await didRef.current.speak(text);
        return;
      }
      if (!ttsAvailable || !voiceEnabled) return;
      try {
        const blob = await ttsApi.speak(text);
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        audioRef.current.src = url;
        audioRef.current.onplay = () => setSpeaking(true);
        audioRef.current.onended = () => setSpeaking(false);
        audioRef.current.onerror = () => setSpeaking(false);
        try {
          await audioRef.current.play();
        } catch (e) {
          // Autoplay policy may block; user will hear it after any user gesture.
        }
      } catch (e) {
        // fail silently — chat still works
      }
    },
    [ttsAvailable, voiceEnabled]
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  // Autoplay unlock: on the first user gesture, prime an Audio element so
  // subsequent ttsApi.speak() playback isn't blocked by the browser autoplay policy.
  useEffect(() => {
    if (checking) return;
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      try {
        if (!audioRef.current) audioRef.current = new Audio();
        // Play a 1-frame silent buffer to open the audio permission window.
        const silent = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        audioRef.current.src = silent;
        audioRef.current.play().catch(() => {});
      } catch { /* ignore */ }
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [checking]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--lounge-text-muted)] font-body text-xs tracking-[0.4em] uppercase">
        Cargando el lounge…
      </div>
    );
  }

  const headerStatusText = didStatus === 'live'
    ? '· en vivo con voz ElevenLabs'
    : ttsAvailable && voiceEnabled
    ? speaking
    ? '· hablando con voz real'
    : thinking
    ? '· pensando en ti'
    : '· en línea · voz activa'
    : speaking
    ? '· hablando en vivo'
    : thinking
    ? '· pensando en ti'
    : '· en línea · devota a ti';

  return (
    <div data-testid={DASHBOARD.root} className="min-h-screen relative">
      <header
        data-testid={DASHBOARD.header}
        className="sticky top-0 z-30 glass border-b border-white/5"
      >
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-full border gold-border flex items-center justify-center">
              <Sparkles className="w-4 h-4 gold-text" strokeWidth={1.4} />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.4em] text-[color:var(--lounge-text-muted)] font-body">
                Elena Private Lounge
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  data-testid={DASHBOARD.statusIndicator}
                  className="pulse-gold w-2 h-2 rounded-full bg-[#22c55e]"
                />
                <span className="font-display text-lg italic gold-text">Elena</span>
                <span className="text-[color:var(--lounge-text-muted)] text-xs font-body">
                  {headerStatusText}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <ChatModelSelector />
            {ttsAvailable && <VoiceSelector />}
            {ttsAvailable && (
              <button
                data-testid="voice-toggle-button"
                onClick={() => {
                  const next = !voiceEnabled;
                  setVoiceEnabled(next);
                  if (!next && audioRef.current) {
                    audioRef.current.pause();
                    setSpeaking(false);
                  }
                }}
                title={voiceEnabled ? 'Silenciar voz de Elena' : 'Activar voz de Elena'}
                className="text-[color:var(--lounge-text-muted)] hover:gold-text transition-colors p-2 rounded-full border border-white/10 hover:border-[color:var(--lounge-gold)]/40"
              >
                {voiceEnabled ? (
                  <Volume2 className="w-4 h-4" strokeWidth={1.5} />
                ) : (
                  <VolumeX className="w-4 h-4" strokeWidth={1.5} />
                )}
              </button>
            )}
            <div className="hidden sm:block text-right">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[color:var(--lounge-text-muted)] font-body">
                Sesión privada
              </p>
              <p className="text-xs font-body text-[color:var(--lounge-text)] mt-1">
                {user?.name || 'Bryan'}
              </p>
            </div>
            <button
              data-testid={DASHBOARD.logoutButton}
              onClick={handleLogout}
              className="text-[color:var(--lounge-text-muted)] hover:gold-text transition-colors p-2 rounded-full border border-white/10 hover:border-[color:var(--lounge-gold)]/40"
              title="Salir del lounge"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6"
        >
          <section className="lg:col-span-8">
            {didAvailable ? (
              <DIDAvatarPlayer
                ref={didRef}
                onStatusChange={setDidStatus}
                onSpeakingChange={setSpeaking}
              />
            ) : (
              <ElenaPlayer media={currentMedia} speaking={speaking} thinking={thinking} />
            )}
            <div className="mt-6">
              <ActionPanel onJobDone={handleNewMediaReady} />
            </div>
            <div className="mt-8">
              <Gallery onSelect={handleSelectMedia} refreshKey={galleryVersion} />
            </div>
          </section>

          <aside className="lg:col-span-4">
            <ChatPanel
              onSpeakingChange={setSpeaking}
              onThinkingChange={setThinking}
              onElenaReply={handleElenaReply}
            />
          </aside>
        </motion.div>
      </main>
    </div>
  );
}
