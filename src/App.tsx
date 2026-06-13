import { useState, useEffect, useRef, useCallback, type FormEvent, type MouseEvent } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Coins, LogOut, Loader2, Cloud, CloudOff, Sparkles } from 'lucide-react';

interface Profile {
  username: string | null;
  coins: number;
}

interface FloatingPopup {
  id: number;
  x: number;
  y: number;
}

const SYNC_DELAY_MS = 1000;
const INSTANT_SYNC_THRESHOLD = 10;

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [coins, setCoins] = useState(0);
  const [popups, setPopups] = useState<FloatingPopup[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasPendingSync, setHasPendingSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const lastSyncedCoins = useRef(0);
  const coinsRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);

  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const syncCoinsToDb = useCallback(
    async (userId: string) => {
      const coinCount = coinsRef.current;
      if (coinCount === lastSyncedCoins.current || isSyncingRef.current) return false;

      isSyncingRef.current = true;
      setIsSyncing(true);
      setSyncError(null);

      const { error } = await supabase
        .from('profiles')
        .update({
          coins: coinCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      isSyncingRef.current = false;
      setIsSyncing(false);

      if (error) {
        setSyncError(error.message);
        setHasPendingSync(true);
        return false;
      }

      lastSyncedCoins.current = coinCount;

      const remaining = coinsRef.current - lastSyncedCoins.current;
      if (remaining === 0) {
        setHasPendingSync(false);
      } else if (remaining >= INSTANT_SYNC_THRESHOLD) {
        setHasPendingSync(true);
        syncCoinsToDb(userId);
      } else {
        setHasPendingSync(true);
        syncTimerRef.current = setTimeout(() => {
          syncCoinsToDb(userId);
        }, SYNC_DELAY_MS);
      }

      return true;
    },
    [],
  );

  const scheduleSync = useCallback(
    (userId: string) => {
      clearSyncTimer();

      const coinCount = coinsRef.current;
      if (coinCount === lastSyncedCoins.current) {
        setHasPendingSync(false);
        return;
      }

      const unsynced = coinCount - lastSyncedCoins.current;
      setHasPendingSync(true);

      if (unsynced >= INSTANT_SYNC_THRESHOLD) {
        syncCoinsToDb(userId);
        return;
      }

      syncTimerRef.current = setTimeout(() => {
        syncCoinsToDb(userId);
      }, SYNC_DELAY_MS);
    },
    [clearSyncTimer, syncCoinsToDb],
  );

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error, status } = await supabase
      .from('profiles')
      .select('username, coins')
      .eq('id', userId)
      .single();

    if (error && status !== 406) {
      throw error;
    }

    const profile = data as Profile | null;
    const loadedCoins = profile?.coins ?? 0;
    setCoins(loadedCoins);
    lastSyncedCoins.current = loadedCoins;
    setHasPendingSync(false);
    setSyncError(null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      userIdRef.current = currentSession?.user?.id ?? null;
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      userIdRef.current = currentSession?.user?.id ?? null;
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setCoins(0);
      lastSyncedCoins.current = 0;
      setHasPendingSync(false);
      return;
    }

    setLoading(true);
    loadProfile(session.user.id)
      .catch((err: Error) => setSyncError(err.message))
      .finally(() => setLoading(false));
  }, [session, loadProfile]);

  useEffect(() => {
    coinsRef.current = coins;
  }, [coins]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    scheduleSync(userId);

    return clearSyncTimer;
  }, [coins, session, scheduleSync, clearSyncTimer]);

  useEffect(() => {
    return () => {
      const userId = userIdRef.current;
      if (userId && coinsRef.current !== lastSyncedCoins.current) {
        syncCoinsToDb(userId);
      }
    };
  }, [syncCoinsToDb]);

  const handleCoinClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!session) return;

    setCoins((prev) => prev + 1);

    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    const popup: FloatingPopup = {
      id,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    setPopups((prev) => [...prev, popup]);
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
    }, 800);
  };

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      if (authMode === 'register') {
        if (username.trim().length < 3) {
          throw new Error('Имя пользователя должно быть не короче 3 символов');
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username.trim() },
          },
        });

        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Ошибка авторизации');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const userId = session?.user?.id;
    if (userId && coinsRef.current !== lastSyncedCoins.current) {
      clearSyncTimer();
      await syncCoinsToDb(userId);
    }
    await supabase.auth.signOut();
  };

  if (loading && session) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 font-sans overflow-hidden relative">
      <style>{`
        @keyframes float-up {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -120%) scale(1.3); }
        }
        @keyframes coin-pulse {
          0%, 100% { box-shadow: 0 0 40px rgba(251, 191, 36, 0.3), 0 0 80px rgba(251, 191, 36, 0.1); }
          50% { box-shadow: 0 0 60px rgba(251, 191, 36, 0.5), 0 0 120px rgba(251, 191, 36, 0.2); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .animate-float-up { animation: float-up 0.8s ease-out forwards; }
        .animate-coin-pulse { animation: coin-pulse 2s ease-in-out infinite; }
        .animate-shimmer {
          background-size: 200% auto;
          animation: shimmer 3s linear infinite;
        }
      `}</style>

      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-lg tracking-tight">Coin Clicker</span>
          </div>

          {session && (
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 py-8">
        {!session ? (
          /* Auth form */
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Coins className="w-10 h-10 text-amber-900" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Добро пожаловать!</h1>
              <p className="text-slate-400 text-sm">
                {authMode === 'login' ? 'Войдите, чтобы сохранить прогресс' : 'Создайте аккаунт и начните кликать'}
              </p>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Имя пользователя</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="player123"
                    required
                    minLength={3}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Пароль</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all"
                />
              </div>

              {authError && (
                <p className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-amber-950 font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
              >
                {authLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : authMode === 'login' ? (
                  'Войти'
                ) : (
                  'Зарегистрироваться'
                )}
              </button>
            </form>

            <p className="text-center text-sm text-slate-500 mt-6">
              {authMode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError(null);
                }}
                className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                {authMode === 'login' ? 'Регистрация' : 'Войти'}
              </button>
            </p>
          </div>
        ) : (
          /* Game */
          <div className="flex flex-col items-center w-full max-w-lg">
            {/* Balance */}
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-slate-400 mb-1 tracking-wide uppercase">Баланс</p>
              <div className="flex items-center justify-center gap-3">
                <Coins className="w-8 h-8 text-amber-400" />
                <span className="text-5xl font-black tabular-nums bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-transparent animate-shimmer">
                  {coins.toLocaleString('ru-RU')}
                </span>
              </div>
            </div>

            {/* Coin button */}
            <div className="relative">
              <button
                onClick={handleCoinClick}
                className="relative w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600 border-4 border-amber-200/30 shadow-2xl shadow-amber-500/30 active:scale-95 transition-transform duration-100 cursor-pointer animate-coin-pulse group"
                aria-label="Кликнуть монету"
              >
                {/* Inner ring */}
                <div className="absolute inset-3 rounded-full border-2 border-amber-200/20" />
                <div className="absolute inset-6 rounded-full border border-amber-900/20" />

                {/* Coin symbol */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Coins className="w-20 h-20 sm:w-24 sm:h-24 text-amber-900/70 select-none group-active:scale-90 transition-transform drop-shadow-sm" />
                </div>

                {/* Shine effect */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/30 via-transparent to-transparent opacity-60" />

                {/* Floating +1 popups */}
                {popups.map((popup) => (
                  <span
                    key={popup.id}
                    className="absolute pointer-events-none text-2xl font-bold text-amber-300 animate-float-up select-none"
                    style={{ left: popup.x, top: popup.y }}
                  >
                    +1
                  </span>
                ))}
              </button>

              {/* Decorative rings */}
              <div className="absolute -inset-4 rounded-full border border-amber-500/10 pointer-events-none" />
              <div className="absolute -inset-8 rounded-full border border-amber-500/5 pointer-events-none" />
            </div>

            <p className="mt-10 text-slate-500 text-sm text-center">
              Кликай по монете — прогресс сохраняется автоматически
            </p>
          </div>
        )}
      </main>

      {/* Sync status — fixed corner, never blocks clicks */}
      {session && (
        <div className="fixed bottom-4 right-4 z-20 pointer-events-none flex items-center gap-1.5 text-xs text-slate-500 bg-[#0a0a0f]/70 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5">
          {isSyncing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              <span className="text-amber-400">Сохранение...</span>
            </>
          ) : hasPendingSync ? (
            <>
              <Cloud className="w-3 h-3 text-slate-400" />
              <span>Ожидает синхронизации</span>
            </>
          ) : syncError ? (
            <>
              <CloudOff className="w-3 h-3 text-red-400" />
              <span className="text-red-400">{syncError}</span>
            </>
          ) : (
            <>
              <Cloud className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400/80">Сохранено</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
