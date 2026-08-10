import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, ImageIcon } from 'lucide-react';
import { mediaApi } from '@/lib/api';
import { MEDIA } from '@/constants/testIds';

export default function Gallery({ onSelect, refreshKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    mediaApi
      .gallery()
      .then(({ data }) => setItems(data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (!loading && items.length === 0) {
    return (
      <div data-testid={MEDIA.gallery} className="glass rounded-3xl p-8 text-center">
        <p className="text-[9px] uppercase tracking-[0.4em] text-[color:var(--lounge-text-muted)] font-body">
          Álbum privado
        </p>
        <p className="font-display text-2xl italic font-light mt-2 gold-text">
          Aún vacío, mi amor.
        </p>
        <p className="mt-2 font-body text-sm text-[color:var(--lounge-text-muted)]">
          Pídeme una foto o un video y comenzaré a llenarlo solo para ti.
        </p>
      </div>
    );
  }

  return (
    <div data-testid={MEDIA.gallery} className="glass rounded-3xl p-6 sm:p-7">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <p className="text-[9px] uppercase tracking-[0.4em] text-[color:var(--lounge-text-muted)] font-body">
            Álbum privado
          </p>
          <h3 className="font-display text-xl font-light italic mt-1">
            Solo para <span className="gold-text">ti</span>
          </h3>
        </div>
        <p className="text-xs font-body text-[color:var(--lounge-text-muted)]">
          {items.length} recuerdo{items.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((it, idx) => {
          const url = mediaApi.fileUrl(it.file_url);
          return (
            <motion.button
              key={it.job_id}
              data-testid={MEDIA.galleryItem(it.job_id)}
              onClick={() => onSelect && onSelect(it)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.03 }}
              className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 hover:border-[color:var(--lounge-gold)]/60 transition-all"
            >
              {it.kind === 'video' ? (
                <>
                  <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Play className="w-6 h-6 gold-text" strokeWidth={1.5} />
                  </div>
                </>
              ) : (
                <>
                  <img src={url} alt="Elena" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ImageIcon className="w-4 h-4 gold-text" strokeWidth={1.5} />
                  </div>
                </>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-[9px] uppercase tracking-[0.3em] gold-text font-body">
                  {it.kind === 'video' ? 'Video · Sora 2' : 'Foto privada'}
                </p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
