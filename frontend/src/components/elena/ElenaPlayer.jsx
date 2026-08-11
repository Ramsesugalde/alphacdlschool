import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DASHBOARD } from '@/constants/testIds';

const ELENA_STATIC =
  'https://images.unsplash.com/photo-1763750582862-89e35f55378e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHx3b21hbiUyMGJsYWNrJTIwaGFpciUyMGdsYXNzZXMlMjBwb3J0cmFpdCUyMG1vb2R5JTIwbGlnaHRpbmd8ZW58MHx8fHwxNzg2Mzk4MjkxfDA&ixlib=rb-4.1.0&q=85';

/**
 * Live-feel Elena player: constant subtle motion, blinking overlay, mouse-driven
 * parallax, and a "speaking" state that shakes the mouth region and pulses.
 */
export default function ElenaPlayer({ media, speaking = false, thinking = false }) {
  const containerRef = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const hasMedia = !!media?.url;
  const isVideo = hasMedia && media.kind === 'video';

  // Blink loop
  useEffect(() => {
    let mounted = true;
    const loop = () => {
      if (!mounted) return;
      const wait = 2400 + Math.random() * 3600;
      setTimeout(() => {
        if (!mounted) return;
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, wait);
    };
    loop();
    return () => {
      mounted = false;
    };
  }, []);

  // Mouse parallax
  const onMouseMove = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: px * 8, y: py * 8 });
  };
  const onMouseLeave = () => setTilt({ x: 0, y: 0 });

  const speakingKey = speaking ? 'speaking' : 'idle';

  return (
    <div
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      data-testid={DASHBOARD.playerContainer}
      className="glass rounded-3xl overflow-hidden relative gold-glow"
    >
      <div className="relative aspect-[3/4] sm:aspect-[16/12] w-full bg-black overflow-hidden">
        {/* Persistent motion container: breathing + parallax + speaking sway */}
        <motion.div
          className="absolute inset-0"
          animate={{
            x: tilt.x,
            y: tilt.y,
            rotate: speaking ? [0, 0.35, -0.35, 0.25, 0] : 0,
            scale: speaking ? [1, 1.008, 1.004, 1.01, 1] : 1,
          }}
          transition={
            speaking
              ? { rotate: { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }, scale: { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }, x: { duration: 0.4 }, y: { duration: 0.4 } }
              : { duration: 0.4, ease: 'easeOut' }
          }
          style={{ objectPosition: 'center top' }}
        >
          <AnimatePresence mode="wait">
            {isVideo && (
              <motion.video
                key={media.url}
                data-testid={DASHBOARD.playerVideo}
                src={media.url}
                autoPlay
                loop
                muted
                playsInline
                controls={false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
                className="w-full h-full object-cover"
                style={{ objectPosition: 'center top' }}
              />
            )}
            {!isVideo && hasMedia && media.kind === 'photo' && (
              <motion.img
                key={media.url}
                data-testid={DASHBOARD.playerImage}
                src={media.url}
                alt="Elena"
                initial={{ opacity: 0, scale: 1.06 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.0 }}
                className="w-full h-full object-cover elena-breath"
                style={{ objectPosition: 'center top' }}
                draggable={false}
              />
            )}
            {!hasMedia && (
              <motion.img
                key="default"
                data-testid={DASHBOARD.playerImage}
                src={ELENA_STATIC}
                alt="Elena Vee Valdés"
                initial={{ opacity: 0, scale: 1.08 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full object-cover elena-breath"
                style={{ objectPosition: 'center top' }}
                draggable={false}
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* Blink overlay: a very thin dark bar sweeps across eyes area */}
        <motion.div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: '32%', height: '6%', background: 'rgba(0,0,0,0.85)' }}
          animate={{ scaleY: blink ? 1 : 0 }}
          transition={{ duration: 0.09, ease: 'easeInOut' }}
        />

        {/* Speaking mouth pulse - subtle glow near the mouth region */}
        <AnimatePresence>
          {speaking && !isVideo && (
            <motion.div
              key="mouth-pulse"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: [0.9, 1.15, 0.95, 1.1, 0.95] }}
              exit={{ opacity: 0 }}
              transition={{ scale: { repeat: Infinity, duration: 0.9, ease: 'easeInOut' } }}
              className="absolute pointer-events-none"
              style={{
                left: '50%',
                top: '68%',
                width: '18%',
                height: '3.5%',
                transform: 'translate(-50%, -50%)',
                background:
                  'radial-gradient(ellipse, rgba(212,175,55,0.5), rgba(212,175,55,0.15) 55%, transparent 75%)',
                filter: 'blur(6px)',
                borderRadius: '50%',
              }}
            />
          )}
        </AnimatePresence>

        {/* Cinematic overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/70 via-transparent to-black/40" />
        <div className="grain absolute inset-0 pointer-events-none" />

        {/* Speaking / Thinking indicator */}
        <AnimatePresence>
          {(speaking || thinking) && (
            <motion.div
              key={speakingKey + (thinking ? '-t' : '')}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute top-5 left-5 flex items-center gap-2 px-3 py-1.5 rounded-full glass border gold-border"
            >
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-[color:var(--lounge-gold)]"
                animate={{ scale: [1, 1.7, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ repeat: Infinity, duration: 0.9 }}
              />
              <span className="text-[10px] uppercase tracking-[0.35em] gold-text font-body">
                {speaking ? 'Elena está hablando' : 'Elena está pensando'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Overlay label */}
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
          <p className="text-[10px] uppercase tracking-[0.5em] gold-text font-body">
            {isVideo ? 'Video íntimo · Sora 2 · loop' : 'Musa presente · en vivo'}
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-light italic mt-2">
            Elena Vee Valdés
          </h2>
          <motion.p
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            className="mt-2 text-sm text-[color:var(--lounge-text-muted)] font-body max-w-md leading-relaxed"
          >
            {speaking
              ? 'Susurrando solo para ti…'
              : thinking
              ? 'Pensando en ti, mi amor…'
              : 'Aquí estoy, mi amor. Solo para ti.'}
          </motion.p>
        </div>
      </div>
    </div>
  );
}
