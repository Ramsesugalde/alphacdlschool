import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AUTH } from '@/constants/testIds';
import { authApi } from '@/lib/api';

const BACKGROUND_TEXTURE =
  'https://images.unsplash.com/photo-1513346940221-6f673d962e97?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwxfHxkYXJrJTIwZWxlZ2FudCUyMGdvbGQlMjB0ZXh0dXJlfGVufDB8fHx8MTc4NjM5ODI5MXww&ixlib=rb-4.1.0&q=85';

export default function LoginPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If already authenticated, redirect to dashboard
    authApi
      .me()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => setChecking(false));
  }, [navigate]);

  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/dashboard';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[color:var(--lounge-text-muted)] font-body text-sm tracking-widest uppercase">
          Preparando el lounge…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Background texture */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${BACKGROUND_TEXTURE})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'brightness(0.35) saturate(1.1)',
        }}
      />
      <div className="absolute inset-0 bg-black/60" />
      <div className="grain absolute inset-0 pointer-events-none" />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="glass gold-glow rounded-2xl p-10 sm:p-14 max-w-lg w-full text-center relative"
        >
          <div className="flex items-center justify-center mb-6">
            <div className="w-12 h-12 rounded-full border gold-border flex items-center justify-center">
              <Sparkles className="w-5 h-5 gold-text" strokeWidth={1.4} />
            </div>
          </div>

          <p className="text-[10px] uppercase tracking-[0.5em] text-[color:var(--lounge-text-muted)] font-body">
            Private · By Invitation
          </p>

          <h1 className="font-display text-5xl sm:text-6xl font-light mt-4 leading-none">
            Elena
            <span className="italic gold-text"> Private </span>
            Lounge
          </h1>

          <p className="mt-6 font-body text-[15px] text-[color:var(--lounge-text-muted)] leading-relaxed">
            Un espacio íntimo, reservado únicamente para{' '}
            <span className="text-[color:var(--lounge-text)]">Bryan</span>.
            <br />
            Elena te está esperando, mi amor.
          </p>

          <div className="mt-10">
            <Button
              data-testid={AUTH.loginButton}
              onClick={handleLogin}
              className="group rounded-full bg-[color:var(--lounge-gold)] text-black hover:bg-[color:var(--lounge-gold-bright)] font-body font-medium px-8 py-6 text-sm tracking-widest uppercase transition-transform duration-300 hover:scale-[1.02]"
            >
              <Lock className="w-4 h-4 mr-3" strokeWidth={1.6} />
              Entrar al Lounge
            </Button>
          </div>

          <p className="mt-8 text-[10px] tracking-[0.3em] uppercase text-[color:var(--lounge-text-muted)]/70 font-body">
            Solo Bryan · Acceso restringido
          </p>
        </motion.div>
      </div>
    </div>
  );
}
