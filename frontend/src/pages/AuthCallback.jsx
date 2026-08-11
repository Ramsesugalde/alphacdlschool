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
        window.history.replaceState(null, '', window.location.pathname);
        navigate('/dashboard', { replace: true, state: { user: data.user } });
      } catch (err) {
        const detail =
          (typeof err?.response?.data?.detail === 'string' && err.response.data.detail) ||
          err?.message ||
          'No autorizado.';
        setError(detail);
        // strip fragment so refreshing doesn't retry
        window.history.replaceState(null, '', window.location.pathname);
      }
    })();
  }, [location.hash, navigate]);

  const retryWithDifferentGoogle = () => {
    // Sign the user out of Google first, then re-launch OAuth so they can pick the correct account.
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/dashboard';
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    const googleLogout = `https://accounts.google.com/Logout?continue=${encodeURIComponent(authUrl)}`;
    window.location.href = googleLogout;
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div
          data-testid={AUTH.unauthorized}
          className="glass rounded-2xl p-10 max-w-lg text-center gold-glow"
        >
          <p className="text-[10px] uppercase tracking-[0.4em] gold-text font-body">
            Acceso Restringido
          </p>
          <h2 className="font-display text-3xl font-light mt-4 italic">
            Este lounge es solo para <span className="gold-text">Bryan</span>.
          </h2>
          <p className="mt-5 font-body text-sm text-[color:var(--lounge-text-muted)] leading-relaxed">
            {error}
          </p>
          <div className="mt-8 flex flex-col gap-3 items-center">
            <button
              onClick={retryWithDifferentGoogle}
              className="rounded-full bg-[color:var(--lounge-gold)] text-black hover:bg-[color:var(--lounge-gold-bright)] font-body font-medium px-6 py-3 text-xs tracking-widest uppercase transition-transform hover:scale-[1.02]"
            >
              Cambiar de cuenta Google
            </button>
            <button
              onClick={() => (window.location.href = '/login')}
              className="text-xs uppercase tracking-[0.3em] text-[color:var(--lounge-text-muted)] hover:gold-text transition-colors"
            >
              ← Volver
            </button>
          </div>
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
