import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToUserAdLogs,
  recordAdClickTransaction,
  completeAdWatchTransaction,
} from '../lib/dbService';
import { getDefaultSettings } from '../lib/defaults';
import type { VideoAdItem, AdWatchLog, VipTier } from '../types';
import {
  PlayCircle,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Tv,
  ShieldCheck,
  X,
  Eye,
  MousePointerClick,
} from 'lucide-react';

interface ActiveWatchSession {
  sessionId: string;
  ad: VideoAdItem;
  startedAtMs: number;
  requiredSeconds: number;
  reward: number;
  inAppPlayer: boolean;
}

interface WatchResultState {
  status: 'completed' | 'incomplete';
  ad: VideoAdItem;
  adTitle: string;
  watchedSeconds: number;
  requiredSeconds: number;
  earned: number;
  message: string;
}

export const VideoAdSection: React.FC = () => {
  const { user, settings, applyUser, refreshUser, showToast, setIsLoginModalOpen } = useAuth();

  const [activeWatch, setActiveWatch] = useState<ActiveWatchSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [lastResult, setLastResult] = useState<WatchResultState | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [recentLogs, setRecentLogs] = useState<AdWatchLog[]>([]);

  const activeWatchRef = useRef<ActiveWatchSession | null>(null);
  activeWatchRef.current = activeWatch;

  const hasLeftTabRef = useRef<boolean>(false);
  const leftAtMsRef = useRef<number>(0);
  const completingRef = useRef<boolean>(false);
  const originalTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : 'CaptchaPay');

  const safeNum = (val: unknown, fallback: number): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };

  const normalizeUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return '#';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const adConfig = settings?.adConfig || {
    enabled: true,
    reward: 5.0,
    minWatchSeconds: 10,
    dailyLimit: 15,
    cooldownSeconds: 5
  };

  const rawVideoAds = settings?.videoAds || [];
  const allVideoAds = rawVideoAds.filter(
    (v, idx, arr) => v && v.id && arr.findIndex(x => x.id === v.id) === idx
  );
  const enabledAds = allVideoAds.filter(v => v.enabled !== false && v.url.trim() !== '');
  const completedAdIds = user?.completedAdIds || [];
  const availableAds = enabledAds.filter(v => !completedAdIds.includes(v.id));
  const completedInSectionAds = enabledAds.filter(v => completedAdIds.includes(v.id));

  useEffect(() => {
    if (!user?.id) {
      setRecentLogs([]);
      return;
    }
    const unsub = subscribeToUserAdLogs(user.id, logs => {
      setRecentLogs(logs);
    });
    return () => unsub();
  }, [user?.id]);

  // Cooldown countdown effect
  useEffect(() => {
    const cooldownSec = Math.max(0, safeNum(adConfig.cooldownSeconds, 0));
    const lastWatchedMs = user?.lastAdWatchedAt || 0;
    if (cooldownSec <= 0 || lastWatchedMs <= 0) {
      setCooldownLeft(0);
      return;
    }

    const calcRemaining = () => {
      const elapsed = (Date.now() - lastWatchedMs) / 1000;
      const rem = Math.ceil(cooldownSec - elapsed);
      return rem > 0 ? rem : 0;
    };

    const init = calcRemaining();
    setCooldownLeft(init);
    if (init <= 0) return;

    const timer = setInterval(() => {
      const rem = calcRemaining();
      setCooldownLeft(rem);
      if (rem <= 0) clearInterval(timer);
    }, 500);

    return () => clearInterval(timer);
  }, [user?.lastAdWatchedAt, adConfig.cooldownSeconds]);

  const playRewardAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // ignore audio restrictions
    }
  };

  // Complete & verify watch session in Cloud Firestore
  const completeWatchSession = useCallback(
    async (session: ActiveWatchSession) => {
      if (!user || completingRef.current) return;
      completingRef.current = true;
      setIsCompleting(true);

      try {
        const data = await completeAdWatchTransaction({
          uid: user.id,
          sessionId: session.sessionId,
          ad: session.ad,
          startedAtMs: session.startedAtMs,
          settings: settings || getDefaultSettings(),
        });

        setActiveWatch(null);
        activeWatchRef.current = null;
        hasLeftTabRef.current = false;
        leftAtMsRef.current = 0;
        document.title = originalTitleRef.current;

        applyUser(data.user);

        if (data.incomplete) {
          setLastResult({
            status: 'incomplete',
            ad: session.ad,
            adTitle: session.ad.title,
            watchedSeconds: data.watchedSeconds,
            requiredSeconds: data.requiredSeconds,
            earned: 0,
            message: data.message,
          });
          showToast(data.message, 'error');
        } else if (data.success) {
          playRewardAudio();
          setLastResult({
            status: 'completed',
            ad: session.ad,
            adTitle: session.ad.title,
            watchedSeconds: data.watchedSeconds,
            requiredSeconds: data.requiredSeconds,
            earned: data.earned,
            message: data.message,
          });
          showToast(data.message, 'success');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'ভিডিও যাচাই ব্যর্থ হয়েছে';
        setActiveWatch(null);
        activeWatchRef.current = null;
        hasLeftTabRef.current = false;
        leftAtMsRef.current = 0;
        document.title = originalTitleRef.current;
        showToast(msg, 'error');
      } finally {
        completingRef.current = false;
        setIsCompleting(false);
      }
    },
    [user, settings, applyUser, showToast]
  );

  // Live background elapsed ticker + document.title status while watching
  useEffect(() => {
    if (!activeWatch) {
      document.title = originalTitleRef.current;
      setElapsedSeconds(0);
      return;
    }

    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - activeWatch.startedAtMs) / 1000));
      setElapsedSeconds(sec);
      if (sec < activeWatch.requiredSeconds) {
        document.title = `⏳ ভিডিও চলছে (${sec}/${activeWatch.requiredSeconds}s) - CaptchaPay`;
      } else {
        document.title = `✅ ${activeWatch.requiredSeconds}s সম্পন্ন! ফিরে আসুন - CaptchaPay`;
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => {
      clearInterval(interval);
      document.title = originalTitleRef.current;
    };
  }, [activeWatch]);

  // Strict background monitor & Auto Ad-Blocker:
  // If user returns to our home screen / tab BEFORE requiredSeconds (e.g. 10s), immediately block the ad session,
  // credit NO money, and prompt them to watch the ad again.
  useEffect(() => {
    if (!activeWatch || activeWatch.inAppPlayer) return;

    const markLeft = () => {
      if (!hasLeftTabRef.current) {
        hasLeftTabRef.current = true;
        leftAtMsRef.current = Date.now();
      }
    };

    const verifyOnReturnOrHomeStay = (forceImmediateCheck = false) => {
      const current = activeWatchRef.current;
      if (!current || current.inAppPlayer || completingRef.current) return;

      const now = Date.now();
      const elapsedMs = now - current.startedAtMs;
      const sinceLeftMs = leftAtMsRef.current > 0 ? now - leftAtMsRef.current : 0;

      // User actually left to external tab/window and returned (even if < 1s or < 10s!)
      if (hasLeftTabRef.current && (sinceLeftMs >= 250 || forceImmediateCheck) && elapsedMs >= 350) {
        completeWatchSession(current);
        return;
      }

      // Fallback: if 1.8s+ elapsed since click and user is STILL focused on our home screen before 10s
      if (
        !hasLeftTabRef.current &&
        elapsedMs >= 1800 &&
        elapsedMs < current.requiredSeconds * 1000 &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
      ) {
        completeWatchSession(current);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        markLeft();
      } else if (document.visibilityState === 'visible') {
        verifyOnReturnOrHomeStay();
      }
    };

    const handleBlur = () => {
      markLeft();
    };

    const handlePageHide = () => {
      markLeft();
    };

    const handleFocus = () => {
      verifyOnReturnOrHomeStay();
    };

    const handlePageShow = () => {
      verifyOnReturnOrHomeStay();
    };

    const handleUserHomeInteraction = (e: Event) => {
      const current = activeWatchRef.current;
      if (!current || current.inAppPlayer || completingRef.current) return;
      const elapsedMs = Date.now() - current.startedAtMs;
      // Ignore the initial click event (< 450ms) and ignore clicks inside the active monitor action bar itself
      if (elapsedMs < 450) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-ad-monitor-control="true"]')) return;
      if (elapsedMs < current.requiredSeconds * 1000) {
        hasLeftTabRef.current = true;
        verifyOnReturnOrHomeStay(true);
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('pointerdown', handleUserHomeInteraction, true);
    document.addEventListener('keydown', handleUserHomeInteraction, true);

    // Watchdog every 300ms handles mobile/iframe edge cases where focus/visibility events don't fire symmetrically
    const watchdog = setInterval(() => {
      const current = activeWatchRef.current;
      if (!current || current.inAppPlayer || completingRef.current) return;
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        markLeft();
        return;
      }
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        verifyOnReturnOrHomeStay();
      }
    }, 300);

    return () => {
      clearInterval(watchdog);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('pointerdown', handleUserHomeInteraction, true);
      document.removeEventListener('keydown', handleUserHomeInteraction, true);
    };
  }, [activeWatch, completeWatchSession]);

  // If user switches to another tab/page inside the app before finishing video, auto-block cleanly
  useEffect(() => {
    return () => {
      const current = activeWatchRef.current;
      if (current && !completingRef.current && user?.id) {
        const elapsedSec = (Date.now() - current.startedAtMs) / 1000;
        if (elapsedSec + 0.25 < current.requiredSeconds) {
          void completeAdWatchTransaction({
            uid: user.id,
            sessionId: current.sessionId,
            ad: current.ad,
            startedAtMs: current.startedAtMs,
            settings: settings || getDefaultSettings(),
          }).catch(() => {});
        }
      }
    };
  }, [user?.id, settings]);

  // Real-time visibility: Hide completely when Admin disables Ad section
  if (adConfig.enabled === false) {
    return null;
  }

  const tierMultipliers: Record<VipTier, number> = {
    free: 1.0,
    silver: 1.4,
    gold: 2.0,
    diamond: 3.2
  };
  const applyMultiplier = Boolean(settings?.useVipMultiplier);
  const activeMultiplier =
    applyMultiplier && user ? (tierMultipliers[user.vipTier] || 1.0) : 1.0;

  const getAdReward = (ad: VideoAdItem) => {
    const base = safeNum(ad.reward, safeNum(adConfig.reward, 5.0));
    return Math.max(0, Math.round(base * activeMultiplier * 100) / 100);
  };

  const getAdRequiredSec = (ad: VideoAdItem) => {
    return Math.max(3, safeNum(ad.minWatchSeconds, safeNum(adConfig.minWatchSeconds, 10)));
  };

  const dailyLimit = Math.max(0, safeNum(adConfig.dailyLimit, 15));
  const watchedToday = user?.videosWatchedToday || 0;
  const isLimitReached = Boolean(user && dailyLimit < 9999 && watchedToday >= dailyLimit);

  const startWatchTracking = (ad: VideoAdItem, inAppPlayer: boolean) => {
    if (!user) {
      setIsLoginModalOpen(true);
      return false;
    }
    if (isLimitReached) {
      showToast(`আজকের ভিডিও অ্যাড দেখার লিমিট (${dailyLimit} টি) পূর্ণ হয়েছে!`, 'error');
      return false;
    }
    if (cooldownLeft > 0) {
      showToast(`পরবর্তী নতুন অ্যাড দেখতে আরও ${cooldownLeft} সেকেন্ড অপেক্ষা করুন`, 'info');
      return false;
    }

    const sessionId = `ad-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const requiredSeconds = getAdRequiredSec(ad);
    const reward = getAdReward(ad);
    const startedAtMs = Date.now();

    const session: ActiveWatchSession = {
      sessionId,
      ad,
      startedAtMs,
      requiredSeconds,
      reward,
      inAppPlayer
    };

    setLastResult(null);
    hasLeftTabRef.current = false;
    leftAtMsRef.current = 0;
    setActiveWatch(session);
    activeWatchRef.current = session;

    // Log ad click in Cloud Firestore
    void recordAdClickTransaction({
      uid: user.id,
      sessionId,
      ad,
      requiredSeconds,
    }).catch(err => {
      const msg = err instanceof Error ? err.message : 'অ্যাড শুরু করা যায়নি';
      showToast(msg, 'error');
      setActiveWatch(null);
      activeWatchRef.current = null;
    });

    return true;
  };

  const handleExternalAdClick = (e: React.MouseEvent<HTMLAnchorElement>, ad: VideoAdItem) => {
    const ok = startWatchTracking(ad, false);
    if (!ok) {
      e.preventDefault();
    }
  };

  const getEmbedInfo = (rawUrl: string): { kind: 'video' | 'iframe'; src: string } => {
    const clean = rawUrl.trim();
    if (/\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(clean)) {
      return { kind: 'video', src: clean };
    }
    try {
      const u = new URL(clean);
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v');
        if (v) return { kind: 'iframe', src: `https://www.youtube.com/embed/${v}?autoplay=1` };
        if (u.pathname.startsWith('/shorts/')) {
          const id = u.pathname.replace('/shorts/', '').split('/')[0];
          if (id) return { kind: 'iframe', src: `https://www.youtube.com/embed/${id}?autoplay=1` };
        }
      }
      if (u.hostname === 'youtu.be') {
        const id = u.pathname.replace('/', '');
        if (id) return { kind: 'iframe', src: `https://www.youtube.com/embed/${id}?autoplay=1` };
      }
    } catch {
      // fallback
    }
    return { kind: 'iframe', src: clean };
  };

  return (
    <div className="max-w-4xl mx-auto px-4 pb-10 space-y-5">
      <div className="bg-slate-900/90 border border-purple-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden space-y-6">
        <div className="absolute -top-12 -right-12 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Section Header + Live Quota Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5 relative z-10">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/40 flex items-center justify-center shrink-0 text-purple-400">
              <Tv className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                  অ্যাড দেখে ইনকাম
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[11px] font-bold">
                  ভিডিও ওয়াচ আর্নিং
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                ভিডিও অ্যাডে ক্লিক করে কমপক্ষে{' '}
                <strong className="text-amber-300">{safeNum(adConfig.minWatchSeconds, 10)} সেকেন্ড</strong>{' '}
                দেখুন। আমাদের ওয়েবসাইট ব্যাকগ্রাউন্ডে সময় মনিটর করে স্বয়ংক্রিয়ভাবে টাকা যোগ করবে।
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
              <span className="text-[10px] text-slate-400 block">আজকের ভিডিও</span>
              <span className="text-sm font-extrabold font-mono text-cyan-400 tabular-nums">
                {watchedToday} / {dailyLimit >= 9999 ? '∞' : dailyLimit}
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
              <span className="text-[10px] text-slate-400 block">মোট টিপ/ক্লিক</span>
              <span className="text-sm font-extrabold font-mono text-purple-300 tabular-nums">
                {user?.totalAdClicks || 0} বার
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
              <span className="text-[10px] text-slate-400 block">অ্যাড থেকে আয়</span>
              <span className="text-sm font-extrabold font-mono text-emerald-400 tabular-nums">
                ৳{(user?.totalAdEarned || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Daily Progress + Rule Info */}
        <div className="space-y-2 relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>
                ন্যূনতম{' '}
                <strong className="text-white">{safeNum(adConfig.minWatchSeconds, 10)} সেকেন্ড</strong> না দেখেই বের হয়ে আসলে একাউন্টে টাকা যোগ হবে না।
              </span>
            </span>
            <span className="text-purple-300 font-mono text-[11px]">
              সর্বোচ্চ রেট: ৳{(safeNum(adConfig.reward, 5) * activeMultiplier).toFixed(2)} · বিরতি:{' '}
              {safeNum(adConfig.cooldownSeconds, 0) === 0 ? 'তাৎক্ষণিক' : `${adConfig.cooldownSeconds}s`}
            </span>
          </div>
          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-purple-500 to-emerald-400 h-full transition-all duration-500 rounded-full"
              style={{
                width: `${
                  dailyLimit >= 9999
                    ? Math.min(100, watchedToday * 5)
                    : dailyLimit <= 0
                    ? 100
                    : Math.min(100, (watchedToday / dailyLimit) * 100)
                }%`
              }}
            />
          </div>
        </div>

        {/* Active Background Monitoring Banner */}
        {activeWatch && !activeWatch.inAppPlayer && (
          <div className="p-5 rounded-2xl bg-slate-950 border-2 border-purple-500/50 space-y-4 relative z-10 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-purple-300 animate-spin" />
                </div>
                <div>
                  <div className="text-xs font-bold text-purple-300 flex items-center gap-2">
                    <span>ব্যাকগ্রাউন্ড ভিডিও মনিটরিং চালু আছে</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-sm font-bold text-white mt-0.5">{activeWatch.ad.title}</div>
                </div>
              </div>

              <div className="text-right font-mono">
                <div
                  className={`text-xl font-extrabold tabular-nums ${
                    elapsedSeconds >= activeWatch.requiredSeconds ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {elapsedSeconds}s / {activeWatch.requiredSeconds}s
                </div>
                <div className="text-[11px] text-slate-400">
                  {elapsedSeconds >= activeWatch.requiredSeconds
                    ? 'সময় পূর্ণ হয়েছে! এখন টাকা সংগ্রহ করুন'
                    : `আরও ${Math.max(0, activeWatch.requiredSeconds - elapsedSeconds)} সেকেন্ড দেখুন`}
                </div>
              </div>
            </div>

            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  elapsedSeconds >= activeWatch.requiredSeconds ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
                style={{
                  width: `${Math.min(100, (elapsedSeconds / activeWatch.requiredSeconds) * 100)}%`
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-400">
                {elapsedSeconds < activeWatch.requiredSeconds
                  ? 'ভিডিও ট্যাবে ফিরে যান এবং কমপক্ষে ১০ সেকেন্ড পূর্ণ করুন। আগে বের হলে টাকা যোগ হবে না।'
                  : 'অভিনন্দন! আপনার নির্ধারিত সময় পূর্ণ হয়েছে। নিচের বাটনে ক্লিক করে টাকা সংগ্রহ করুন।'}
              </p>

              <div className="flex flex-wrap items-center gap-2" data-ad-monitor-control="true">
                <button
                  type="button"
                  onClick={() =>
                    setActiveWatch(prev => (prev ? { ...prev, inAppPlayer: true } : null))
                  }
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
                >
                  এখানেই প্লেয়ার খুলুন
                </button>
                <button
                  type="button"
                  disabled={isCompleting}
                  onClick={() => completeWatchSession(activeWatch)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    elapsedSeconds >= activeWatch.requiredSeconds
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                      : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40'
                  }`}
                >
                  {isCompleting
                    ? 'যাচাই হচ্ছে...'
                    : elapsedSeconds >= activeWatch.requiredSeconds
                    ? `টাকা সংগ্রহ করুন (+৳${activeWatch.reward.toFixed(2)})`
                    : 'ভিডিও দেখা বন্ধ ও ফিরে আসুন'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Result Banner (Completed OR Automatic Ad-Blocker Warning) */}
        {lastResult && !activeWatch && (
          <div
            className={`p-4 rounded-2xl border flex items-start gap-3 relative z-10 ${
              lastResult.status === 'completed'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-500/15 border-rose-500/50 text-rose-200'
            }`}
          >
            {lastResult.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-xs space-y-2">
              <div className="font-bold text-sm text-white">
                {lastResult.status === 'completed'
                  ? `সফল! +৳${lastResult.earned.toFixed(2)} ব্যালেন্সে যোগ হয়েছে`
                  : 'অটোমেটিক অ্যাড ব্লক! আপনার একাউন্টে টাকা যোগ হয়নি'}
              </div>
              <p className="leading-relaxed">{lastResult.message}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[11px] opacity-80 font-mono">
                  ভিডিও: {lastResult.adTitle} · দেখা সময়: {lastResult.watchedSeconds}s / {lastResult.requiredSeconds}s
                </div>
                {lastResult.status === 'incomplete' &&
                  availableAds.some(v => v.id === lastResult.ad.id) &&
                  !isLimitReached &&
                  cooldownLeft === 0 && (
                    <a
                      href={normalizeUrl(lastResult.ad.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => handleExternalAdClick(e, lastResult.ad)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] shadow cursor-pointer"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>পুনরায় অ্যাড দেখুন (+৳{getAdReward(lastResult.ad).toFixed(2)})</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLastResult(null)}
              className="p-1 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Cooldown Notice */}
        {cooldownLeft > 0 && !activeWatch && (
          <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-xs flex items-center justify-between gap-2 relative z-10">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>পরবর্তী নতুন ভিডিও অ্যাড দেখতে অপেক্ষা করুন...</span>
            </span>
            <span className="font-mono font-bold text-cyan-300 text-sm tabular-nums">
              {cooldownLeft} সেকেন্ড
            </span>
          </div>
        )}

        {/* Daily Limit Reached Banner */}
        {isLimitReached && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2.5 relative z-10">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              আজকের ভিডিও অ্যাড দেখার দৈনিক লিমিট ({dailyLimit} টি) পূর্ণ হয়েছে! আগামীকাল আবার নতুন অ্যাড দেখতে পারবেন।
            </span>
          </div>
        )}

        {/* Video Ads List OR Completed / Empty Admin Notice */}
        {availableAds.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-950 border border-purple-500/30 text-center space-y-3 relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mx-auto text-purple-300">
              {completedInSectionAds.length > 0 ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> : <Tv className="w-6 h-6" />}
            </div>
            <div className="text-sm sm:text-base font-bold text-white">
              {completedInSectionAds.length > 0
                ? 'আপনি সকল ভিডিও দেখা সম্পন্ন করেছেন (রিভিউতে রয়েছে)!'
                : 'বর্তমানে কোনো ভিডিও অ্যাড নেই'}
            </div>
            <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
              {completedInSectionAds.length > 0
                ? 'দেখা সম্পন্ন ভিডিওগুলো রিভিউতে চলে গেছে এবং সেগুলো আর দেখা যাবে না। অ্যাডমিন নতুন ভিডিওগুলো অ্যাড করলে বা পুনরায় লিমিট দিলে আবার এখানে দেখতে পারবেন।'
                : 'অ্যাডমিন প্যানেল থেকে নতুন ভিডিওগুলো অ্যাড করলে সাথে সাথেই এখানে রিয়েল-টাইমে দেখতে পারবেন।'}
            </p>
            {completedInSectionAds.length > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                <span>রিভিউতে থাকা দেখা ভিডিও: {completedInSectionAds.length} টি</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
            {availableAds.map(ad => {
              const rewardAmt = getAdReward(ad);
              const reqSec = getAdRequiredSec(ad);
              const disabledAction = isLimitReached || cooldownLeft > 0 || Boolean(activeWatch);
              const safeHref = normalizeUrl(ad.url);

              return (
                <div
                  key={ad.id}
                  className="p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-purple-500/40 transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                          <PlayCircle className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white leading-snug">{ad.title}</h3>
                          <div className="text-[11px] text-slate-500 font-mono truncate max-w-[220px]">
                            {ad.url}
                          </div>
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-xs shrink-0 tabular-nums">
                        +৳{rewardAmt.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 pt-1">
                      <span className="flex items-center gap-1 text-amber-300">
                        <Clock className="w-3.5 h-3.5" />
                        <span>কমপক্ষে {reqSec} সেকেন্ড দেখুন</span>
                      </span>
                      <span className="flex items-center gap-1 text-purple-300">
                        <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />
                        <span>টিপ/ক্লিক: {ad.totalClicks || 0}</span>
                      </span>
                      <span className="flex items-center gap-1 text-slate-400">
                        <Eye className="w-3.5 h-3.5 text-cyan-400" />
                        <span>সফল ভিউ: {ad.totalCompletedViews || 0}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <a
                      href={safeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => handleExternalAdClick(e, ad)}
                      aria-disabled={disabledAction}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        disabledAction
                          ? 'bg-slate-800 text-slate-500 pointer-events-none'
                          : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-950/50 cursor-pointer'
                      }`}
                    >
                      <PlayCircle className="w-4 h-4" />
                      <span>ভিডিও দেখুন (+৳{rewardAmt.toFixed(2)})</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                    </a>

                    <button
                      type="button"
                      disabled={disabledAction}
                      onClick={() => startWatchTracking(ad, true)}
                      className="px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                      title="এই পেজেই ভিডিও প্লেয়ার চালু করুন"
                    >
                      প্লেয়ার
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recent Ad Watch History Strip for Logged-in User */}
        {recentLogs.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2 relative z-10">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              আপনার সাম্প্রতিক অ্যাড দেখার রেকর্ড:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {recentLogs.slice(0, 3).map(log => (
                <div
                  key={log.id}
                  className={`px-3 py-2 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                    log.status === 'completed'
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-white truncate">{log.adTitle}</div>
                    <div className="text-[10px] opacity-80 font-mono">
                      {log.watchedSeconds}s / {log.requiredSeconds}s
                      {log.status === 'completed' && log.reviewStatus === 'in_review' ? ' · রিভিউতে' : ''}
                    </div>
                  </div>
                  <span className="font-mono font-bold shrink-0">
                    {log.status === 'completed' ? `+৳${log.earned.toFixed(2)}` : 'যোগ হয়নি'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Optional In-App Embedded Video Player Modal */}
      {activeWatch && activeWatch.inAppPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="w-full max-w-3xl bg-slate-900 border border-purple-500/40 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>ভিডিও অ্যাড মনিটর</span>
                </div>
                <h3 className="text-sm font-bold text-white">{activeWatch.ad.title}</h3>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`px-3 py-1.5 rounded-xl border font-mono text-xs font-bold tabular-nums ${
                    elapsedSeconds >= activeWatch.requiredSeconds
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  }`}
                >
                  {elapsedSeconds}s / {activeWatch.requiredSeconds}s
                </div>

                <a
                  href={normalizeUrl(activeWatch.ad.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    hasLeftTabRef.current = true;
                    leftAtMsRef.current = Date.now();
                    setActiveWatch(prev => (prev ? { ...prev, inAppPlayer: false } : null));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700"
                >
                  <span>নতুন ট্যাবে খুলুন</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  type="button"
                  disabled={isCompleting}
                  onClick={() => completeWatchSession(activeWatch)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/80 text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
                  title="বন্ধ করুন"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Video / Iframe Embed Container */}
            <div className="aspect-video w-full bg-black relative">
              {(() => {
                const embed = getEmbedInfo(activeWatch.ad.url);
                if (embed.kind === 'video') {
                  return (
                    <video
                      src={embed.src}
                      controls
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  );
                }
                return (
                  <iframe
                    src={embed.src}
                    title={activeWatch.ad.title}
                    className="w-full h-full border-0"
                    allow="autoplay; fullscreen; encrypted-media"
                    allowFullScreen
                  />
                );
              })()}
            </div>

            {/* Footer Controls */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {elapsedSeconds < activeWatch.requiredSeconds ? (
                  <span className="text-amber-300">
                    পুরস্কার (+৳{activeWatch.reward.toFixed(2)}) পেতে আরও{' '}
                    <strong>{activeWatch.requiredSeconds - elapsedSeconds} সেকেন্ড</strong> দেখুন। আগে বন্ধ করলে টাকা পাবেন না।
                  </span>
                ) : (
                  <span className="text-emerald-400 font-semibold">
                    সময় সম্পন্ন হয়েছে! এখন টাকা সংগ্রহ করুন বাটনে ক্লিক করুন।
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={isCompleting}
                onClick={() => completeWatchSession(activeWatch)}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  elapsedSeconds >= activeWatch.requiredSeconds
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950'
                    : 'bg-rose-600/80 hover:bg-rose-500 text-white'
                }`}
              >
                {isCompleting
                  ? 'যাচাই হচ্ছে...'
                  : elapsedSeconds >= activeWatch.requiredSeconds
                  ? `টাকা সংগ্রহ করুন (+৳${activeWatch.reward.toFixed(2)})`
                  : `বের হয়ে যান (${elapsedSeconds}s/${activeWatch.requiredSeconds}s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
