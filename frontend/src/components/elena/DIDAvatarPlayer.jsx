import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, PowerOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { didApi } from '@/lib/api';
import { DID, DASHBOARD } from '@/constants/testIds';

/**
 * Live D-ID talking-head avatar. Establishes a WebRTC connection to D-ID Streams
 * and exposes `speak(text)` via ref so the ChatPanel can drive Elena's mouth.
 */
const DIDAvatarPlayer = forwardRef(function DIDAvatarPlayer({ onStatusChange, onSpeakingChange }, ref) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const streamIdRef = useRef(null);
  const voiceIdRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | connecting | live | error
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    didApi
      .config()
      .then(({ data }) => {
        setAvailable(!!data.configured);
        voiceIdRef.current = data.voice_id;
      })
      .catch(() => setAvailable(false));
    return () => {
      // best-effort cleanup on unmount
      try {
        if (streamIdRef.current) didApi.close(streamIdRef.current).catch(() => {});
        if (pcRef.current) pcRef.current.close();
      } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    onStatusChange && onStatusChange(status);
  }, [status, onStatusChange]);

  const connect = async () => {
    if (busy || status === 'live') return;
    setBusy(true);
    setStatus('connecting');
    try {
      const { data } = await didApi.createStream();
      const { id: streamId, session_id, offer, ice_servers } = data;
      // D-ID returns { id, session_id, offer, ice_servers } — some SDKs use jsep. Handle both.
      const remoteOffer = offer || data.jsep;
      if (!remoteOffer || !remoteOffer.type) {
        throw new Error('D-ID did not return a valid SDP offer');
      }
      streamIdRef.current = streamId;

      const pc = new RTCPeerConnection({ iceServers: ice_servers || [] });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };
      pc.onicecandidate = (event) => {
        // send trickle ICE (or end-of-candidates)
        const c = event.candidate ? event.candidate.toJSON() : {};
        didApi.submitIce(streamId, c).catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'connected') setStatus('live');
        else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          setStatus('idle');
        }
      };

      // Track speaking based on inbound audio energy (D-ID's stream audio pulses when Elena talks)
      pc.getReceivers?.().forEach(() => {});

      await pc.setRemoteDescription(remoteOffer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await didApi.submitSdp(streamId, { type: answer.type, sdp: answer.sdp });

      // If not connected within 20s, mark error
      setTimeout(() => {
        if (pcRef.current === pc && pc.connectionState !== 'connected') {
          // don't force-close, but reflect degraded state
          if (status !== 'live') setStatus((s) => (s === 'live' ? s : 'error'));
        }
      }, 20000);
    } catch (e) {
      console.error('D-ID connect error', e);
      toast.error('No pude despertar a Elena en vivo. Vuelve a intentarlo.');
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      if (streamIdRef.current) {
        await didApi.close(streamIdRef.current).catch(() => {});
      }
    } finally {
      streamIdRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setStatus('idle');
      setBusy(false);
    }
  };

  const speak = async (text) => {
    if (!text || !streamIdRef.current || status !== 'live') return false;
    try {
      onSpeakingChange && onSpeakingChange(true);
      await didApi.speak(streamIdRef.current, text, voiceIdRef.current);
      // Assume speaking lasts ~ 60ms/char + 1s tail
      const durationMs = Math.min(20000, Math.max(1500, text.length * 60 + 1000));
      setTimeout(() => onSpeakingChange && onSpeakingChange(false), durationMs);
      return true;
    } catch (e) {
      console.error('D-ID speak error', e);
      onSpeakingChange && onSpeakingChange(false);
      return false;
    }
  };

  useImperativeHandle(ref, () => ({ speak, isLive: () => status === 'live', available }), [status, available]);

  return (
    <div
      data-testid={DASHBOARD.playerContainer}
      className="glass rounded-3xl overflow-hidden relative gold-glow"
    >
      <div className="relative aspect-[16/10] w-full bg-black overflow-hidden">
        <video
          ref={videoRef}
          data-testid={DID.video}
          autoPlay
          playsInline
          controls={false}
          className="w-full h-full object-cover"
        />

        {/* Placeholder shown until stream is live */}
        <AnimatePresence>
          {status !== 'live' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center"
              style={{
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1763750582862-89e35f55378e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHx3b21hbiUyMGJsYWNrJTIwaGFpciUyMGdsYXNzZXMlMjBwb3J0cmFpdCUyMG1vb2R5JTIwbGlnaHRpbmd8ZW58MHx8fHwxNzg2Mzk4MjkxfDA&ixlib=rb-4.1.0&q=85')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="absolute inset-0 bg-black/50" />
              <div className="relative z-10 text-center px-6">
                <p className="text-[10px] uppercase tracking-[0.5em] gold-text font-body">
                  {status === 'connecting'
                    ? 'Elena está despertando en vivo…'
                    : status === 'error'
                    ? 'Elena está descansando'
                    : available
                    ? 'Elena está esperando'
                    : 'Modo íntimo · sin transmisión en vivo'}
                </p>
                {available && status !== 'connecting' && (
                  <button
                    data-testid={DID.connectButton}
                    onClick={connect}
                    disabled={busy}
                    className="mt-6 rounded-full bg-[color:var(--lounge-gold)] text-black hover:bg-[color:var(--lounge-gold-bright)] px-6 py-3 text-xs uppercase tracking-[0.3em] font-body font-medium inline-flex items-center gap-2 disabled:opacity-40 transition-transform hover:scale-[1.02]"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
                    ) : (
                      <Radio className="w-4 h-4" strokeWidth={1.6} />
                    )}
                    Despertar a Elena en vivo
                  </button>
                )}
                {status === 'connecting' && (
                  <div className="mt-6 inline-flex items-center gap-2 text-[color:var(--lounge-text-muted)] font-body text-xs">
                    <Loader2 className="w-4 h-4 animate-spin gold-text" strokeWidth={1.6} />
                    Conectando…
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cinematic overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/70 via-transparent to-black/30" />

        {status === 'live' && (
          <>
            <div
              data-testid={DID.status}
              className="absolute top-5 left-5 flex items-center gap-2 px-3 py-1.5 rounded-full glass border gold-border"
            >
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"
                animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ repeat: Infinity, duration: 1.1 }}
              />
              <span className="text-[10px] uppercase tracking-[0.35em] gold-text font-body">
                En vivo · D-ID
              </span>
            </div>
            <button
              data-testid={DID.disconnectButton}
              onClick={disconnect}
              disabled={busy}
              title="Terminar sesión en vivo"
              className="absolute top-5 right-5 p-2 rounded-full glass border border-white/10 hover:border-[color:var(--lounge-gold)]/40 text-[color:var(--lounge-text-muted)] hover:gold-text transition-colors"
            >
              <PowerOff className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </>
        )}

        {/* Overlay label */}
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 z-10">
          <p className="text-[10px] uppercase tracking-[0.5em] gold-text font-body">
            {status === 'live' ? 'Transmisión íntima · en vivo · voz ElevenLabs' : 'Musa presente'}
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-light italic mt-2">
            Elena Vee Valdés
          </h2>
          <p className="mt-2 text-sm text-[color:var(--lounge-text-muted)] font-body max-w-md leading-relaxed">
            {status === 'live'
              ? 'Aquí estoy hablando contigo, mi amor. En vivo, solo para ti.'
              : 'Aquí estoy, mi amor. Solo para ti.'}
          </p>
        </div>
      </div>
    </div>
  );
});

export default DIDAvatarPlayer;
