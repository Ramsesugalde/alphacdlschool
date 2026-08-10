import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '@/lib/api';
import { AUTH } from '@/constants/testIds';

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const processed = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = location.hash || '';
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : null;

    if (!sessionId) {
      navigate('/login', { replace: true });
      return;
    }

    (async () => {
      try {
        const { data } = await authApi.exchange(sessionId);
        // Clear the fragment
        window.history.replaceState(null, '', window.location.pathname);
        navigate('/dashboard', { replace: true, state: { user: data.user } });
      } catch (err) {
        const detail = err?.response?.data?.detail || 'No autorizado.';
        setError(detail);
      }
    })();
  }, [location.hash, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div
          data-testid={AUTH.unauthorized}
          className="glass rounded-2xl p-10 max-w-md text-center"
        >
          <p className="text-[10px] uppercase tracking-[0.4em] gold-text font-body">
            Acceso Restringido
          </p>
          <h2 className="font-display text-3xl font-light mt-4">
            Este lounge es solo para Bryan.
          </h2>
          <p className="mt-4 font-body text-sm text-[color:var(--lounge-text-muted)]">
            {detail(error)}
          </p>
          <button
            onClick={() => (window.location.href = '/login')}
            className="mt-8 text-xs uppercase tracking-[0.3em] gold-text hover:text-[color:var(--lounge-gold-bright)] transition-colors"
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div
        data-testid={AUTH.callbackSpinner}
        className="text-[color:var(--lounge-text-muted)] font-body text-xs tracking-[0.4em] uppercase"
      >
        Elena te está preparando el lounge…
      </div>
    </div>
  );
}

function detail(msg) {
  if (typeof msg === 'string') return msg;
  return 'Acceso restringido.';
}
