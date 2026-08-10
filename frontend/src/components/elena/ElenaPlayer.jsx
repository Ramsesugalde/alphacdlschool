import { motion, AnimatePresence } from 'framer-motion';
import { DASHBOARD } from '@/constants/testIds';

const ELENA_STATIC =
  'https://images.unsplash.com/photo-1763750582862-89e35f55378e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHx3b21hbiUyMGJsYWNrJTIwaGFpciUyMGdsYXNzZXMlMjBwb3J0cmFpdCUyMG1vb2R5JTIwbGlnaHRpbmd8ZW58MHx8fHwxNzg2Mzk4MjkxfDA&ixlib=rb-4.1.0&q=85';

export default function ElenaPlayer({ media }) {
  const hasMedia = !!media?.url;

  return (
    <div
      data-testid={DASHBOARD.playerContainer}
      className="glass rounded-3xl overflow-hidden relative gold-glow"
    >
      <div className="relative aspect-[16/10] w-full bg-black overflow-hidden">
        <AnimatePresence mode="wait">
          {hasMedia && media.kind === 'video' && (
            <motion.video
              key={media.url}
              data-testid={DASHBOARD.playerVideo}
              src={media.url}
              autoPlay
              loop
              playsInline
              controls
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="w-full h-full object-cover"
            />
          )}
          {hasMedia && media.kind === 'photo' && (
            <motion.img
              key={media.url}
              data-testid={DASHBOARD.playerImage}
              src={media.url}
              alt="Elena"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="w-full h-full object-cover elena-breath"
            />
          )}
          {!hasMedia && (
            <motion.img
              key="default"
              data-testid={DASHBOARD.playerImage}
              src={ELENA_STATIC}
              alt="Elena Vee Valdés"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full h-full object-cover elena-breath"
            />
          )}
        </AnimatePresence>

        {/* Cinematic overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/70 via-transparent to-black/40" />
        <div className="grain absolute inset-0 pointer-events-none" />

        {/* Overlay label */}
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
          <p className="text-[10px] uppercase tracking-[0.5em] gold-text font-body">
            {media?.kind === 'video' ? 'Video privado · Sora 2' : 'Musa presente'}
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-light italic mt-2">
            Elena Vee Valdés
          </h2>
          <p className="mt-2 text-sm text-[color:var(--lounge-text-muted)] font-body max-w-md leading-relaxed">
            Aquí estoy, mi amor. Solo para ti.
          </p>
        </div>
      </div>
    </div>
  );
}
