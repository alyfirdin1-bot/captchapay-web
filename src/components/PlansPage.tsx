import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDefaultEarningPlans, getDhakaDateKey } from '../lib/defaults';
import {
  claimPlanDailyIncomeTransaction,
  purchaseEarningPlanTransaction,
  subscribeToUserPlans,
} from '../lib/dbService';
import type { EarningPlan, PlanThemeColor, UserPlanSubscription } from '../types';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Coins,
  Crown,
  Gift,
  Layers,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  AlertCircle,
} from 'lucide-react';

interface PlansPageProps {
  onBack: () => void;
  onOpenDeposit: () => void;
}

const THEME_STYLES: Record<
  PlanThemeColor,
  {
    border: string;
    glow: string;
    badgeBg: string;
    iconBg: string;
    priceText: string;
    buttonBg: string;
  }
> = {
  emerald: {
    border: 'border-emerald-500/40 hover:border-emerald-400',
    glow: 'from-emerald-950/50 via-slate-900 to-slate-950',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    iconBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    priceText: 'text-emerald-400',
    buttonBg: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-950/60',
  },
  amber: {
    border: 'border-amber-500/45 hover:border-amber-400',
    glow: 'from-amber-950/45 via-slate-900 to-slate-950',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    iconBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    priceText: 'text-amber-400',
    buttonBg: 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-950/60',
  },
  purple: {
    border: 'border-purple-500/45 hover:border-purple-400',
    glow: 'from-purple-950/45 via-slate-900 to-slate-950',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    iconBg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    priceText: 'text-purple-400',
    buttonBg: 'bg-purple-500 hover:bg-purple-400 text-white shadow-purple-950/60',
  },
  cyan: {
    border: 'border-cyan-500/45 hover:border-cyan-400',
    glow: 'from-cyan-950/45 via-slate-900 to-slate-950',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    iconBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    priceText: 'text-cyan-400',
    buttonBg: 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-950/60',
  },
  rose: {
    border: 'border-rose-500/45 hover:border-rose-400',
    glow: 'from-rose-950/45 via-slate-900 to-slate-950',
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    iconBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    priceText: 'text-rose-400',
    buttonBg: 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-950/60',
  },
};

function getSecondsUntilDhakaMidnight(): number {
  const now = new Date();
  const dhakaNowStr = now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
  const dhakaNow = new Date(dhakaNowStr);
  const midnight = new Date(dhakaNow);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(0, Math.floor((midnight.getTime() - dhakaNow.getTime()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const PlansPage: React.FC<PlansPageProps> = ({ onBack, onOpenDeposit }) => {
  const { user, settings, applyUser, showToast } = useAuth();
  const [subscriptions, setSubscriptions] = useState<UserPlanSubscription[]>([]);
  const [isLoadingSubs, setIsLoadingSubs] = useState(true);
  const [claimingSubId, setClaimingSubId] = useState<string | null>(null);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<EarningPlan | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [countdownSec, setCountdownSec] = useState<number>(() => getSecondsUntilDhakaMidnight());
  const [showCompleted, setShowCompleted] = useState(false);

  const todayDhaka = getDhakaDateKey();

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSec(getSecondsUntilDhakaMidnight());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setSubscriptions([]);
      setIsLoadingSubs(false);
      return;
    }
    setIsLoadingSubs(true);
    const unsub = subscribeToUserPlans(user.id, list => {
      setSubscriptions(list);
      setIsLoadingSubs(false);
    });
    return () => unsub();
  }, [user?.id]);

  const availablePlans = useMemo(() => {
    const rawPlans = settings?.earningPlans;
    const base = Array.isArray(rawPlans) ? rawPlans : getDefaultEarningPlans();
    return base
      .filter(p => p.enabled !== false)
      .sort((a, b) => (a.sortOrder ?? a.price) - (b.sortOrder ?? b.price));
  }, [settings?.earningPlans]);

  const planById = useMemo(() => {
    const map = new Map<string, EarningPlan>();
    for (const p of settings?.earningPlans || []) {
      map.set(p.id, p);
    }
    return map;
  }, [settings?.earningPlans]);

  const activeSubs = useMemo(
    () => subscriptions.filter(s => s.status === 'active' && s.claimedDays < s.durationDays),
    [subscriptions]
  );

  const completedSubs = useMemo(
    () => subscriptions.filter(s => s.status === 'completed' || s.claimedDays >= s.durationDays),
    [subscriptions]
  );

  const claimableSubs = useMemo(
    () => activeSubs.filter(s => s.lastClaimDate !== todayDhaka),
    [activeSubs, todayDhaka]
  );

  const getEffectiveDailyIncome = (sub: UserPlanSubscription) => {
    const livePlan = planById.get(sub.planId);
    return livePlan ? livePlan.dailyIncome : sub.dailyIncome;
  };

  const todayClaimableTotal = useMemo(
    () => claimableSubs.reduce((sum, s) => sum + getEffectiveDailyIncome(s), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claimableSubs, planById]
  );

  const totalPlanEarned = useMemo(
    () => subscriptions.reduce((sum, s) => sum + (s.totalClaimedAmount || 0), 0),
    [subscriptions]
  );

  const handleBuyPlan = async () => {
    if (!user || !confirmPlan || isBuying) return;
    setIsBuying(true);
    try {
      const res = await purchaseEarningPlanTransaction({
        uid: user.id,
        plan: confirmPlan,
      });
      applyUser(res.user);
      showToast(res.message, 'success');
      setConfirmPlan(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'প্ল্যান কিনতে সমস্যা হয়েছে।';
      showToast(msg, 'error');
    } finally {
      setIsBuying(false);
    }
  };

  const handleClaimOne = async (sub: UserPlanSubscription) => {
    if (!user || claimingSubId || isClaimingAll) return;
    setClaimingSubId(sub.id);
    try {
      const res = await claimPlanDailyIncomeTransaction({
        uid: user.id,
        subId: sub.id,
      });
      applyUser(res.user);
      showToast(res.message, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ক্লেইম করতে সমস্যা হয়েছে।';
      showToast(msg, 'error');
    } finally {
      setClaimingSubId(null);
    }
  };

  const handleClaimAll = async () => {
    if (!user || claimableSubs.length === 0 || isClaimingAll || claimingSubId) return;
    setIsClaimingAll(true);
    let claimedCount = 0;
    let totalGot = 0;
    try {
      for (const sub of claimableSubs) {
        const res = await claimPlanDailyIncomeTransaction({
          uid: user.id,
          subId: sub.id,
        });
        applyUser(res.user);
        claimedCount += 1;
        totalGot += res.reward;
      }
      if (claimedCount > 0) {
        showToast(
          `অভিনন্দন! ${claimedCount} টি প্ল্যান থেকে মোট ৳${totalGot.toFixed(2)} ক্লেইম সম্পন্ন হয়েছে!`,
          'success'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'সব প্ল্যান ক্লেইম করতে আংশিক সমস্যা হয়েছে।';
      showToast(msg, 'error');
    } finally {
      setIsClaimingAll(false);
    }
  };

  const currentBalance = user?.balance || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Top Page Header */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800 p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>হোম ও ক্যাপচা সলভারে ফিরুন</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-lg shadow-emerald-950/60">
                <Crown className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  ডেইলি ইনকাম প্ল্যান (Daily Earning Plans)
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  আপনার পছন্দমতো প্ল্যান কিনুন এবং প্রতিদিন এক ক্লিকে ক্লেইম করে সরাসরি মেইন ব্যালেন্সে টাকা নিন।
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenDeposit}
              className="px-4 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-pink-950/50"
            >
              <Wallet className="w-4 h-4" />
              <span>ফান্ড ডিপোজিট করুন</span>
            </button>

            {claimableSubs.length > 0 && (
              <button
                type="button"
                onClick={handleClaimAll}
                disabled={isClaimingAll}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-950/60"
              >
                <Gift className="w-4 h-4" />
                <span>
                  {isClaimingAll
                    ? 'ক্লেইম হচ্ছে...'
                    : `আজকের ৳${todayClaimableTotal.toFixed(0)} সব ক্লেইম করুন`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6">
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              <span>বর্তমান ব্যালেন্স</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-emerald-400 tabular-nums">
              ৳{currentBalance.toFixed(2)}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>অ্যাক্টিভ প্ল্যান</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-white tabular-nums">
              {activeSubs.length} টি
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Gift className="w-3.5 h-3.5 text-amber-400" />
              <span>আজ ক্লেইমযোগ্য</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-amber-400 tabular-nums">
              ৳{todayClaimableTotal.toFixed(2)}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
              <span>প্ল্যান থেকে মোট আয়</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-purple-300 tabular-nums">
              ৳{totalPlanEarned.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: User Active Plans & Daily Claim */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-extrabold text-white">
              আমার অ্যাক্টিভ প্ল্যান ও দৈনিক ক্লেইম
            </h2>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>পরবর্তী দৈনিক রিসেট:</span>
            <span className="font-mono font-bold text-cyan-300 tabular-nums">
              {formatCountdown(countdownSec)}
            </span>
          </div>
        </div>

        {isLoadingSubs ? (
          <div className="p-10 rounded-3xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
            আপনার প্ল্যানসমূহ লোড হচ্ছে...
          </div>
        ) : activeSubs.length === 0 ? (
          <div className="p-8 rounded-3xl bg-slate-900/60 border border-dashed border-slate-700 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <Coins className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">
                আপনার এখনো কোনো অ্যাক্টিভ ইনকাম প্ল্যান নেই
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                নিচের তালিকা থেকে ৫০০, ১০০০ বা ১৫০০ টাকার যেকোনো একটি প্ল্যান কিনে প্রতিদিন নিয়মিত ক্লেইম করে টাকা আয় শুরু করুন!
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSubs.map(sub => {
              const effectiveDaily = getEffectiveDailyIncome(sub);
              const claimedToday = sub.lastClaimDate === todayDhaka;
              const progressPct = Math.min(
                100,
                Math.round((sub.claimedDays / Math.max(1, sub.durationDays)) * 100)
              );
              const isThisClaiming = claimingSubId === sub.id || isClaimingAll;

              return (
                <div
                  key={sub.id}
                  className={`p-5 rounded-3xl border transition-all flex flex-col justify-between gap-4 shadow-xl ${
                    claimedToday
                      ? 'bg-slate-900/80 border-slate-800'
                      : 'bg-gradient-to-br from-emerald-950/35 via-slate-900 to-slate-950 border-emerald-500/45'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-mono text-slate-400">{sub.id}</div>
                        <h3 className="text-base font-extrabold text-white mt-0.5">
                          {sub.planName}
                        </h3>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                          claimedToday
                            ? 'bg-slate-800 text-slate-300 border-slate-700'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                        }`}
                      >
                        {claimedToday ? 'আজ ক্লেইম সম্পন্ন' : 'ক্লেইম প্রস্তুত'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800">
                        <div className="text-[10px] text-slate-400">প্রতিদিন আয়</div>
                        <div className="font-mono font-extrabold text-emerald-400 text-sm mt-0.5 tabular-nums">
                          ৳{effectiveDaily.toFixed(2)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800">
                        <div className="text-[10px] text-slate-400">মোট পেয়েছেন</div>
                        <div className="font-mono font-extrabold text-amber-300 text-sm mt-0.5 tabular-nums">
                          ৳{sub.totalClaimedAmount.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">মেয়াদ অগ্রগতি</span>
                        <span className="font-mono font-bold text-slate-200 tabular-nums">
                          {sub.claimedDays} / {sub.durationDays} দিন ({progressPct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {claimedToday ? (
                    <div className="w-full py-2.5 px-4 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>আজকে ক্লেইম করা হয়েছে · আগামীকাল আবার</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleClaimOne(sub)}
                      disabled={isThisClaiming}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-950/60 active:scale-[0.98]"
                    >
                      <Gift className="w-4 h-4" />
                      <span>
                        {isThisClaiming
                          ? 'ক্লেইম প্রসেস হচ্ছে...'
                          : `আজকের ৳${effectiveDaily.toFixed(2)} ক্লেইম করুন`}
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {completedSubs.length > 0 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowCompleted(prev => !prev)}
              className="text-xs font-semibold text-slate-400 hover:text-white underline cursor-pointer"
            >
              {showCompleted
                ? `মেয়াদ সম্পন্ন হওয়া প্ল্যান লুকান (${completedSubs.length})`
                : `মেয়াদ সম্পন্ন হওয়া প্ল্যান দেখুন (${completedSubs.length})`}
            </button>

            {showCompleted && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                {completedSubs.map(sub => (
                  <div
                    key={sub.id}
                    className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200">{sub.planName}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {sub.claimedDays}/{sub.durationDays} দিন সম্পন্ন
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-emerald-400">
                        মোট ৳{sub.totalClaimedAmount.toFixed(2)}
                      </div>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                        সম্পন্ন
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2: Available Plans Marketplace */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Crown className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-extrabold text-white">
              উপলব্ধ ডেইলি ইনকাম প্ল্যানসমূহ
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            মোট {availablePlans.length} টি প্ল্যান চালু আছে
          </span>
        </div>

        {availablePlans.length === 0 ? (
          <div className="p-10 rounded-3xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
            বর্তমানে কোনো ইনকাম প্ল্যান চালু নেই। অনুগ্রহ করে পরে আবার দেখুন।
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {availablePlans.map(plan => {
              const theme = THEME_STYLES[plan.color || 'emerald'] || THEME_STYLES.emerald;
              const totalReturn = plan.dailyIncome * plan.durationDays;
              const netProfit = totalReturn - plan.price;

              return (
                <div
                  key={plan.id}
                  className={`rounded-3xl bg-gradient-to-br ${theme.glow} border ${theme.border} p-6 flex flex-col justify-between gap-5 shadow-2xl transition-all`}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center ${theme.iconBg}`}>
                        <Crown className="w-5 h-5" />
                      </div>
                      {plan.badge && (
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${theme.badgeBg}`}>
                          {plan.badge}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-lg font-extrabold text-white leading-snug">
                        {plan.name}
                      </h3>
                      {plan.description && (
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                          {plan.description}
                        </p>
                      )}
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-950/85 border border-slate-800/90 flex items-baseline justify-between">
                      <div>
                        <div className="text-[11px] text-slate-400">প্ল্যান মূল্য</div>
                        <div className={`text-3xl font-extrabold font-mono tabular-nums ${theme.priceText}`}>
                          ৳{plan.price.toLocaleString('en-US')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-400">দৈনিক আয়</div>
                        <div className="text-xl font-extrabold font-mono text-white tabular-nums">
                          ৳{plan.dailyIncome}/দিন
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-400">প্ল্যানের মেয়াদ:</span>
                        <span className="font-bold text-white">{plan.durationDays} দিন</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-400">মোট রিটার্ন ({plan.durationDays} দিনে):</span>
                        <span className="font-mono font-bold text-emerald-400">
                          ৳{totalReturn.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      {netProfit > 0 && (
                        <div className="flex items-center justify-between text-slate-300">
                          <span className="text-slate-400">নিট লাভ (Profit):</span>
                          <span className="font-mono font-bold text-amber-300">
                            +৳{netProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-300/90 pt-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>প্রতিদিন ১ ক্লিকে ক্লেইম · ইনস্ট্যান্ট মূল ব্যালেন্সে যোগ</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmPlan(plan)}
                    className={`w-full py-3 px-4 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg active:scale-[0.98] ${theme.buttonBg}`}
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>প্ল্যানটি কিনুন (৳{plan.price})</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Purchase Confirmation Modal */}
      {confirmPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">প্ল্যান ক্রয় নিশ্চিত করুন</h3>
                  <p className="text-[11px] text-slate-400">সরাসরি অ্যাকাউন্ট ব্যালেন্স থেকে কাটা হবে</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isBuying && setConfirmPlan(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">নির্বাচিত প্ল্যান:</span>
                <span className="font-bold text-white">{confirmPlan.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">প্ল্যান মূল্য:</span>
                <span className="font-mono font-bold text-rose-400">৳{confirmPlan.price.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">প্রতিদিন আয়:</span>
                <span className="font-mono font-bold text-emerald-400">৳{confirmPlan.dailyIncome.toFixed(2)} / দিন</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">মেয়াদ:</span>
                <span className="font-bold text-slate-200">{confirmPlan.durationDays} দিন</span>
              </div>
              <div className="border-t border-slate-800 pt-2.5 flex items-center justify-between">
                <span className="text-slate-400">আপনার বর্তমান ব্যালেন্স:</span>
                <span className="font-mono font-bold text-white">৳{currentBalance.toFixed(2)}</span>
              </div>
              {currentBalance >= confirmPlan.price && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">ক্রয়ের পর ব্যালেন্স থাকবে:</span>
                  <span className="font-mono font-bold text-cyan-400">
                    ৳{(currentBalance - confirmPlan.price).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {currentBalance < confirmPlan.price ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    পর্যাপ্ত ব্যালেন্স নেই! এই প্ল্যানটি কিনতে আপনার আরও{' '}
                    <strong className="font-mono text-white">
                      ৳{(confirmPlan.price - currentBalance).toFixed(2)}
                    </strong>{' '}
                    প্রয়োজন। আগে ডিপোজিট করুন।
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setConfirmPlan(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    বাতিল
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmPlan(null);
                      onOpenDeposit();
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <Wallet className="w-4 h-4" />
                    <span>এখনই ডিপোজিট করুন</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmPlan(null)}
                  disabled={isBuying}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="button"
                  onClick={handleBuyPlan}
                  disabled={isBuying}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-950/60"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isBuying ? 'কেনা হচ্ছে...' : 'নিশ্চিত করে কিনুন'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
