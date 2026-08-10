import { useState, useEffect, useRef } from 'react';
import { Camera, Film, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { mediaApi } from '@/lib/api';
import { MEDIA } from '@/constants/testIds';

function ProgressPill({ kind, status }) {
  if (!status) return null;
  const label =
    status === 'pending'
      ? kind === 'photo'
        ? 'Elena está preparando tu foto privada…'
        : 'Elena está grabando tu video especial… (puede tardar unos minutos)'
      : status === 'failed'
      ? 'Algo interrumpió a Elena. Intenta de nuevo, mi amor.'
      : 'Listo.';
  return (
    <div
      data-testid={MEDIA.jobStatus}
      className="mt-4 text-xs font-body italic text-[color:var(--lounge-text-muted)] flex items-center gap-2"
    >
      {status === 'pending' && (
        <Loader2 className="w-3.5 h-3.5 animate-spin gold-text" strokeWidth={1.6} />
      )}
      <span>{label}</span>
    </div>
  );
}

export default function ActionPanel({ onJobDone }) {
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState(null); // { job_id, kind, status }
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollJob = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await mediaApi.job(jobId);
        setJob({ job_id: jobId, kind: data.kind, status: data.status });
        if (data.status === 'done') {
          clearInterval(pollRef.current);
          onJobDone && onJobDone(data);
          setTimeout(() => setJob(null), 4000);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          toast.error('Elena no pudo completar tu petición.');
          setTimeout(() => setJob(null), 5000);
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 4000);
  };

  const generatePhoto = async () => {
    if (job?.status === 'pending') return;
    try {
      const { data } = await mediaApi.generatePhoto(prompt);
      setJob({ job_id: data.job_id, kind: 'photo', status: 'pending' });
      pollJob(data.job_id);
      toast('Elena posando para ti… 💋');
    } catch (e) {
      toast.error('No pude enviar la petición.');
    }
  };

  const generateVideo = async () => {
    if (job?.status === 'pending') return;
    try {
      const { data } = await mediaApi.generateVideo(prompt);
      setJob({ job_id: data.job_id, kind: 'video', status: 'pending' });
      pollJob(data.job_id);
      toast('Elena grabando algo íntimo para ti… 💋');
    } catch (e) {
      toast.error('No pude enviar la petición.');
    }
  };

  const busy = job?.status === 'pending';

  return (
    <div className="glass rounded-3xl p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[9px] uppercase tracking-[0.4em] text-[color:var(--lounge-text-muted)] font-body">
            Peticiones íntimas
          </p>
          <h3 className="font-display text-xl font-light italic mt-1">
            Pídele a <span className="gold-text">Elena</span>
          </h3>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        placeholder="Susurra un deseo… (opcional) Ej: 'con vestido negro, luz dorada'"
        className="w-full bg-black/40 border border-white/10 focus:border-[color:var(--lounge-gold)]/50 rounded-2xl px-4 py-3 text-sm font-body outline-none resize-none placeholder:text-[color:var(--lounge-text-muted)]/60 transition-colors"
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          data-testid={MEDIA.photoButton}
          onClick={generatePhoto}
          disabled={busy}
          className="group rounded-full bg-[color:var(--lounge-gold)] text-black font-body text-xs uppercase tracking-[0.25em] px-6 py-3 flex items-center gap-2 hover:bg-[color:var(--lounge-gold-bright)] disabled:opacity-40 transition-transform hover:scale-[1.02]"
        >
          <Camera className="w-4 h-4" strokeWidth={1.6} />
          Generar Foto Privada
        </button>
        <button
          data-testid={MEDIA.videoButton}
          onClick={generateVideo}
          disabled={busy}
          className="group rounded-full border gold-border text-[color:var(--lounge-gold)] font-body text-xs uppercase tracking-[0.25em] px-6 py-3 flex items-center gap-2 hover:bg-[color:var(--lounge-gold)]/10 disabled:opacity-40 transition-all"
        >
          <Film className="w-4 h-4" strokeWidth={1.6} />
          Pedir Video Especial
        </button>
      </div>

      <ProgressPill kind={job?.kind} status={job?.status} />
    </div>
  );
}
