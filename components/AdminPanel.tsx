import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToAdminOverview,
  saveSettingsInFirestore,
  processRechargeTransaction,
  processWithdrawalTransaction,
  adjustUserBalanceTransaction,
  toggleUserBanInFirestore,
  setUserTierInFirestore,
  setUserCustomLimitInFirestore,
  resetAllDailyQuotasInFirestore,
  resetVideoAdInFirestore,
  resetUserAdsInFirestore,
  resetUserWithdrawPinInFirestore,
  type ExtendedAdWatchLog,
} from '../lib/dbService';
import { getDefaultSettings, getDefaultP2PConfig, getDefaultWithdrawalSchedule, getDefaultEarningPlans } from '../lib/defaults';
import { SHORT_DAY_NAMES_BN } from '../lib/withdrawalSchedule';
import { dispatchTelegramReceipt } from '../lib/telegramService';
import { compressImageToDataUrl } from '../lib/imageUtils';
import { BrandLogo } from './BrandLogo';
import { AdminTelegramPanel } from './AdminTelegramPanel';
import { AdminTelemetryPanel } from './AdminTelemetryPanel';
import { AdminSmsGatewayPanel } from './AdminSmsGatewayPanel';
import {
  fetchSmsGatewayAdminState,
  linkGatewaySmsToDeposit,
  type SmsGatewayAdminState,
  type SmsGatewayLogItem,
} from '../lib/smsGatewayService';
import { 
  User, 
  RechargeRequest, 
  WithdrawalRequest, 
  SystemSettings, 
  AuditLogItem, 
  VipTier,
  CaptchaType,
  CaptchaTypeConfig,
  AdSectionConfig,
  VideoAdItem,
  AdWatchLog,
  EarningPlan,
  PlanThemeColor,
  UserPlanSubscription
} from '../types';
import { 
  ShieldCheck, 
  Users, 
  CreditCard, 
  ArrowDownToLine, 
  Sliders, 
  FileText, 
  Check, 
  X, 
  AlertTriangle, 
  Search, 
  Plus, 
  Minus, 
  Crown, 
  Lock, 
  Unlock, 
  Save, 
  RefreshCw,
  Coins,
  RotateCcw,
  Sparkles,
  PlayCircle,
  Tv,
  Trash2,
  ExternalLink,
  Eye,
  Edit3,
  Bell,
  KeyRound,
  Send,
  CalendarClock,
  Activity,
  Wallet,
  Smartphone,
  Copy,
  CheckCircle2,
  Upload,
  Image as ImageIcon,
  Layers,
  Gift
} from 'lucide-react';

export const AdminPanel: React.FC = () => {
  const { user, isAdmin, settings: contextSettings, showToast, setIsLoginModalOpen, applySettings, applyUser } = useAuth();
  const [adminTab, setAdminTab] = useState<'overview' | 'rates' | 'plans' | 'deposits' | 'sms-gateway' | 'recharges' | 'withdrawals' | 'users' | 'notifications' | 'telegram' | 'telemetry' | 'settings' | 'logs'>('overview');
  const [smsGatewayState, setSmsGatewayState] = useState<SmsGatewayAdminState | null>(null);
  const [recharges, setRecharges] = useState<RechargeRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [userPlans, setUserPlans] = useState<UserPlanSubscription[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(contextSettings);
  const settingsRef = useRef<SystemSettings | null>(contextSettings);
  const isSettingsDirtyRef = useRef(false);
  const lastRemoteSettingsJsonRef = useRef<string>('');
  const [hasUnsavedSettings, setHasUnsavedSettings] = useState(false);
  const [uploadingLogoKey, setUploadingLogoKey] = useState<string | null>(null);
  const [brokenLogoKeys, setBrokenLogoKeys] = useState<Record<string, boolean>>({});
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [adWatchLogs, setAdWatchLogs] = useState<AdWatchLog[]>([]);
  const [rawAdLogs, setRawAdLogs] = useState<ExtendedAdWatchLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [presenceNowMs, setPresenceNowMs] = useState(() => Date.now());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const updateDraftSettings = (updater: (prev: SystemSettings) => SystemSettings) => {
    const base = settingsRef.current || settings || contextSettings || getDefaultSettings();
    const next = updater(base);
    isSettingsDirtyRef.current = true;
    setHasUnsavedSettings(true);
    settingsRef.current = next;
    setSettings(next);
  };

  // User search & presence/ban filter
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'online' | 'offline' | 'banned'>('all');

  // Balance adjustment modal state
  const [adjustingUser, setAdjustingUser] = useState<User | null>(null);
  const [balanceMode, setBalanceMode] = useState<'add' | 'deduct' | 'set'>('add');
  const [balanceDelta, setBalanceDelta] = useState('100');
  const [adjustReason, setAdjustReason] = useState('অ্যাডমিন বোনাস বা সমন্বয়');

  // Custom User Daily Limit modal state
  const [userForCustomLimit, setUserForCustomLimit] = useState<User | null>(null);
  const [customLimitInput, setCustomLimitInput] = useState<string>('');

  // Withdrawal approval modal state
  const [approvingWithdrawal, setApprovingWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [payoutTrxId, setPayoutTrxId] = useState('');

  // Deposit filter & search states
  const [depositSearchQuery, setDepositSearchQuery] = useState('');
  const [depositStatusFilter, setDepositStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [depositMethodFilter, setDepositMethodFilter] = useState<string>('all');
  const [copiedTrxId, setCopiedTrxId] = useState<string | null>(null);

  // Recharge filter & search states
  const [rechargeSearchQuery, setRechargeSearchQuery] = useState('');
  const [rechargeStatusFilter, setRechargeStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Rejection modal state for deposit/recharge
  const [rejectingItem, setRejectingItem] = useState<{ id: string; type: 'deposit' | 'recharge'; userName: string; amount: number; method: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Active section selected in Captcha & Ad Control tab
  const [selectedSection, setSelectedSection] = useState<CaptchaType | 'ads'>('text');

  // New / Edit Video Ad state
  const [newAdTitle, setNewAdTitle] = useState('');
  const [newAdUrl, setNewAdUrl] = useState('');
  const [newAdReward, setNewAdReward] = useState('');
  const [newAdSeconds, setNewAdSeconds] = useState('');
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [editAdTitle, setEditAdTitle] = useState('');
  const [editAdUrl, setEditAdUrl] = useState('');
  const [editAdReward, setEditAdReward] = useState('');
  const [editAdSeconds, setEditAdSeconds] = useState('');

  // Announcement Broadcast state
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [sendAlsoToTelegram, setSendAlsoToTelegram] = useState(true);
  const [isSendingAnn, setIsSendingAnn] = useState(false);

  // Daily Earning Plans Creation state
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('2000');
  const [newPlanDailyIncome, setNewPlanDailyIncome] = useState('165');
  const [newPlanDuration, setNewPlanDuration] = useState('30');
  const [newPlanBadge, setNewPlanBadge] = useState('নতুন প্ল্যান');
  const [newPlanColor, setNewPlanColor] = useState<PlanThemeColor>('cyan');
  const [newPlanDesc, setNewPlanDesc] = useState('');

  const handleSendBroadcast = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedTitle = announcementTitle.trim();
    const trimmedBody = announcementBody.trim();
    if (!trimmedTitle && !trimmedBody) {
      showToast('অনুগ্রহ করে নোটিফিকেশনের যেকোনো বার্তা বা শিরোনাম লিখুন।', 'error');
      return;
    }
    setIsSendingAnn(true);
    try {
      const baseSettings = settings || contextSettings || getDefaultSettings();
      const newAnn = {
        id: 'ann-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        title: (trimmedTitle || 'অ্যাডমিন ঘোষণা').slice(0, 200),
        body: (trimmedBody || trimmedTitle).slice(0, 1000),
        createdAt: new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })
      };
      const updatedAnnouncements = [newAnn, ...(baseSettings.announcements || [])].slice(0, 100);
      const newSettings: SystemSettings = { ...baseSettings, announcements: updatedAnnouncements };
      const saved = await saveSettingsInFirestore(newSettings, user?.email || 'admin');
      setSettings(saved);
      applySettings(saved);
      void dispatchTelegramReceipt({
        eventType: 'broadcast',
        title: newAnn.title,
        body: newAnn.body,
        channelOnly: !sendAlsoToTelegram,
      });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      showToast('সফলভাবে সকল ইউজারের নোটিফিকেশন বক্সে পাঠানো হয়েছে!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'অজানা ত্রুটি';
      showToast('নোটিফিকেশন পাঠাতে ত্রুটি: ' + msg, 'error');
    } finally {
      setIsSendingAnn(false);
    }
  };

  const handleDeleteAnnouncement = async (annId: string) => {
    const baseSettings = settings || contextSettings;
    if (!baseSettings || isSendingAnn) return;
    setIsSendingAnn(true);
    try {
      const updatedAnnouncements = (baseSettings.announcements || []).filter(a => a.id !== annId);
      const newSettings: SystemSettings = { ...baseSettings, announcements: updatedAnnouncements };
      const saved = await saveSettingsInFirestore(newSettings, user?.email || 'admin');
      setSettings(saved);
      applySettings(saved);
      showToast('নোটিফিকেশন মুছে ফেলা হয়েছে।', 'info');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ত্রুটি ঘটেছে';
      showToast('মুছতে ব্যর্থ: ' + msg, 'error');
    } finally {
      setIsSendingAnn(false);
    }
  };

  // Real-time Firestore listener for all Admin collections
  useEffect(() => {
    if (!isAdmin || !user) return;
    setIsLoading(true);
    const unsub = subscribeToAdminOverview(snap => {
      setUsers(snap.users);
      setRecharges(snap.recharges);
      setWithdrawals(snap.withdrawals);
      if (snap.settingsLoaded) {
        const remoteJson = JSON.stringify(snap.settings);
        const remoteChanged = remoteJson !== lastRemoteSettingsJsonRef.current;
        if (remoteChanged) {
          lastRemoteSettingsJsonRef.current = remoteJson;
          applySettings(snap.settings);
          if (!isSettingsDirtyRef.current) {
            settingsRef.current = snap.settings;
            setSettings(snap.settings);
          }
        }
      }
      setAuditLogs(snap.auditLogs);
      setAdWatchLogs(snap.adWatchLogs);
      setRawAdLogs(snap.rawAdLogs);
      setUserPlans(snap.userPlans || []);
      setIsLoading(false);
    });
    return () => unsub();
  }, [isAdmin, user?.id, applySettings]);

  // Refresh relative online/offline window every 15s
  useEffect(() => {
    const t = setInterval(() => setPresenceNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Poll Android SMS Gateway monitoring & auto-match logs for Deposits & SMS Gateway tabs
  useEffect(() => {
    if (!isAdmin || !user) return;
    let cancelled = false;
    const refreshGateway = async () => {
      try {
        const gw = await fetchSmsGatewayAdminState();
        if (!cancelled) setSmsGatewayState(gw);
      } catch {
        // Silent background refresh
      }
    };
    void refreshGateway();
    const timer = setInterval(() => {
      void refreshGateway();
    }, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdmin, user?.id]);

  const smsMatchByTrxId = useMemo(() => {
    const map = new Map<string, SmsGatewayLogItem>();
    for (const log of smsGatewayState?.smsLogs || []) {
      const key = (log.trxId || '').trim().toUpperCase();
      if (key && !map.has(key)) {
        map.set(key, log);
      }
    }
    return map;
  }, [smsGatewayState]);

  const stats = useMemo(() => {
    const totalDepositVolume = Math.round(
      recharges
        .filter(r => r.method !== 'Mobile Recharge' && r.status === 'approved')
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100
    ) / 100;
    const totalRechargeVolume = Math.round(
      recharges
        .filter(r => r.method === 'Mobile Recharge' && r.status === 'approved')
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100
    ) / 100;
    const totalWithdrawalVolume = Math.round(
      withdrawals
        .filter(w => w.status === 'approved')
        .reduce((sum, w) => sum + (Number(w.amount) || 0), 0) * 100
    ) / 100;
    const totalCaptchasSolved = users.reduce((sum, u) => sum + (Number(u.totalCaptchasSolved) || 0), 0);
    const totalAdViewsCompleted = rawAdLogs.filter(l => l.status === 'completed').length;
    const totalAdViewsIncomplete = rawAdLogs.filter(l => l.status === 'incomplete').length;
    const totalAdClicks = rawAdLogs.filter(l => l.status === 'clicked').length;
    const totalAdPaidOut = Math.round(
      rawAdLogs
        .filter(l => l.status === 'completed')
        .reduce((sum, l) => sum + (Number(l.earned) || 0), 0) * 100
    ) / 100;

    return {
      totalUsers: users.length,
      totalDepositVolume,
      totalRechargeVolume,
      totalWithdrawalVolume,
      totalCaptchasSolved,
      totalAdViewsCompleted,
      totalAdViewsIncomplete,
      totalAdClicks,
      totalAdPaidOut,
    };
  }, [users, recharges, withdrawals, rawAdLogs]);

  const adStatsByAdId = useMemo(() => {
    const map: Record<string, { clicks: number; completed: number; incomplete: number }> = {};
    for (const log of rawAdLogs) {
      if (!map[log.adId]) {
        map[log.adId] = { clicks: 0, completed: 0, incomplete: 0 };
      }
      if (log.status === 'clicked') map[log.adId].clicks += 1;
      else if (log.status === 'completed') map[log.adId].completed += 1;
      else if (log.status === 'incomplete') map[log.adId].incomplete += 1;
    }
    return map;
  }, [rawAdLogs]);

  // Persist settings helper (real-time Cloud Firestore + AuthContext sync)
  const persistSettings = async (updatedSettings: SystemSettings, silentToast = false): Promise<boolean> => {
    if (!user) return false;
    const previousSettings = settingsRef.current || settings;
    settingsRef.current = updatedSettings;
    setSettings(updatedSettings);
    applySettings(updatedSettings);
    setIsSavingSettings(true);
    try {
      const saved = await saveSettingsInFirestore(updatedSettings, user.email);
      lastRemoteSettingsJsonRef.current = JSON.stringify(saved);
      isSettingsDirtyRef.current = false;
      setHasUnsavedSettings(false);
      settingsRef.current = saved;
      setSettings(saved);
      applySettings(saved);
      if (!silentToast) {
        showToast('রিয়েল-টাইমে Cloud Firestore-এ আপডেট ও সেভ হয়েছে!', 'success');
      }
      return true;
    } catch (err: unknown) {
      if (previousSettings) {
        settingsRef.current = previousSettings;
        setSettings(previousSettings);
        applySettings(previousSettings);
      }
      const msg = err instanceof Error ? err.message : 'সেটিংস সেভ ব্যর্থ';
      showToast(msg, 'error');
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Helper to read per-captcha config safely
  const getTypeCfg = (type: CaptchaType): CaptchaTypeConfig => {
    const c = settings?.captchaConfigs?.[type];
    if (c) {
      return {
        ...c,
        cooldownSeconds: c.cooldownSeconds ?? 0
      };
    }
    if (type === 'text') return { enabled: true, reward: settings?.rewardPerText ?? 2.5, dailyLimit: settings?.dailyFreeLimit ?? 25, timeLimitSeconds: 35, cooldownSeconds: 0 };
    if (type === 'math') return { enabled: true, reward: settings?.rewardPerMath ?? 3.0, dailyLimit: 20, timeLimitSeconds: 30, cooldownSeconds: 0 };
    if (type === 'image_grid') return { enabled: true, reward: settings?.rewardPerGrid ?? 4.0, dailyLimit: 15, timeLimitSeconds: 40, cooldownSeconds: 0 };
    return { enabled: true, reward: settings?.rewardPerSlider ?? 5.0, dailyLimit: 15, timeLimitSeconds: 25, cooldownSeconds: 0 };
  };

  // Update a specific captcha type's config (and optionally persist immediately)
  const updateCaptchaConfig = (
    type: CaptchaType,
    patch: Partial<CaptchaTypeConfig>,
    saveImmediately = true
  ) => {
    if (!settings) return;
    const currentConfigs: Record<CaptchaType, CaptchaTypeConfig> = {
      text: getTypeCfg('text'),
      math: getTypeCfg('math'),
      image_grid: getTypeCfg('image_grid'),
      slider: getTypeCfg('slider')
    };
    const updatedTypeConfig: CaptchaTypeConfig = {
      ...currentConfigs[type],
      ...patch
    };
    const nextConfigs = {
      ...currentConfigs,
      [type]: updatedTypeConfig
    };
    const nextSettings: SystemSettings = {
      ...settings,
      captchaConfigs: nextConfigs,
      rewardPerText: nextConfigs.text.reward,
      rewardPerMath: nextConfigs.math.reward,
      rewardPerGrid: nextConfigs.image_grid.reward,
      rewardPerSlider: nextConfigs.slider.reward
    };
    if (saveImmediately) {
      persistSettings(nextSettings);
    } else {
      setSettings(nextSettings);
    }
  };

  // Helpers for Video Ad Section config & links
  const getAdCfg = (): AdSectionConfig => {
    const c = settings?.adConfig;
    return {
      enabled: c?.enabled ?? true,
      reward: c?.reward ?? 5.0,
      minWatchSeconds: c?.minWatchSeconds ?? 10,
      dailyLimit: c?.dailyLimit ?? 15,
      cooldownSeconds: c?.cooldownSeconds ?? 5
    };
  };

  const updateAdConfig = (patch: Partial<AdSectionConfig>, saveImmediately = true) => {
    if (!settings) return;
    const current = getAdCfg();
    const nextSettings: SystemSettings = {
      ...settings,
      adConfig: {
        ...current,
        ...patch
      }
    };
    if (saveImmediately) {
      persistSettings(nextSettings);
    } else {
      setSettings(nextSettings);
    }
  };

  const normalizeExternalUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const handleAddVideoAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || isSavingSettings) return;
    const url = normalizeExternalUrl(newAdUrl);
    if (!url) {
      showToast('ভিডিও লিংক (URL) দিন', 'error');
      return;
    }
    const newItem: VideoAdItem = {
      id: 'ad-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: newAdTitle.trim() || `ভিডিও অ্যাড #${(settings.videoAds?.length || 0) + 1}`,
      url,
      enabled: true,
      reward: newAdReward.trim() !== '' ? Math.max(0, Number(newAdReward)) : undefined,
      minWatchSeconds: newAdSeconds.trim() !== '' ? Math.max(3, Number(newAdSeconds)) : undefined,
      totalCompletedViews: 0,
      totalIncompleteViews: 0,
      totalClicks: 0,
      createdAt: new Date().toISOString()
    };
    const nextSettings: SystemSettings = {
      ...settings,
      videoAds: [newItem, ...(settings.videoAds || [])]
    };
    const ok = await persistSettings(nextSettings);
    if (ok) {
      setNewAdTitle('');
      setNewAdUrl('');
      setNewAdReward('');
      setNewAdSeconds('');
    }
  };

  const handleToggleVideoAd = (adId: string) => {
    if (!settings) return;
    const nextAds = (settings.videoAds || []).map(v =>
      v.id === adId ? { ...v, enabled: v.enabled === false } : v
    );
    persistSettings({ ...settings, videoAds: nextAds });
  };

  const handleDeleteVideoAd = (adId: string) => {
    if (!settings) return;
    const nextAds = (settings.videoAds || []).filter(v => v.id !== adId);
    persistSettings({ ...settings, videoAds: nextAds });
  };

  const startEditVideoAd = (ad: VideoAdItem) => {
    setEditingAdId(ad.id);
    setEditAdTitle(ad.title);
    setEditAdUrl(ad.url);
    setEditAdReward(ad.reward !== undefined ? String(ad.reward) : '');
    setEditAdSeconds(ad.minWatchSeconds !== undefined ? String(ad.minWatchSeconds) : '');
  };

  const handleSaveEditedVideoAd = () => {
    if (!settings || !editingAdId) return;
    const cleanUrl = normalizeExternalUrl(editAdUrl);
    if (!cleanUrl) {
      showToast('ভিডিও লিংক ফাঁকা রাখা যাবে না', 'error');
      return;
    }
    const nextAds = (settings.videoAds || []).map(v =>
      v.id === editingAdId
        ? {
            ...v,
            title: editAdTitle.trim() || v.title,
            url: cleanUrl,
            reward: editAdReward.trim() !== '' ? Math.max(0, Number(editAdReward)) : undefined,
            minWatchSeconds: editAdSeconds.trim() !== '' ? Math.max(3, Number(editAdSeconds)) : undefined
          }
        : v
    );
    setEditingAdId(null);
    persistSettings({ ...settings, videoAds: nextAds });
  };

  // Re-enable a reviewed video ad for all users (and ensure the video stays enabled in settings)
  const handleResetVideoAd = async (adId: string) => {
    if (!user) return;
    try {
      const targetAd = settings?.videoAds?.find(v => v.id === adId);
      if (settings && targetAd && targetAd.enabled === false) {
        const nextAds = (settings.videoAds || []).map(v =>
          v.id === adId ? { ...v, enabled: true } : v
        );
        await persistSettings({ ...settings, videoAds: nextAds }, true);
      }
      const message = await resetVideoAdInFirestore(adId, user.email);
      showToast(message, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'রিভিউ রিসেট ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Reset reviewed video ads & daily ad quota for a specific user
  const handleResetUserAds = async (userId: string) => {
    if (!user) return;
    try {
      const res = await resetUserAdsInFirestore(userId, user.email);
      showToast(res.message, 'success');
      applyUser(res.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ইউজারের ভিডিও লিমিট রিসেট ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Reset forgotten 4-digit Withdraw Security PIN for a user
  const handleResetUserPin = async (userId: string) => {
    if (!user) return;
    try {
      const res = await resetUserWithdrawPinInFirestore(userId, user.email);
      showToast(res.message, 'success');
      applyUser(res.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'পিন রিসেট করতে সমস্যা হয়েছে';
      showToast(msg, 'error');
    }
  };

  // Guard: if not admin or no user
  if (!isAdmin || !user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-rose-400">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">অননুমোদিত প্রবেশ</h2>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          এই অংশটি শুধুমাত্র অনুমোদিত অ্যাডমিনিস্ট্রেটরের জন্য সংরক্ষিত। আপনার অ্যাকাউন্ট পরিবর্তন করতে চাইলে নিচের বাটনে ক্লিক করুন।
        </p>
        <button
          type="button"
          onClick={() => setIsLoginModalOpen(true)}
          className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs border border-slate-700 transition-colors cursor-pointer"
        >
          অন্য অ্যাকাউন্টে সাইন ইন করুন
        </button>
      </div>
    );
  }

  // Handle Recharge / Deposit Approve/Reject
  const handleRechargeAction = async (
    id: string,
    action: 'approve' | 'reject',
    adminNote?: string,
    matchedSmsLogId?: string
  ) => {
    try {
      const message = await processRechargeTransaction({
        rechargeId: id,
        action,
        adminNote,
        actorEmail: user.email,
      });
      if (action === 'approve' && matchedSmsLogId) {
        void linkGatewaySmsToDeposit(matchedSmsLogId, id).catch(() => {});
      }
      showToast(message, 'success');
      setRejectingItem(null);
      setRejectionReason('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'অ্যাকশন ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  const handleApproveMatchedDepositFromGateway = async (
    deposit: RechargeRequest,
    smsLogId: string
  ) => {
    await handleRechargeAction(
      deposit.id,
      'approve',
      `SMS Gateway অটো-ভেরিফাইড (${deposit.trxId})`,
      smsLogId
    );
  };

  // Handle Withdrawal Approve/Reject
  const handleWithdrawalAction = async (id: string, action: 'approve' | 'reject', trxId?: string) => {
    try {
      const message = await processWithdrawalTransaction({
        withdrawalId: id,
        action,
        payoutTrxId: trxId,
        actorEmail: user.email,
      });
      showToast(message, 'success');
      setApprovingWithdrawal(null);
      setPayoutTrxId('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'অ্যাকশন ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Handle User Balance Add / Deduct / Exact Set
  const handleAdjustBalance = async () => {
    if (!adjustingUser) return;
    const rawVal = Number(balanceDelta);
    if (!Number.isFinite(rawVal) || rawVal < 0) {
      showToast('দয়া করে সঠিক টাকার পরিমাণ লিখুন', 'error');
      return;
    }

    try {
      const res = await adjustUserBalanceTransaction({
        targetUserId: adjustingUser.id,
        exactBalance: balanceMode === 'set' ? rawVal : undefined,
        deltaAmount:
          balanceMode === 'set'
            ? undefined
            : balanceMode === 'deduct'
            ? -Math.abs(rawVal)
            : Math.abs(rawVal),
        reason: adjustReason,
        actorEmail: user.email,
      });
      showToast(res.message, 'success');
      applyUser(res.user);
      setAdjustingUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ব্যালেন্স আপডেট ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Handle Toggle Ban
  const handleToggleBan = async (userId: string) => {
    try {
      const res = await toggleUserBanInFirestore(userId, user.email);
      showToast(res.message, 'info');
      applyUser(res.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ব্যান অ্যাকশন ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Handle User VIP Tier Change
  const handleChangeTier = async (userId: string, tier: VipTier) => {
    try {
      const res = await setUserTierInFirestore(userId, tier, user.email);
      showToast(res.message, 'success');
      applyUser(res.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'প্যাকেজ পরিবর্তন ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Save Custom Daily Limit for specific user
  const handleSaveCustomLimit = async () => {
    if (!userForCustomLimit) return;
    try {
      const parsedLimit = customLimitInput.trim() === '' ? null : Number(customLimitInput);
      const res = await setUserCustomLimitInFirestore(userForCustomLimit.id, parsedLimit, user.email);
      showToast(res.message, 'success');
      applyUser(res.user);
      setUserForCustomLimit(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'লিমিট আপডেট ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Reset Today's Solved Quota for all users
  const handleResetDailyQuotas = async () => {
    try {
      const message = await resetAllDailyQuotasInFirestore(user.email);
      showToast(message, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'রিসেট ব্যর্থ';
      showToast(msg, 'error');
    }
  };

  // Save Settings
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settings) return;
    await persistSettings(settings);
  };

  // Separate Deposit requests from Mobile Recharge requests
  const depositRequests = useMemo(() => recharges.filter(r => r.method !== 'Mobile Recharge'), [recharges]);
  const mobileRecharges = useMemo(() => recharges.filter(r => r.method === 'Mobile Recharge'), [recharges]);

  const pendingDeposits = useMemo(() => depositRequests.filter(r => r.status === 'pending'), [depositRequests]);
  const pendingMobileRecharges = useMemo(() => mobileRecharges.filter(r => r.status === 'pending'), [mobileRecharges]);
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');

  const filteredDeposits = useMemo(() => {
    return depositRequests.filter(d => {
      if (depositStatusFilter !== 'all' && d.status !== depositStatusFilter) return false;
      if (depositMethodFilter !== 'all' && d.method !== depositMethodFilter) return false;
      if (!depositSearchQuery.trim()) return true;
      const q = depositSearchQuery.toLowerCase();
      return (
        d.id.toLowerCase().includes(q) ||
        d.userName.toLowerCase().includes(q) ||
        d.userEmail.toLowerCase().includes(q) ||
        d.senderNumber.toLowerCase().includes(q) ||
        (d.trxId && d.trxId.toLowerCase().includes(q))
      );
    });
  }, [depositRequests, depositStatusFilter, depositMethodFilter, depositSearchQuery]);

  const filteredMobileRecharges = useMemo(() => {
    return mobileRecharges.filter(r => {
      if (rechargeStatusFilter !== 'all' && r.status !== rechargeStatusFilter) return false;
      if (!rechargeSearchQuery.trim()) return true;
      const q = rechargeSearchQuery.toLowerCase();
      return (
        r.id.toLowerCase().includes(q) ||
        r.userName.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        r.senderNumber.toLowerCase().includes(q) ||
        (r.senderSim && r.senderSim.toLowerCase().includes(q)) ||
        (r.trxId && r.trxId.toLowerCase().includes(q))
      );
    });
  }, [mobileRecharges, rechargeStatusFilter, rechargeSearchQuery]);

  const handleCopyTrx = (trxId: string) => {
    if (!trxId) return;
    try {
      navigator.clipboard.writeText(trxId);
      setCopiedTrxId(trxId);
      showToast(`TrxID '${trxId}' কপি করা হয়েছে`, 'success');
      setTimeout(() => setCopiedTrxId(null), 2500);
    } catch {
      showToast('কপি করা সম্ভব হয়নি', 'error');
    }
  };

  const getDepositMethodBadge = (method: string) => {
    const m = (method || '').toLowerCase();
    const raw = settings?.paymentNumbers as Record<string, any> | undefined;
    let logoUrl: string | undefined;
    if (raw) {
      if (m.includes('bkash') || m.includes('বিকাশ')) logoUrl = typeof raw.bkash === 'object' ? raw.bkash?.logoUrl : undefined;
      else if (m.includes('nagad') || m.includes('নগদ')) logoUrl = typeof raw.nagad === 'object' ? raw.nagad?.logoUrl : undefined;
      else if (m.includes('rocket') || m.includes('রকেট')) logoUrl = typeof raw.rocket === 'object' ? raw.rocket?.logoUrl : undefined;
      else if (m.includes('binance') || m.includes('usdt')) logoUrl = typeof raw.binance === 'object' ? raw.binance?.logoUrl : undefined;
    }

    if (m.includes('bkash') || m.includes('বিকাশ')) {
      return {
        bg: 'bg-[#e2136e]/15 border-[#e2136e]/40 text-[#f03b87]',
        dot: 'bg-[#e2136e]',
        name: 'bKash',
        logoUrl,
      };
    }
    if (m.includes('nagad') || m.includes('নগদ')) {
      return {
        bg: 'bg-[#f7941d]/15 border-[#f7941d]/40 text-[#fb923c]',
        dot: 'bg-[#f7941d]',
        name: 'Nagad',
        logoUrl,
      };
    }
    if (m.includes('rocket') || m.includes('রকেট')) {
      return {
        bg: 'bg-[#8c3494]/15 border-[#8c3494]/40 text-[#c084fc]',
        dot: 'bg-[#8c3494]',
        name: 'Rocket',
        logoUrl,
      };
    }
    if (m.includes('binance') || m.includes('usdt')) {
      return {
        bg: 'bg-[#f3ba2f]/15 border-[#f3ba2f]/40 text-[#facc15]',
        dot: 'bg-[#f3ba2f]',
        name: 'Binance USDT',
        logoUrl,
      };
    }
    return {
      bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
      dot: 'bg-emerald-400',
      name: method || 'Payment',
      logoUrl,
    };
  };

  const getWithdrawalMethodLogo = (method: string): string | undefined => {
    const m = (method || '').toLowerCase();
    const raw = settings?.paymentNumbers as Record<string, any> | undefined;
    if (!raw) return undefined;
    if (m.includes('bkash') || m.includes('বিকাশ')) return typeof raw.bkash === 'object' ? raw.bkash?.logoUrl : undefined;
    if (m.includes('nagad') || m.includes('নগদ')) return typeof raw.nagad === 'object' ? raw.nagad?.logoUrl : undefined;
    if (m.includes('rocket') || m.includes('রকেট')) return typeof raw.rocket === 'object' ? raw.rocket?.logoUrl : undefined;
    if (m.includes('binance') || m.includes('usdt')) return typeof raw.binance === 'object' ? raw.binance?.logoUrl : undefined;
    return undefined;
  };

  // Handle mobile gallery upload for payment gateway logo (immediately saves to Firestore!)
  const handleGatewayLogoUpload = async (key: string, file: File) => {
    const base = settingsRef.current || settings || contextSettings || getDefaultSettings();
    setUploadingLogoKey(`gateway:${key}`);
    try {
      showToast('লোগো প্রসেস ও ক্লাউডে সেভ হচ্ছে...', 'info');
      const dataUrl = await compressImageToDataUrl(file, 240, 0.85);
      const raw = base.paymentNumbers?.[key];
      const cfg = typeof raw === 'object' && raw !== null ? raw : {
        number: String(raw || ''),
        accountType: 'Personal',
        actionType: 'Send Money',
        enabled: true,
        logoUrl: '',
      };
      const updated = {
        ...base.paymentNumbers,
        [key]: { ...cfg, logoUrl: dataUrl },
      };
      const nextSettings: SystemSettings = { ...base, paymentNumbers: updated };
      setBrokenLogoKeys(prev => ({ ...prev, [`gateway:${key}`]: false }));
      const ok = await persistSettings(nextSettings, true);
      if (ok) {
        showToast('লোগো সফলভাবে আপলোড ও সেভ হয়েছে! ডিপোজিট ও উইথড্র অপশনে এখনই দেখাবে।', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ছবি আপলোড ব্যর্থ হয়েছে';
      showToast(msg, 'error');
    } finally {
      setUploadingLogoKey(null);
    }
  };

  // Handle mobile gallery upload for operator logo (immediately saves to Firestore!)
  const handleOperatorLogoUpload = async (operatorId: string, file: File) => {
    const base = settingsRef.current || settings || contextSettings || getDefaultSettings();
    setUploadingLogoKey(`operator:${operatorId}`);
    try {
      showToast('সিম লোগো প্রসেস ও ক্লাউডে সেভ হচ্ছে...', 'info');
      const dataUrl = await compressImageToDataUrl(file, 240, 0.85);
      const updated = {
        ...(base.operatorLogos || {}),
        [operatorId]: dataUrl,
      };
      const nextSettings: SystemSettings = { ...base, operatorLogos: updated };
      setBrokenLogoKeys(prev => ({ ...prev, [`operator:${operatorId}`]: false }));
      const ok = await persistSettings(nextSettings, true);
      if (ok) {
        showToast(`${operatorId} এর লোগো সফলভাবে আপলোড ও সেভ হয়েছে! রিচার্জ অপশনে এখনই দেখাবে।`, 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ছবি আপলোড ব্যর্থ হয়েছে';
      showToast(msg, 'error');
    } finally {
      setUploadingLogoKey(null);
    }
  };

  const checkOnline = (u: User): boolean => {
    if (u.id === user.id) return true;
    if (u.lastSeen) {
      return presenceNowMs - new Date(u.lastSeen).getTime() <= 90_000;
    }
    return Boolean(u.isOnline);
  };

  const onlineUsersList = users.filter(u => checkOnline(u));
  const offlineUsersList = users.filter(u => !checkOnline(u));
  const bannedUsersList = users.filter(u => Boolean(u.isBanned));
  const totalUsersBalance = Math.round(users.reduce((sum, u) => sum + (Number(u.balance) || 0), 0) * 100) / 100;

  const formatLastSeen = (iso?: string) => {
    if (!iso) return 'তথ্য নেই';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffSec < 60) return 'এইমাত্র';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} মিনিট আগে`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ঘন্টা আগে`;
    return new Date(iso).toLocaleDateString();
  };

  const filteredUsers = users
    .filter(u => {
      const matchesSearch =
        u.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (presenceFilter === 'online') return checkOnline(u);
      if (presenceFilter === 'offline') return !checkOnline(u);
      if (presenceFilter === 'banned') return Boolean(u.isBanned);
      return true;
    })
    .sort((a, b) => Number(checkOnline(b)) - Number(checkOnline(a)));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Admin Top Header Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900 border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-4">
          <img
            src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`}
            alt={user.name}
            className="w-14 h-14 rounded-2xl object-cover border-2 border-amber-500/60 shadow-lg shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">অ্যাডমিন কন্ট্রোল সেন্টার</h1>
              <span className="text-[11px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 rounded-full uppercase">
                সুপার অ্যাডমিন
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              স্বাগতম, <strong className="text-white">{user.name}</strong> ({user.email})। আপনার ইমেইল যাচাইকৃত থাকায় সরাসরি সম্পূর্ণ এক্সেস দেওয়া হয়েছে।
            </p>
          </div>
        </div>

        <div className="px-4 py-2 rounded-xl bg-emerald-500/10 text-xs font-semibold text-emerald-300 border border-emerald-500/30 flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
          <span>{isLoading ? 'সিঙ্ক হচ্ছে...' : 'ক্লাউড লাইভ সিঙ্ক'}</span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-900 rounded-2xl border border-slate-800">
        <button
          onClick={() => setAdminTab('overview')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'overview'
              ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>ওভারভিউ</span>
        </button>

        <button
          onClick={() => setAdminTab('rates')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'rates'
              ? 'bg-teal-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>ক্যাপচা ও অ্যাড কন্ট্রোল</span>
        </button>

        <button
          onClick={() => setAdminTab('plans')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'plans'
              ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
              : 'text-amber-300 hover:text-white'
          }`}
        >
          <Crown className="w-4 h-4" />
          <span>প্ল্যান সিস্টেম ({(settings?.earningPlans || getDefaultEarningPlans()).length})</span>
        </button>

        <button
          onClick={() => setAdminTab('deposits')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 relative ${
            adminTab === 'deposits'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>ডিপোজিট আবেদন</span>
          {pendingDeposits.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-400 text-slate-950 text-[10px] font-bold font-mono animate-pulse">
              {pendingDeposits.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setAdminTab('sms-gateway')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'sms-gateway'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Smartphone className={`w-4 h-4 ${adminTab === 'sms-gateway' ? 'text-slate-950' : 'text-emerald-400'}`} />
          <span>SMS গেটওয়ে ও APK</span>
          <span
            className={`w-2 h-2 rounded-full ${
              (smsGatewayState?.stats.onlineDevices || 0) > 0
                ? 'bg-emerald-400 animate-pulse'
                : 'bg-slate-500'
            }`}
          />
        </button>

        <button
          onClick={() => setAdminTab('recharges')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 relative ${
            adminTab === 'recharges'
              ? 'bg-teal-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>মোবাইল রিচার্জ</span>
          {pendingMobileRecharges.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-teal-400 text-slate-950 text-[10px] font-bold font-mono">
              {pendingMobileRecharges.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setAdminTab('withdrawals')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 relative ${
            adminTab === 'withdrawals'
              ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          <span>উইথড্র রিকোয়েস্ট</span>
          {pendingWithdrawals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-cyan-400 text-slate-950 text-[10px] font-bold font-mono">
              {pendingWithdrawals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setAdminTab('users')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'users'
              ? 'bg-indigo-500 text-white shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>ইউজার তালিকা ({users.length})</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {onlineUsersList.length} অনলাইন
          </span>
        </button>

        <button
          onClick={() => setAdminTab('notifications')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 relative ${
            adminTab === 'notifications'
              ? 'bg-rose-500 text-white shadow-md font-bold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Bell className={`w-4 h-4 ${adminTab === 'notifications' ? 'text-white' : 'text-rose-400'}`} />
          <span>নোটিফিকেশন পাঠান</span>
          {(settings?.announcements?.length || 0) > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono ${
              adminTab === 'notifications' ? 'bg-slate-950/30 text-white' : 'bg-rose-500/20 text-rose-300'
            }`}>
              {settings?.announcements?.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setAdminTab('telegram')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'telegram'
              ? 'bg-sky-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Send className={`w-4 h-4 ${adminTab === 'telegram' ? 'text-slate-950' : 'text-sky-400'}`} />
          <span>টেলিগ্রাম বট</span>
        </button>

        <button
          onClick={() => setAdminTab('telemetry')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'telemetry'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <ShieldCheck className={`w-4 h-4 ${adminTab === 'telemetry' ? 'text-slate-950' : 'text-emerald-400'}`} />
          <span>হেলথ ও সেলফ-হিলিং</span>
        </button>

        <button
          onClick={() => setAdminTab('settings')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'settings'
              ? 'bg-purple-500 text-white shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>গেটওয়ে ও সেটিংস</span>
        </button>

        <button
          onClick={() => setAdminTab('logs')}
          className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
            adminTab === 'logs'
              ? 'bg-slate-700 text-white shadow-md font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>অডিট লগস</span>
        </button>
      </div>

      {/* TAB: LIVE PER-CAPTCHA & VIDEO AD SECTION SELECTOR & SETTINGS */}
      {adminTab === 'rates' && settings && (() => {
        const sectionList = [
          {
            type: 'text' as CaptchaType,
            title: 'টেক্সট ক্যাপচা',
            subtitle: 'অক্ষর ও সংখ্যা টাইপ করার ক্যাপচা'
          },
          {
            type: 'math' as CaptchaType,
            title: 'ম্যাথ ক্যাপচা',
            subtitle: 'যোগ-বিয়োগ ও গুণ সমাধানের ক্যাপচা'
          },
          {
            type: 'image_grid' as CaptchaType,
            title: 'গ্রিড নির্বাচন',
            subtitle: 'সঠিক ছবি ও আইকন বাছাই করার ক্যাপচা'
          },
          {
            type: 'slider' as CaptchaType,
            title: 'স্লাইডার পাজল',
            subtitle: 'স্লাইডার ড্র্যাগ করে টার্গেট মেলানোর ক্যাপচা'
          }
        ];
        const adCfg = getAdCfg();
        const videoAdsList = (settings.videoAds || []).filter(
          (v, idx, arr) => v && v.id && arr.findIndex(x => x.id === v.id) === idx
        );
        const activeCaptchaType: CaptchaType = selectedSection === 'ads' ? 'text' : selectedSection;
        const activeMeta = sectionList.find(s => s.type === activeCaptchaType) || sectionList[0];
        const activeCfg = getTypeCfg(activeCaptchaType);

        return (
          <div className="space-y-6">
            {/* Top Bar + Global Payout Mode Toggle */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-teal-400" />
                  <span>ক্যাপচা ও অ্যাড সেকশন কন্ট্রোল (৫টি সেকশন)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  কোনো সেকশন অফ করলে হোমপেজ থেকে সাথে সাথে লুকিয়ে যাবে। অ্যাড সেকশনে ভিডিও লিংক যোগ করুন এবং কোন ইউজার কতটি ভিডিও দেখেছে তা মনিটর করুন।
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    persistSettings({
                      ...settings,
                      useVipMultiplier: !settings.useVipMultiplier
                    })
                  }
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    settings.useVipMultiplier
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {settings.useVipMultiplier
                    ? 'ভিআইপি বোনাস রেট: চালু (গুণিতক)'
                    : 'সঠিক নির্ধারিত টাকা: চালু (সমান রেট)'}
                </button>

                <button
                  type="button"
                  onClick={handleResetDailyQuotas}
                  className="px-3.5 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>আজকের কাউন্ট ০ করুন</span>
                </button>

                <button
                  type="button"
                  onClick={() => persistSettings(settings)}
                  disabled={isSavingSettings}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingSettings ? 'আপডেট হচ্ছে...' : 'সব সেভ করুন'}</span>
                </button>
              </div>
            </div>

            {/* Step 1: 4 Captcha Sections + 5th Ad Section Selector Cards */}
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                ১. সেকশন সিলেক্ট করুন ও অন/অফ নিয়ন্ত্রণ করুন (৪টি ক্যাপচা + অ্যাড সেকশন):
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {sectionList.map(sec => {
                  const cfg = getTypeCfg(sec.type);
                  const isSelected = selectedSection === sec.type;
                  return (
                    <div
                      key={sec.type}
                      onClick={() => setSelectedSection(sec.type)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                        isSelected
                          ? 'bg-slate-900 border-teal-500 ring-2 ring-teal-500/30 shadow-lg'
                          : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                      } ${!cfg.enabled ? 'opacity-75' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-white">{sec.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{sec.subtitle}</div>
                        </div>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            updateCaptchaConfig(sec.type, { enabled: !cfg.enabled }, true);
                          }}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer shrink-0 ${
                            cfg.enabled
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                              : 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                          }`}
                        >
                          {cfg.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-800 text-[11px] font-mono">
                        <div className="text-slate-400">
                          টাকা: <strong className="text-emerald-400">৳{Number(cfg.reward).toFixed(2)}</strong>
                        </div>
                        <div className="text-slate-400 text-right">
                          লিমিট: <strong className="text-cyan-400">{cfg.dailyLimit >= 9999 ? '∞' : `${cfg.dailyLimit} টি`}</strong>
                        </div>
                        <div className="text-slate-400">
                          বিরতি: <strong className="text-amber-300">{cfg.cooldownSeconds === 0 ? '0s' : `${cfg.cooldownSeconds}s`}</strong>
                        </div>
                        <div className="text-slate-400 text-right">
                          সময়: <strong className="text-purple-300">{cfg.timeLimitSeconds}s</strong>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* 5th Section Card: অ্যাড দেখে ইনকাম (Video Ad Section) */}
                <div
                  onClick={() => setSelectedSection('ads')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                    selectedSection === 'ads'
                      ? 'bg-slate-900 border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
                      : 'bg-purple-950/20 border-purple-500/30 hover:border-purple-400/60'
                  } ${!adCfg.enabled ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-1.5">
                        <PlayCircle className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>অ্যাড দেখে ইনকাম</span>
                      </div>
                      <div className="text-[11px] text-purple-200/70 mt-0.5">
                        ভিডিও লিংক ও ১০s মনিটর
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        updateAdConfig({ enabled: !adCfg.enabled }, true);
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer shrink-0 ${
                        adCfg.enabled
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                          : 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                      }`}
                    >
                      {adCfg.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-purple-500/20 text-[11px] font-mono">
                    <div className="text-slate-400">
                      টাকা: <strong className="text-emerald-400">৳{Number(adCfg.reward).toFixed(2)}</strong>
                    </div>
                    <div className="text-slate-400 text-right">
                      লিমিট: <strong className="text-cyan-400">{adCfg.dailyLimit >= 9999 ? '∞' : `${adCfg.dailyLimit} টি`}</strong>
                    </div>
                    <div className="text-slate-400">
                      দেখার সময়: <strong className="text-amber-300">{adCfg.minWatchSeconds}s</strong>
                    </div>
                    <div className="text-slate-400 text-right">
                      লিংক: <strong className="text-purple-300">{videoAdsList.length} টি</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Dedicated Live Editor — either Video Ad Section OR Selected Captcha Section */}
            {selectedSection === 'ads' ? (
              <div className="space-y-6">
                {/* Ad Section Controls */}
                <div className="bg-slate-900 border border-purple-500/30 rounded-3xl p-6 space-y-6 shadow-2xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                        অ্যাড সেকশন কন্ট্রোল ও মনিটরিং
                      </span>
                      <h4 className="text-lg font-bold text-white mt-0.5 flex items-center gap-2">
                        <Tv className="w-5 h-5 text-purple-400" />
                        <span>অ্যাড দেখে ইনকাম (ভিডিও অ্যাড সেকশন)</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        এখান থেকে হোমপেজের অ্যাড সেকশন অন/অফ করুন, ভিডিও লিংক যোগ করুন এবং ইউজার ভিউ রিপোর্ট দেখুন।
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => updateAdConfig({ enabled: !adCfg.enabled }, true)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        adCfg.enabled
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                          : 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                      }`}
                    >
                      {adCfg.enabled
                        ? 'হোমপেজে চালু আছে (ক্লিক করে বন্ধ করুন)'
                        : 'হোমপেজ থেকে বন্ধ আছে (ক্লিক করে চালু করুন)'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* 1. Default Reward Per Video Ad */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">১. প্রতি ভিডিও অ্যাড দেখায় টাকা (৳):</span>
                        <span className="text-lg font-extrabold font-mono text-emerald-400 tabular-nums">
                          ৳{Number(adCfg.reward).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateAdConfig({ reward: Math.max(0.5, Math.round((adCfg.reward - 1) * 100) / 100) })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-mono font-bold border border-rose-500/30 cursor-pointer"
                        >
                          -৳1
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={adCfg.reward}
                          onChange={e => updateAdConfig({ reward: Math.max(0, Number(e.target.value)) }, false)}
                          className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateAdConfig({ reward: Math.round((adCfg.reward + 1) * 100) / 100 })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30 cursor-pointer"
                        >
                          +৳1
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateAdConfig({ reward: Math.round((adCfg.reward + 5) * 100) / 100 })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/35 text-emerald-200 text-xs font-mono font-bold border border-emerald-500/40 cursor-pointer"
                        >
                          +৳5
                        </button>
                      </div>
                    </div>

                    {/* 2. Minimum Watch Duration (Default 10s) */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">২. ন্যূনতম কত সেকেন্ড ভিডিও দেখতে হবে:</span>
                        <span className="text-lg font-extrabold font-mono text-amber-300 tabular-nums">
                          {adCfg.minWatchSeconds} সেকেন্ড
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[5, 10, 15, 20, 30, 60].map(sec => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => updateAdConfig({ minWatchSeconds: sec })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                              adCfg.minWatchSeconds === sec
                                ? 'bg-amber-500/25 border-amber-500 text-amber-200'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                        <input
                          type="number"
                          min="3"
                          value={adCfg.minWatchSeconds}
                          onChange={e =>
                            updateAdConfig({ minWatchSeconds: Math.max(3, Number(e.target.value)) }, false)
                          }
                          className="w-20 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    {/* 3. Cooldown Interval */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">৩. কত সময় পরপর নতুন অ্যাড আসবে (সেকেন্ড):</span>
                        <span className="text-lg font-extrabold font-mono text-purple-300 tabular-nums">
                          {adCfg.cooldownSeconds === 0 ? 'তাৎক্ষণিক (0s)' : `${adCfg.cooldownSeconds} সেকেন্ড`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {[0, 3, 5, 10, 30].map(sec => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => updateAdConfig({ cooldownSeconds: sec })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                              adCfg.cooldownSeconds === sec
                                ? 'bg-purple-500/25 border-purple-500 text-purple-200'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                        <input
                          type="number"
                          min="0"
                          value={adCfg.cooldownSeconds}
                          onChange={e =>
                            updateAdConfig({ cooldownSeconds: Math.max(0, Number(e.target.value)) }, false)
                          }
                          className="w-20 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {/* 4. Daily Video Ad Limit */}
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">৪. প্রতিদিন কতটি ভিডিও দেখতে পারবে:</span>
                        <span className="text-lg font-extrabold font-mono text-cyan-400 tabular-nums">
                          {adCfg.dailyLimit >= 9999 ? 'আনলিমিটেড' : `${adCfg.dailyLimit} টি`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateAdConfig({ dailyLimit: Math.max(0, adCfg.dailyLimit - 5) })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-mono font-bold border border-rose-500/30 cursor-pointer"
                        >
                          -5
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={adCfg.dailyLimit}
                          onChange={e =>
                            updateAdConfig({ dailyLimit: Math.max(0, Number(e.target.value)) }, false)
                          }
                          className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateAdConfig({ dailyLimit: adCfg.dailyLimit + 5 })}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30 cursor-pointer"
                        >
                          +5
                        </button>
                        <button
                          type="button"
                          onClick={() => updateAdConfig({ dailyLimit: 9999 })}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold border border-amber-500/30 cursor-pointer"
                        >
                          আনলিমিটেড
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => persistSettings(settings)}
                      disabled={isSavingSettings}
                      className="px-6 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-lg"
                    >
                      <Save className="w-4 h-4" />
                      <span>{isSavingSettings ? 'আপডেট হচ্ছে...' : 'অ্যাড সেটিংস সেভ করুন'}</span>
                    </button>
                  </div>
                </div>

                {/* Video Ad Links Manager */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-base font-bold text-white flex items-center gap-2">
                        <PlayCircle className="w-5 h-5 text-purple-400" />
                        <span>ভিডিও অ্যাডের লিংক ম্যানেজার ({videoAdsList.length} টি)</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        এখানে যোগ করা ভিডিওগুলো ক্লাউড ডেটাবেসে স্থায়ীভাবে সেভ থাকবে (পেজ রিফ্রেশ দিলেও মুছবে না)। কোনো ইউজার ভিডিওটি দেখে টাকা পেলে সেটি শুধুমাত্র সেই ইউজারের তালিকা থেকে স্বয়ংক্রিয়ভাবে সরে যাবে, কিন্তু অ্যাডমিন প্যানেলে সেভ থাকবে এবং চাইলে এখান থেকে পুনরায় চালু করতে পারবেন।
                      </p>
                    </div>
                  </div>

                  {/* Add New Video Link Form */}
                  <form onSubmit={handleAddVideoAd} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-3">
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">ভিডিও শিরোনাম</label>
                      <input
                        type="text"
                        placeholder="যেমন: স্পেশাল ভিডিও অ্যাড"
                        value={newAdTitle}
                        onChange={e => setNewAdTitle(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="md:col-span-5">
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">ভিডিও লিংক (URL)</label>
                      <input
                        type="text"
                        required
                        placeholder="https://.../v/..."
                        value={newAdUrl}
                        onChange={e => setNewAdUrl(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">টাকা (ঐচ্ছিক)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder={`ডিফল্ট ৳${adCfg.reward}`}
                        value={newAdReward}
                        onChange={e => setNewAdReward(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="submit"
                        disabled={isSavingSettings}
                        className="w-full py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{isSavingSettings ? 'সেভ হচ্ছে...' : 'লিংক যোগ করুন'}</span>
                      </button>
                    </div>
                  </form>

                  {/* Video Links Table / Cards */}
                  <div className="space-y-2.5">
                    {videoAdsList.length === 0 ? (
                      <div className="text-center py-6 text-xs text-slate-500">
                        এখনো কোনো ভিডিও লিংক যোগ করা হয়নি।
                      </div>
                    ) : (
                      videoAdsList.map(ad => (
                        <div
                          key={ad.id}
                          className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                        >
                          {editingAdId === ad.id ? (
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <input
                                type="text"
                                value={editAdTitle}
                                onChange={e => setEditAdTitle(e.target.value)}
                                className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                                placeholder="শিরোনাম"
                              />
                              <input
                                type="url"
                                value={editAdUrl}
                                onChange={e => setEditAdUrl(e.target.value)}
                                className="sm:col-span-2 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
                                placeholder="লিংক URL"
                              />
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  step="0.5"
                                  value={editAdReward}
                                  onChange={e => setEditAdReward(e.target.value)}
                                  className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
                                  placeholder="৳"
                                />
                                <button
                                  type="button"
                                  onClick={handleSaveEditedVideoAd}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs cursor-pointer"
                                >
                                  সেভ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingAdId(null)}
                                  className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                                >
                                  বাতিল
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-white">{ad.title}</span>
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
                                    ৳{(ad.reward ?? adCfg.reward).toFixed(2)}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[11px]">
                                    {ad.minWatchSeconds ?? adCfg.minWatchSeconds}s
                                  </span>
                                  {(() => {
                                    const completedUsersCount = users.filter(u =>
                                      (u.completedAdIds || []).includes(ad.id)
                                    ).length;
                                    return completedUsersCount > 0 ? (
                                      <span className="px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-200 text-[10px] font-semibold">
                                        {completedUsersCount} জন ইউজার দেখেছে (সেভড)
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <a
                                  href={normalizeExternalUrl(ad.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-mono text-cyan-400 hover:underline flex items-center gap-1 truncate max-w-xl"
                                >
                                  <span className="truncate">{ad.url}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono">
                                  <span className="text-purple-300">টিপ/ক্লিক: {(ad.totalClicks || 0) + (adStatsByAdId[ad.id]?.clicks || 0)}</span>
                                  <span className="text-slate-600 mx-1.5">|</span>
                                  <span className="text-emerald-400">সফল ভিউ: {(ad.totalCompletedViews || 0) + (adStatsByAdId[ad.id]?.completed || 0)}</span>
                                  <span className="text-slate-600 mx-1.5">|</span>
                                  <span className="text-rose-400">ব্যর্থ: {(ad.totalIncompleteViews || 0) + (adStatsByAdId[ad.id]?.incomplete || 0)}</span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleResetVideoAd(ad.id)}
                                  className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                  title="যারা দেখেছে তাদের জন্যও এই সেভড ভিডিওটি পুনরায় চালু করুন"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>পুনরায় চালু করুন</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleToggleVideoAd(ad.id)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                                    ad.enabled !== false
                                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                      : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                  }`}
                                >
                                  {ad.enabled !== false ? 'চালু' : 'বন্ধ'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => startEditVideoAd(ad)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                                  title="লিংক রিপ্লেস / এডিট করুন"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteVideoAd(ad.id)}
                                  className="p-1.5 rounded-lg bg-rose-900/40 hover:bg-rose-800/60 text-rose-300 cursor-pointer"
                                  title="মুছে ফেলুন"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* User Video View Analytics & Live Monitor Logs */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Per-user Video View Summary */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Eye className="w-4 h-4 text-cyan-400" />
                        <span>কোন ইউজার কতটি ভিডিও দেখেছে</span>
                      </h4>
                      <span className="text-xs text-slate-400">মোট ইউজার: {users.length}</span>
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                          <tr>
                            <th className="py-2.5 px-4">ইউজার</th>
                            <th className="py-2.5 px-3 text-center">টিপ / ক্লিক</th>
                            <th className="py-2.5 px-3 text-center">আজ দেখেছে</th>
                            <th className="py-2.5 px-3 text-center">মোট / রিভিউ</th>
                            <th className="py-2.5 px-3 text-center">অসম্পূর্ণ (&lt;{adCfg.minWatchSeconds}s)</th>
                            <th className="py-2.5 px-3 text-right">অ্যাড আয়</th>
                            <th className="py-2.5 px-3 text-right">অ্যাকশন</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {[...users]
                            .sort((a, b) => (b.totalAdClicks || 0) - (a.totalAdClicks || 0) || (b.totalVideosWatched || 0) - (a.totalVideosWatched || 0))
                            .map(u => {
                              const lockedCount = (u.completedAdIds || []).length;
                              return (
                                <tr key={u.id} className="hover:bg-slate-800/40">
                                  <td className="py-2.5 px-4">
                                    <div className="font-bold text-white">{u.name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">{u.email}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono font-bold text-purple-300">
                                    {u.totalAdClicks || 0} বার
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono text-cyan-300">
                                    {u.videosWatchedToday || 0} / {adCfg.dailyLimit >= 9999 ? '∞' : adCfg.dailyLimit}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono">
                                    <span className="font-bold text-emerald-400">{u.totalVideosWatched || 0} টি</span>
                                    {lockedCount > 0 && (
                                      <span className="block text-[10px] text-amber-300">
                                        রিভিউ লক: {lockedCount} টি
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono text-rose-400">
                                    {u.incompleteAdsCount || 0} টি
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-300">
                                    ৳{(u.totalAdEarned || 0).toFixed(2)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleResetUserAds(u.id)}
                                      className="px-2 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-[10px] font-bold cursor-pointer whitespace-nowrap"
                                      title="এই ইউজারের রিভিউ লক ও আজকের ভিডিও লিমিট রিসেট করুন"
                                    >
                                      ভিডিও/লিমিট রিসেট
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Live Video Watch Activity Logs */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Tv className="w-4 h-4 text-purple-400" />
                        <span>লাইভ ভিডিও ওয়াচ মনিটর লগ ({adWatchLogs.length})</span>
                      </h4>
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      {adWatchLogs.length === 0 ? (
                        <div className="py-10 text-center text-xs text-slate-500">
                          এখনো কোনো ইউজার ভিডিও অ্যাড দেখেনি।
                        </div>
                      ) : (
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                            <tr>
                              <th className="py-2.5 px-4">ইউজার ও ভিডিও</th>
                              <th className="py-2.5 px-3 text-center">দেখা সময়</th>
                              <th className="py-2.5 px-4 text-right">ফলাফল ও রিভিউ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {adWatchLogs.slice(0, 40).map(log => (
                              <tr key={log.id} className="hover:bg-slate-800/40">
                                <td className="py-2.5 px-4">
                                  <div className="font-bold text-white">{log.userName}</div>
                                  <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                                    {log.adTitle}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                                  {log.watchedSeconds}s / {log.requiredSeconds}s
                                </td>
                                <td className="py-2.5 px-4 text-right space-y-1">
                                  {log.status === 'completed' ? (
                                    <div className="flex flex-col items-end gap-1">
                                      <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold text-[10px]">
                                        সফল +৳{log.earned.toFixed(2)}
                                      </span>
                                      {log.reviewStatus === 'in_review' ? (
                                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold text-[9px]">
                                          রিভিউতে (হাইড করা)
                                        </span>
                                      ) : log.reviewStatus === 'reviewed' ? (
                                        <span className="inline-block px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-semibold text-[9px]">
                                          রিসেট সম্পন্ন
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <span className="inline-block px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold text-[10px]">
                                      টাকা যোগ হয়নি
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400">
                      নির্বাচিত সেকশন সেটিংস
                    </span>
                    <h4 className="text-lg font-bold text-white mt-0.5">{activeMeta.title}</h4>
                    <p className="text-xs text-slate-400">{activeMeta.subtitle}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => updateCaptchaConfig(activeCaptchaType, { enabled: !activeCfg.enabled }, true)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                      activeCfg.enabled
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                        : 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                    }`}
                  >
                    {activeCfg.enabled
                      ? 'হোমপেজে চালু আছে (ক্লিক করে বন্ধ করুন)'
                      : 'হোমপেজ থেকে বন্ধ আছে (ক্লিক করে চালু করুন)'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* 1. Exact Reward Per Captcha */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">১. প্রতি ক্যাপচায় কত টাকা দিবে (৳ ও পয়সা):</span>
                      <span className="text-lg font-extrabold font-mono text-emerald-400 tabular-nums">
                        ৳{Number(activeCfg.reward).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            reward: Math.max(0.05, Math.round((activeCfg.reward - 0.5) * 100) / 100)
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-mono font-bold border border-rose-500/30 cursor-pointer"
                      >
                        -৳0.50
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            reward: Math.max(0.05, Math.round((activeCfg.reward - 0.1) * 100) / 100)
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -10 পয়সা
                      </button>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={activeCfg.reward}
                        onChange={e =>
                          updateCaptchaConfig(activeCaptchaType, { reward: Math.max(0, Number(e.target.value)) }, false)
                        }
                        className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            reward: Math.round((activeCfg.reward + 0.1) * 100) / 100
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +10 পয়সা
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            reward: Math.round((activeCfg.reward + 0.5) * 100) / 100
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30 cursor-pointer"
                      >
                        +৳0.50
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            reward: Math.round((activeCfg.reward + 1.0) * 100) / 100
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/35 text-emerald-200 text-xs font-mono font-bold border border-emerald-500/40 cursor-pointer"
                      >
                        +৳1.00
                      </button>
                    </div>
                  </div>

                  {/* 2. Cooldown Interval: How often a new captcha arrives */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">২. কত সময় পরপর নতুন ক্যাপচা আসবে (সেকেন্ড):</span>
                      <span className="text-lg font-extrabold font-mono text-amber-300 tabular-nums">
                        {activeCfg.cooldownSeconds === 0 ? 'তাৎক্ষণিক (0s)' : `${activeCfg.cooldownSeconds} সেকেন্ড`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[0, 3, 5, 10, 30, 60].map(sec => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => updateCaptchaConfig(activeCaptchaType, { cooldownSeconds: sec })}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold border cursor-pointer ${
                            activeCfg.cooldownSeconds === sec
                              ? 'bg-amber-500/25 border-amber-500 text-amber-200'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                          }`}
                        >
                          {sec === 0 ? '0s' : `${sec}s`}
                        </button>
                      ))}
                      <input
                        type="number"
                        min="0"
                        value={activeCfg.cooldownSeconds}
                        onChange={e =>
                          updateCaptchaConfig(activeCaptchaType, { cooldownSeconds: Math.max(0, Number(e.target.value)) }, false)
                        }
                        className="w-20 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* 3. Daily Captcha Limit */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">৩. প্রতিদিন কতটা ক্যাপচা পূরণ করতে পারবে (টি):</span>
                      <span className="text-lg font-extrabold font-mono text-cyan-400 tabular-nums">
                        {activeCfg.dailyLimit >= 9999 ? 'আনলিমিটেড' : `${activeCfg.dailyLimit} টি`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            dailyLimit: Math.max(0, activeCfg.dailyLimit - 10)
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-mono font-bold border border-rose-500/30 cursor-pointer"
                      >
                        -10
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            dailyLimit: Math.max(0, activeCfg.dailyLimit - 1)
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -1
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={activeCfg.dailyLimit}
                        onChange={e =>
                          updateCaptchaConfig(activeCaptchaType, { dailyLimit: Math.max(0, Number(e.target.value)) }, false)
                        }
                        className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            dailyLimit: activeCfg.dailyLimit + 1
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            dailyLimit: activeCfg.dailyLimit + 10
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/30 cursor-pointer"
                      >
                        +10
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCaptchaConfig(activeCaptchaType, { dailyLimit: 9999 })}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold border border-amber-500/30 cursor-pointer"
                      >
                        আনলিমিটেড
                      </button>
                    </div>
                  </div>

                  {/* 4. Time Limit Per Captcha */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">৪. সমাধান করার সময়সীমা (সেকেন্ড):</span>
                      <span className="text-lg font-extrabold font-mono text-purple-300 tabular-nums">
                        {activeCfg.timeLimitSeconds} সেকেন্ড
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            timeLimitSeconds: Math.max(5, activeCfg.timeLimitSeconds - 5)
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        -5s
                      </button>
                      <input
                        type="number"
                        min="5"
                        max="300"
                        value={activeCfg.timeLimitSeconds}
                        onChange={e =>
                          updateCaptchaConfig(activeCaptchaType, { timeLimitSeconds: Math.max(5, Number(e.target.value)) }, false)
                        }
                        className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-white text-center focus:outline-none focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateCaptchaConfig(activeCaptchaType, {
                            timeLimitSeconds: activeCfg.timeLimitSeconds + 5
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700 cursor-pointer"
                      >
                        +5s
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => persistSettings(settings)}
                    disabled={isSavingSettings}
                    className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-950"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSavingSettings ? 'আপডেট হচ্ছে...' : `${activeMeta.title} রিয়েল-টাইমে আপডেট ও সেভ করুন`}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB 1: OVERVIEW */}
      {adminTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/40 bg-emerald-500/5">
              <div className="flex items-center gap-1.5 text-xs text-emerald-300 mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>এখন অনলাইন</span>
              </div>
              <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                {onlineUsersList.length} / {users.length}
              </span>
              <span className="block text-[10px] text-slate-400 mt-0.5">
                অফলাইন: {offlineUsersList.length} জন
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">মোট রেজিস্টার্ড ইউজার</span>
              <span className="text-2xl font-bold font-mono text-white tabular-nums">
                {stats?.totalUsers || users.length}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">অনুমোদিত ডিপোজিট</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                ৳{stats?.totalDepositVolume || 0}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">অনুমোদিত রিচার্জ</span>
              <span className="text-2xl font-bold font-mono text-teal-400 tabular-nums">
                ৳{stats?.totalRechargeVolume || 0}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">মোট পেইড উইথড্র</span>
              <span className="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
                ৳{stats?.totalWithdrawalVolume || 0}
              </span>
            </div>

            <div
              onClick={() => setAdminTab('deposits')}
              className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/30 bg-emerald-500/5 cursor-pointer hover:border-emerald-400 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-300 block mb-1">পেন্ডিং ডিপোজিট</span>
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                {pendingDeposits.length} টি
              </span>
            </div>

            <div
              onClick={() => setAdminTab('recharges')}
              className="p-4 rounded-2xl bg-slate-900 border border-teal-500/30 bg-teal-500/5 cursor-pointer hover:border-teal-400 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-teal-300 block mb-1">পেন্ডিং রিচার্জ</span>
                <Smartphone className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <span className="text-2xl font-bold font-mono text-teal-400 tabular-nums">
                {pendingMobileRecharges.length} টি
              </span>
            </div>

            <div
              onClick={() => setAdminTab('withdrawals')}
              className="p-4 rounded-2xl bg-slate-900 border border-cyan-500/30 bg-cyan-500/5 cursor-pointer hover:border-cyan-400 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-300 block mb-1">পেন্ডিং উইথড্র</span>
                <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <span className="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
                {pendingWithdrawals.length} টি
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">মোট ক্যাপচা সমাধান</span>
              <span className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
                {stats?.totalCaptchasSolved || 0} টি
              </span>
            </div>

            <div
              onClick={() => {
                setSelectedSection('ads');
                setAdminTab('rates');
              }}
              className="p-4 rounded-2xl bg-purple-950/25 border border-purple-500/40 cursor-pointer hover:border-purple-400 transition-colors"
            >
              <span className="text-xs text-purple-300 block mb-1">ভিডিও অ্যাড ও টিপ</span>
              <span className="text-2xl font-bold font-mono text-purple-300 tabular-nums">
                {stats?.totalAdViewsCompleted || 0} টি
              </span>
              <span className="block text-[10px] text-slate-400 mt-0.5">
                টিপ/ক্লিক: {stats?.totalAdClicks || 0} · ব্যর্থ: {stats?.totalAdViewsIncomplete || 0} · ৳{stats?.totalAdPaidOut || 0}
              </span>
            </div>
          </div>

          {/* Quick Video Ad Income ON/OFF Banner in Overview */}
          {settings && (() => {
            const adCfg = getAdCfg();
            return (
              <div className="p-4 rounded-2xl bg-slate-900 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                    <PlayCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <span>ভিডিও দেখে ইনকাম সেকশন</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          adCfg.enabled
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                        }`}
                      >
                        {adCfg.enabled ? 'চালু (ON)' : 'বন্ধ (OFF)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      মোট ভিডিও লিংক: {(settings.videoAds || []).length} টি · মোট টিপ/ক্লিক: {stats?.totalAdClicks || 0} বার · ন্যূনতম সময়: {adCfg.minWatchSeconds}s · প্রতি ভিডিও: ৳{Number(adCfg.reward).toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateAdConfig({ enabled: !adCfg.enabled }, true)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                      adCfg.enabled
                        ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/40 text-rose-200'
                        : 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-200'
                    }`}
                  >
                    {adCfg.enabled ? 'ভিডিও দেখে ইনকাম: বন্ধ (OFF) করুন' : 'ভিডিও দেখে ইনকাম: চালু (ON) করুন'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSection('ads');
                      setAdminTab('rates');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    ভিডিও লিংক ও রিভিউ ম্যানেজ
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Real-Time Online & Offline User Presence & Balance Monitor */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>রিয়েল-টাইম ইউজার, ব্যালেন্স ও অনলাইন মনিটর ({onlineUsersList.length} অনলাইন · {offlineUsersList.length} অফলাইন)</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold">
                  মোট ইউজার ব্যালেন্স: ৳{totalUsersBalance.toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => setAdminTab('users')}
                className="text-xs text-indigo-400 hover:underline cursor-pointer"
              >
                সকল ইউজার ম্যানেজ করুন →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...onlineUsersList, ...offlineUsersList].slice(0, 12).map(u => {
                const isOn = checkOnline(u);
                return (
                  <div
                    key={u.id}
                    className={`p-3 rounded-xl border space-y-2.5 ${
                      u.isBanned
                        ? 'bg-rose-950/20 border-rose-500/40'
                        : isOn
                        ? 'bg-emerald-950/25 border-emerald-500/35'
                        : 'bg-slate-950 border-slate-800 opacity-90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <img
                            src={u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.email}`}
                            alt={u.name}
                            className="w-8 h-8 rounded-full object-cover border border-slate-700"
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                              isOn ? 'bg-emerald-400' : 'bg-slate-500'
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate flex items-center gap-1">
                            <span className="truncate">{u.name}</span>
                            {u.isBanned && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0">
                                ব্যান
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">{u.email}</div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {isOn ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            অনলাইন
                          </span>
                        ) : (
                          <div>
                            <span className="inline-block text-[10px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                              অফলাইন
                            </span>
                            <div className="text-[9px] text-slate-500 mt-0.5">{formatLastSeen(u.lastSeen || u.lastLogin)}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <div className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
                        ব্যালেন্স: ৳{Number(u.balance || 0).toFixed(2)}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustingUser(u);
                            setBalanceMode('add');
                            setBalanceDelta('100');
                          }}
                          className="px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10px] font-bold cursor-pointer"
                        >
                          +ব্যালেন্স
                        </button>
                        {u.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleToggleBan(u.id)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border cursor-pointer ${
                              u.isBanned
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                : 'bg-rose-500/15 border-rose-500/35 text-rose-300'
                            }`}
                          >
                            {u.isBanned ? 'আনব্যান' : 'ব্যান'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Action Tables Split: Deposits, Mobile Recharges, Withdrawals */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Urgent Pending Deposits */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-emerald-500/30 bg-emerald-950/10 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  <span>পেন্ডিং ডিপোজিট ({pendingDeposits.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setAdminTab('deposits')}
                  className="text-xs text-emerald-400 hover:underline cursor-pointer"
                >
                  সকল ডিপোজিট →
                </button>
              </div>

              {pendingDeposits.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center flex flex-col items-center justify-center gap-1.5">
                  <Wallet className="w-6 h-6 text-slate-700" />
                  <span>কোনো পেন্ডিং ডিপোজিট আবেদন নেই</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingDeposits.slice(0, 4).map(d => {
                    const badge = getDepositMethodBadge(d.method);
                    return (
                      <div
                        key={d.id}
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{d.userName}</span>
                            <span className="text-emerald-400 font-mono font-bold">৳{d.amount.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 ${badge.bg}`}>
                              <BrandLogo
                                src={badge.logoUrl}
                                alt={badge.name}
                                className="w-4 h-4 rounded-sm"
                                imgClassName="w-full h-full object-contain"
                                fallback={<span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />}
                              />
                              <span>{badge.name}</span>
                            </span>
                            <span className="text-slate-400 font-mono text-[11px] truncate">{d.senderNumber}</span>
                          </div>
                          {d.trxId && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400 font-mono">
                              <span>TrxID: {d.trxId}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyTrx(d.trxId)}
                                className="text-slate-400 hover:text-white"
                              >
                                {copiedTrxId === d.trxId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRechargeAction(d.id, 'approve')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer shadow-sm transition-colors text-center"
                          >
                            অনুমোদন
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectingItem({
                              id: d.id,
                              type: 'deposit',
                              userName: d.userName,
                              amount: d.amount,
                              method: d.method,
                            })}
                            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-300 font-medium text-[11px] cursor-pointer text-center"
                          >
                            বাতিল
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Urgent Pending Mobile Recharges */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-teal-500/30 bg-teal-950/10 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-teal-400" />
                  <span>পেন্ডিং মোবাইল রিচার্জ ({pendingMobileRecharges.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setAdminTab('recharges')}
                  className="text-xs text-teal-400 hover:underline cursor-pointer"
                >
                  সকল রিচার্জ →
                </button>
              </div>

              {pendingMobileRecharges.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center flex flex-col items-center justify-center gap-1.5">
                  <Smartphone className="w-6 h-6 text-slate-700" />
                  <span>কোনো পেন্ডিং রিচার্জ আবেদন নেই</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingMobileRecharges.slice(0, 4).map(r => (
                    <div
                      key={r.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{r.userName}</span>
                          <span className="text-teal-400 font-mono font-bold">৳{r.amount.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {(() => {
                            const opName = r.senderSim || r.method || '';
                            const opLogo = settings?.operatorLogos?.[opName];
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 inline-flex items-center gap-1">
                                <BrandLogo
                                  src={opLogo}
                                  alt={opName}
                                  className="w-4 h-4 rounded-sm"
                                  imgClassName="w-full h-full object-contain"
                                  fallback={<span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
                                />
                                <span>{opName}</span>
                              </span>
                            );
                          })()}
                          <span className="text-slate-400 font-mono text-[11px]">{r.senderNumber}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRechargeAction(r.id, 'approve')}
                          className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-[11px] cursor-pointer shadow-sm transition-colors text-center"
                        >
                          অনুমোদন
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingItem({
                            id: r.id,
                            type: 'recharge',
                            userName: r.userName,
                            amount: r.amount,
                            method: r.senderSim || r.method,
                          })}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-300 font-medium text-[11px] cursor-pointer text-center"
                        >
                          বাতিল
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Urgent Pending Withdrawals */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-500/30 bg-cyan-950/10 space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
                  <span>পেন্ডিং উইথড্র আবেদন ({pendingWithdrawals.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setAdminTab('withdrawals')}
                  className="text-xs text-cyan-400 hover:underline cursor-pointer"
                >
                  সকল উইথড্র →
                </button>
              </div>

              {pendingWithdrawals.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center flex flex-col items-center justify-center gap-1.5">
                  <ArrowDownToLine className="w-6 h-6 text-slate-700" />
                  <span>কোনো পেন্ডিং উইথড্র আবেদন নেই</span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingWithdrawals.slice(0, 4).map(w => (
                    <div
                      key={w.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{w.userName}</span>
                          <span className="text-cyan-400 font-mono font-bold">৳{w.amount.toFixed(2)}</span>
                        </div>
                        {(() => {
                          const wLogo = getWithdrawalMethodLogo(w.method);
                          return (
                            <div className="text-slate-400 text-[11px] font-mono mt-1 flex items-center gap-1.5">
                              {wLogo ? (
                                <img src={wLogo} alt={w.method} className="w-3.5 h-3.5 object-contain rounded-xs bg-slate-900 border border-slate-700/60 p-0.5" />
                              ) : (
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                              )}
                              <span className="text-cyan-300 font-semibold">{w.method}</span>
                              <span>({w.accountNumber}) · {w.accountType}</span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setApprovingWithdrawal(w)}
                          className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] cursor-pointer shadow-sm text-center"
                        >
                          পেমেন্ট দিন
                        </button>
                        <button
                          type="button"
                          onClick={() => handleWithdrawalAction(w.id, 'reject')}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-300 font-medium text-[11px] cursor-pointer text-center"
                        >
                          বাতিল
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: DEPOSIT REQUESTS MANAGEMENT */}
      {adminTab === 'deposits' && (
        <div className="space-y-4">
          {/* Top Banner & KPI Strip */}
          <div className="p-5 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>ডিপোজিট আবেদন ও ভেরিফিকেশন</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold">
                    {pendingDeposits.length} পেন্ডিং
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ইউজারদের বিকাশ, নগদ, রকেট ও বাইনান্স ডিপোজিট TrxID যাচাই করে ব্যালেন্স এক-ক্লিকে অনুমোদন দিন।
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setAdminTab('sms-gateway')}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-xs font-bold flex items-center gap-2 cursor-pointer transition"
              >
                <Smartphone className="w-4 h-4" />
                <span>
                  SMS গেটওয়ে মনিটর ({smsGatewayState?.stats.onlineDevices || 0} ফোন অনলাইন)
                </span>
              </button>
              <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">মোট অনুমোদিত ডিপোজিট</span>
                <span className="text-sm font-bold font-mono text-emerald-400">৳{stats?.totalDepositVolume || 0}</span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">মোট আবেদন সংখ্যা</span>
                <span className="text-sm font-bold font-mono text-white">{depositRequests.length} টি</span>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-lg">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={depositSearchQuery}
                onChange={e => setDepositSearchQuery(e.target.value)}
                placeholder="TrxID, সেন্ডার নাম্বার, ইউজার নাম বা ইমেইল দিয়ে সার্চ করুন..."
                className="w-full pl-10 pr-8 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {depositSearchQuery && (
                <button
                  type="button"
                  onClick={() => setDepositSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter pills: Status */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-1 hidden sm:inline">স্ট্যাটাস:</span>
              {(['all', 'pending', 'approved', 'rejected'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setDepositStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    depositStatusFilter === st
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {st === 'all' && `সব (${depositRequests.length})`}
                  {st === 'pending' && `পেন্ডিং (${pendingDeposits.length})`}
                  {st === 'approved' && `অনুমোদিত (${depositRequests.filter(d => d.status === 'approved').length})`}
                  {st === 'rejected' && `বাতিল (${depositRequests.filter(d => d.status === 'rejected').length})`}
                </button>
              ))}
            </div>

            {/* Filter: Method */}
            <select
              value={depositMethodFilter}
              onChange={e => setDepositMethodFilter(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">সব পেমেন্ট মেথড</option>
              <option value="bKash">bKash (বিকাশ)</option>
              <option value="Nagad">Nagad (নগদ)</option>
              <option value="Rocket">Rocket (রকেট)</option>
              <option value="Binance USDT">Binance (USDT)</option>
            </select>
          </div>

          {/* Deposits Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">আইডি ও ইউজার</th>
                    <th className="py-3 px-4">পেমেন্ট মেথড</th>
                    <th className="py-3 px-4">সেন্ডার নাম্বার / একাউন্ট</th>
                    <th className="py-3 px-4">ট্রানজেকশন আইডি (TrxID)</th>
                    <th className="py-3 px-4 text-right">ডিপোজিট পরিমাণ</th>
                    <th className="py-3 px-4 text-center">সময়</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4 text-center">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredDeposits.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <Wallet className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
                        <div>কোনো ডিপোজিট আবেদন পাওয়া যায়নি</div>
                        {(depositSearchQuery || depositStatusFilter !== 'all' || depositMethodFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setDepositSearchQuery('');
                              setDepositStatusFilter('all');
                              setDepositMethodFilter('all');
                            }}
                            className="mt-2 text-xs text-emerald-400 hover:underline cursor-pointer"
                          >
                            ফিল্টার রিসেট করুন
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredDeposits.map(d => {
                      const badge = getDepositMethodBadge(d.method);
                      const matchedSms = d.trxId
                        ? smsMatchByTrxId.get(d.trxId.trim().toUpperCase())
                        : undefined;
                      const smsAmountExact =
                        matchedSms &&
                        typeof matchedSms.amount === 'number' &&
                        Math.abs(matchedSms.amount - d.amount) <= 1;
                      return (
                        <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-white font-mono text-[11px]">{d.id}</div>
                            <div className="text-slate-200 font-semibold mt-0.5">{d.userName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{d.userEmail}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold text-xs ${badge.bg}`}>
                              <BrandLogo
                                src={badge.logoUrl}
                                alt={badge.name}
                                className="w-5 h-5 rounded"
                                imgClassName="w-full h-full object-contain"
                                fallback={<span className={`w-2 h-2 rounded-full ${badge.dot}`} />}
                              />
                              <span>{badge.name}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-200">
                            <div className="font-bold">{d.senderNumber}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                                <span className="font-mono font-bold text-amber-400 select-all tracking-wider text-xs">
                                  {d.trxId || 'N/A'}
                                </span>
                                {d.trxId && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyTrx(d.trxId)}
                                    title="TrxID কপি করুন"
                                    className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                                  >
                                    {copiedTrxId === d.trxId ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {matchedSms && (
                                <div>
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                      smsAmountExact
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                                        : 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                                    }`}
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    {smsAmountExact
                                      ? `ফোন SMS ম্যাচ ✓ (৳${matchedSms.amount})`
                                      : `TrxID ম্যাচ, SMS পরিমাণ: ৳${matchedSms.amount ?? '?'}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400 text-sm tabular-nums">
                            ৳{d.amount.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-center text-[11px] text-slate-400 whitespace-nowrap">
                            {d.createdAt ? new Date(d.createdAt).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' }) : 'N/A'}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                d.status === 'approved'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : d.status === 'rejected'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                d.status === 'approved' ? 'bg-emerald-400' : d.status === 'rejected' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'
                              }`} />
                              <span>{d.status === 'approved' ? 'অনুমোদিত' : d.status === 'rejected' ? 'বাতিল' : 'পেন্ডিং'}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {d.status === 'pending' ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleRechargeAction(d.id, 'approve', undefined, matchedSms?.id)}
                                  title="ডিপোজিট অনুমোদন করুন (ব্যালেন্স যোগ হবে)"
                                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-colors cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>অনুমোদন</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectingItem({
                                    id: d.id,
                                    type: 'deposit',
                                    userName: d.userName,
                                    amount: d.amount,
                                    method: d.method,
                                  })}
                                  title="আবেদন বাতিল করুন"
                                  className="px-2.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>বাতিল</span>
                                </button>
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-400 space-y-0.5">
                                <div>{d.adminNote || (d.status === 'approved' ? 'ব্যালেন্স যুক্ত হয়েছে' : 'বাতিলকৃত')}</div>
                                {d.processedAt && (
                                  <div className="text-[9px] text-slate-500 font-mono">
                                    {new Date(d.processedAt).toLocaleTimeString('bn-BD', { timeZone: 'Asia/Dhaka' })}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: MOBILE RECHARGE MANAGEMENT */}
      {adminTab === 'recharges' && (
        <div className="space-y-4">
          {/* Top Banner & KPI Strip */}
          <div className="p-5 bg-gradient-to-r from-teal-950/40 via-slate-900 to-slate-900 border border-teal-500/30 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>মোবাইল রিচার্জ আবেদন</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 font-mono font-bold">
                    {pendingMobileRecharges.length} পেন্ডিং
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ইউজারদের মোবাইল সিম কার্ডে এয়ারটাইম রিচার্জ আবেদনসমূহ পর্যালোচনা ও অনুমোদন করুন।
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">মোট অনুমোদিত রিচার্জ</span>
                <span className="text-sm font-bold font-mono text-teal-400">৳{stats?.totalRechargeVolume || 0}</span>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">মোট আবেদন সংখ্যা</span>
                <span className="text-sm font-bold font-mono text-white">{mobileRecharges.length} টি</span>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-lg">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={rechargeSearchQuery}
                onChange={e => setRechargeSearchQuery(e.target.value)}
                placeholder="মোবাইল নাম্বার, সিম অপারেটর, ইউজার নাম বা আইডি দিয়ে খুঁজুন..."
                className="w-full pl-10 pr-8 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
              />
              {rechargeSearchQuery && (
                <button
                  type="button"
                  onClick={() => setRechargeSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter pills: Status */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-1 hidden sm:inline">স্ট্যাটাস:</span>
              {(['all', 'pending', 'approved', 'rejected'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setRechargeStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    rechargeStatusFilter === st
                      ? 'bg-teal-500 text-slate-950 font-bold shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {st === 'all' && `সব (${mobileRecharges.length})`}
                  {st === 'pending' && `পেন্ডিং (${pendingMobileRecharges.length})`}
                  {st === 'approved' && `অনুমোদিত (${mobileRecharges.filter(r => r.status === 'approved').length})`}
                  {st === 'rejected' && `বাতিল (${mobileRecharges.filter(r => r.status === 'rejected').length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Recharges Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">আইডি ও ইউজার</th>
                    <th className="py-3 px-4">সিম অপারেটর</th>
                    <th className="py-3 px-4">রিচার্জ নাম্বার</th>
                    <th className="py-3 px-4">রেফারেন্স TrxID</th>
                    <th className="py-3 px-4 text-right">পরিমাণ</th>
                    <th className="py-3 px-4 text-center">সময়</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4 text-center">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredMobileRecharges.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <Smartphone className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
                        <div>কোনো মোবাইল রিচার্জ আবেদন পাওয়া যায়নি</div>
                        {(rechargeSearchQuery || rechargeStatusFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setRechargeSearchQuery('');
                              setRechargeStatusFilter('all');
                            }}
                            className="mt-2 text-xs text-teal-400 hover:underline cursor-pointer"
                          >
                            ফিল্টার রিসেট করুন
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredMobileRecharges.map(r => (
                      <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white font-mono text-[11px]">{r.id}</div>
                          <div className="text-slate-200 font-semibold mt-0.5">{r.userName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{r.userEmail}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          {(() => {
                            const opName = r.senderSim || r.method || '';
                            const opLogo = settings?.operatorLogos?.[opName];
                            return (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-300 font-semibold text-xs">
                                <BrandLogo
                                  src={opLogo}
                                  alt={opName}
                                  className="w-5 h-5 rounded"
                                  imgClassName="w-full h-full object-contain"
                                  fallback={<span className="w-2 h-2 rounded-full bg-teal-400" />}
                                />
                                <span>{opName}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-200 text-sm">
                          {r.senderNumber}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-amber-400">
                          {r.trxId || 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm tabular-nums">
                          ৳{r.amount.toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-center text-[11px] text-slate-400 whitespace-nowrap">
                          {r.createdAt ? new Date(r.createdAt).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' }) : 'N/A'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              r.status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : r.status === 'rejected'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              r.status === 'approved' ? 'bg-emerald-400' : r.status === 'rejected' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'
                            }`} />
                            <span>{r.status === 'approved' ? 'অনুমোদিত' : r.status === 'rejected' ? 'বাতিল' : 'পেন্ডিং'}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {r.status === 'pending' ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleRechargeAction(r.id, 'approve')}
                                className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>অনুমোদন</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectingItem({
                                  id: r.id,
                                  type: 'recharge',
                                  userName: r.userName,
                                  amount: r.amount,
                                  method: r.senderSim || r.method,
                                })}
                                className="px-2.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>বাতিল</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-[11px]">{r.adminNote || 'সম্পন্ন'}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WITHDRAWALS MANAGEMENT */}
      {adminTab === 'withdrawals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">সকল উত্তোলন রিকোয়েস্ট তালিকা</h3>
            <span className="text-xs text-slate-400">মোট: {withdrawals.length} টি</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">আইডি ও ইউজার</th>
                  <th className="py-3 px-4">মাধ্যম</th>
                  <th className="py-3 px-4">একাউন্ট নাম্বার</th>
                  <th className="py-3 px-4 text-right">পরিমাণ</th>
                  <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                  <th className="py-3 px-4">পেমেন্ট TrxID / নোট</th>
                  <th className="py-3 px-4 text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {withdrawals.map(w => (
                  <tr key={w.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white font-mono">{w.id}</div>
                      <div className="text-slate-300 font-medium">{w.userName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{w.userEmail}</div>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-cyan-400">
                      {(() => {
                        const wLogo = getWithdrawalMethodLogo(w.method);
                        return (
                          <div className="flex items-center gap-2">
                            <BrandLogo
                              src={wLogo}
                              alt={w.method}
                              className="w-6 h-6 rounded"
                              imgClassName="w-full h-full object-contain"
                              fallback={
                                <div className="w-6 h-6 rounded bg-cyan-900/60 border border-cyan-500/40 flex items-center justify-center text-[10px] font-bold text-cyan-300">
                                  {w.method?.charAt(0)?.toUpperCase()}
                                </div>
                              }
                            />
                            <span>{w.method} ({w.accountType})</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {w.accountNumber}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm tabular-nums">
                      ৳{w.amount.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          w.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : w.status === 'rejected'
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                      {w.payoutTrxId ? (
                        <div className="text-emerald-400 font-bold">{w.payoutTrxId}</div>
                      ) : (
                        w.adminNote || '—'
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {w.status === 'pending' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setApprovingWithdrawal(w)}
                            className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-colors cursor-pointer"
                          >
                            পেমেন্ট দিন
                          </button>
                          <button
                            onClick={() => handleWithdrawalAction(w.id, 'reject')}
                            className="px-2 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-xs transition-colors cursor-pointer"
                          >
                            বাতিল
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">{w.adminNote || 'সম্পন্ন'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: USER MANAGEMENT */}
      {adminTab === 'users' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] text-slate-400">মোট ইউজার</div>
              <div className="text-xl font-bold font-mono text-white mt-0.5">{users.length} জন</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-emerald-500/30 bg-emerald-500/5">
              <div className="text-[11px] text-emerald-300">সকল ইউজারের মোট ব্যালেন্স</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5 tabular-nums">৳{totalUsersBalance.toFixed(2)}</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] text-slate-400">অনলাইন / সক্রিয়</div>
              <div className="text-xl font-bold font-mono text-cyan-300 mt-0.5">{onlineUsersList.length} অনলাইন</div>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-rose-500/30 bg-rose-500/5">
              <div className="text-[11px] text-rose-300">ব্যানকৃত ইউজার</div>
              <div className="text-xl font-bold font-mono text-rose-400 mt-0.5">{bannedUsersList.length} জন</div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="নাম বা ইমেইল দিয়ে ইউজার খুঁজুন..."
                value={userSearchQuery}
                onChange={e => setUserSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPresenceFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  presenceFilter === 'all'
                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                সকল ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setPresenceFilter('online')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  presenceFilter === 'online'
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>অনলাইন ({onlineUsersList.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setPresenceFilter('offline')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  presenceFilter === 'offline'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span>অফলাইন ({offlineUsersList.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setPresenceFilter('banned')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  presenceFilter === 'banned'
                    ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Lock className="w-3 h-3" />
                <span>ব্যান ({bannedUsersList.length})</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">ইউজার ও ইমেইল</th>
                    <th className="py-3 px-4">অনলাইন / অফলাইন</th>
                    <th className="py-3 px-4">রোল</th>
                    <th className="py-3 px-4">ভিআইপি প্যাকেজ</th>
                    <th className="py-3 px-4 text-right">ব্যালেন্স</th>
                    <th className="py-3 px-4 text-center">ক্যাপচা সমাধান</th>
                    <th className="py-3 px-4 text-center">ভিডিও অ্যাড ভিউ</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4 text-center">ম্যানেজ অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.map(u => {
                    const isOn = checkOnline(u);
                    return (
                    <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 flex items-center gap-3">
                        <div className="relative shrink-0">
                          <img
                            src={u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.email}`}
                            alt={u.name}
                            className="w-8 h-8 rounded-full object-cover border border-slate-700"
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                              isOn ? 'bg-emerald-400' : 'bg-slate-500'
                            }`}
                          />
                        </div>
                        <div>
                          <div className="font-bold text-white">{u.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {isOn ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-bold">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span>অনলাইন</span>
                          </span>
                        ) : (
                          <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-semibold">
                              <span className="w-2 h-2 rounded-full bg-slate-500" />
                              <span>অফলাইন</span>
                            </span>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {formatLastSeen(u.lastSeen || u.lastLogin)}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {u.role === 'admin' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            ADMIN
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">USER</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={u.vipTier}
                          onChange={e => handleChangeTier(u.id, e.target.value as VipTier)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white uppercase focus:outline-none focus:border-amber-500 cursor-pointer"
                        >
                          <option value="free">FREE</option>
                          <option value="silver">SILVER</option>
                          <option value="gold">GOLD</option>
                          <option value="diamond">DIAMOND</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400 text-sm tabular-nums">
                        ৳{u.balance.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                        <div>
                          {u.captchasSolvedToday} /{' '}
                          {u.customDailyLimit !== undefined
                            ? u.customDailyLimit
                            : u.vipTier === 'diamond'
                            ? ((settings?.dailyDiamondLimit ?? 9999) >= 9999 ? '∞' : settings?.dailyDiamondLimit)
                            : u.vipTier === 'gold'
                            ? settings?.dailyGoldLimit ?? 150
                            : u.vipTier === 'silver'
                            ? settings?.dailySilverLimit ?? 60
                            : settings?.dailyFreeLimit ?? 25}
                        </div>
                        <div className="text-[10px] text-slate-500">মোট: {u.totalCaptchasSolved} টি</div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono">
                        <div className="text-purple-300 font-bold">
                          {u.totalVideosWatched || 0} টি
                        </div>
                        <div className="text-[10px] text-slate-500">
                          আজ: {u.videosWatchedToday || 0} · ব্যর্থ: <span className="text-rose-400">{u.incompleteAdsCount || 0}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {u.isBanned ? (
                            <span className="text-rose-400 text-[11px] font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                              ব্যান
                            </span>
                          ) : (
                            <span className="text-emerald-400 text-[11px] font-medium bg-emerald-500/10 px-2 py-0.5 rounded">
                              সক্রিয়
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                              u.hasWithdrawPin
                                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            <KeyRound className="w-2.5 h-2.5" />
                            <span>{u.hasWithdrawPin ? 'PIN সেট' : 'PIN নেই'}</span>
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustingUser(u);
                              setBalanceMode('add');
                              setBalanceDelta('100');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            title="ব্যালেন্স যোগ / পরিবর্তন"
                          >
                            <Coins className="w-3 h-3 text-emerald-400" />
                            <span>+ ব্যালেন্স</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setUserForCustomLimit(u);
                              setCustomLimitInput(u.customDailyLimit !== undefined ? String(u.customDailyLimit) : '');
                            }}
                            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="ব্যক্তিগত দৈনিক ক্যাপচা লিমিট"
                          >
                            <Sliders className="w-3 h-3 text-cyan-400" />
                            <span>লিমিট</span>
                          </button>

                          {u.hasWithdrawPin && (
                            <button
                              type="button"
                              onClick={() => handleResetUserPin(u.id)}
                              className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                              title="ভুলে যাওয়া ৪-ডিজিট উইথড্র পিন রিসেট করুন"
                            >
                              <KeyRound className="w-3 h-3 text-amber-400" />
                              <span>পিন রিসেট</span>
                            </button>
                          )}

                          {u.role !== 'admin' && (
                            <button
                              type="button"
                              onClick={() => handleToggleBan(u.id)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1 transition-colors cursor-pointer ${
                                u.isBanned
                                  ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/35'
                                  : 'bg-rose-600/25 border-rose-500/50 text-rose-300 hover:bg-rose-600/35'
                              }`}
                              title={u.isBanned ? 'আনব্যান করুন' : 'ইউজার ব্যান করুন'}
                            >
                              {u.isBanned ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                              <span>{u.isBanned ? 'আনব্যান' : 'ব্যান করুন'}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SYSTEM SETTINGS */}
      {adminTab === 'settings' && settings && (
        <div className="space-y-6">
          <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Sliders className="w-5 h-5 text-purple-400" />
              <span>সিস্টেম ও পেমেন্ট সেটিংস</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {hasUnsavedSettings && (
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingSettings ? 'সেভ হচ্ছে...' : 'পরিবর্তন সেভ করুন'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setAdminTab('rates')}
                className="px-3 py-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-semibold cursor-pointer"
              >
                ক্যাপচা সেকশন ও রেট এডিট করুন →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                সর্বনিম্ন উইথড্র পরিমাণ (৳)
              </label>
              <input
                type="number"
                value={settings.minWithdrawal}
                onChange={e => updateDraftSettings(s => ({ ...s, minWithdrawal: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                সিলভার ভিআইপি দৈনিক সীমা
              </label>
              <input
                type="number"
                value={settings.dailySilverLimit ?? 60}
                onChange={e => updateDraftSettings(s => ({ ...s, dailySilverLimit: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                গোল্ড ভিআইপি দৈনিক সীমা
              </label>
              <input
                type="number"
                value={settings.dailyGoldLimit ?? 150}
                onChange={e => updateDraftSettings(s => ({ ...s, dailyGoldLimit: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                ডায়মন্ড ভিআইপি দৈনিক সীমা
              </label>
              <input
                type="number"
                value={settings.dailyDiamondLimit ?? 9999}
                onChange={e => updateDraftSettings(s => ({ ...s, dailyDiamondLimit: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div className="border-t border-slate-800 pt-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                ডিপোজিট ও উত্তোলন গেটওয়ে লোগো, নম্বর ও টাইপ ম্যানেজমেন্ট (বিকাশ, নগদ, রকেট, বাইনান্স)
              </h4>
            </div>
            <p className="text-xs text-slate-400">
              মোবাইলের গ্যালারি থেকে লোগো সিলেক্ট করলে সেটি সাথে সাথেই ক্লাউডে অটো-সেভ হয়ে যাবে এবং ডিপোজিট ও উইথড্র অপশনে দেখাবে। URL পেস্ট করলে পাশের সেভ বাটনে চাপুন।
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['bkash', 'nagad', 'rocket', 'binance'] as const).map(key => {
                const raw = settings.paymentNumbers?.[key];
                const cfg = typeof raw === 'object' && raw !== null ? raw : {
                  number: String(raw || ''),
                  accountType: 'Personal',
                  actionType: 'Send Money',
                  enabled: true,
                  logoUrl: '',
                };
                const titles: Record<string, string> = {
                  bkash: 'বিকাশ (bKash)',
                  nagad: 'নগদ (Nagad)',
                  rocket: 'রকেট (Rocket)',
                  binance: 'বাইন্যান্স (Binance USDT)',
                };
                const fileInputId = `gateway-logo-${key}`;
                const logoKey = `gateway:${key}`;
                const isUploading = uploadingLogoKey === logoKey;
                const isBroken = Boolean(brokenLogoKeys[logoKey] && cfg.logoUrl);

                return (
                  <div key={key} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center p-1 overflow-hidden shrink-0 shadow-inner border ${cfg.logoUrl && !isBroken ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
                          {cfg.logoUrl && !isBroken ? (
                            <img
                              src={cfg.logoUrl}
                              alt={titles[key]}
                              className="w-full h-full object-contain rounded-lg"
                              onLoad={() => setBrokenLogoKeys(prev => (prev[logoKey] ? { ...prev, [logoKey]: false } : prev))}
                              onError={() => setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: true }))}
                            />
                          ) : (
                            <ImageIcon className={`w-4 h-4 ${isBroken ? 'text-rose-400' : 'text-slate-500'}`} />
                          )}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-white block leading-tight">{titles[key]}</span>
                          <span className={`text-[10px] font-mono ${isBroken ? 'text-rose-400' : cfg.logoUrl ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {isBroken ? '⚠ ছবি লোড হচ্ছে না' : cfg.logoUrl ? '✓ কাস্টম লোগো যুক্ত' : 'ডিফল্ট আইকন'}
                          </span>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <span className="text-slate-400">সক্রিয়:</span>
                        <input
                          type="checkbox"
                          checked={cfg.enabled !== false}
                          onChange={e => {
                            updateDraftSettings(s => ({
                              ...s,
                              paymentNumbers: { ...s.paymentNumbers, [key]: { ...cfg, enabled: e.target.checked } },
                            }));
                          }}
                          className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">একাউন্ট নম্বর / আইডি</label>
                        <input
                          type="text"
                          value={cfg.number || ''}
                          onChange={e => {
                            const val = e.target.value;
                            updateDraftSettings(s => ({
                              ...s,
                              paymentNumbers: { ...s.paymentNumbers, [key]: { ...cfg, number: val } },
                            }));
                          }}
                          placeholder="নম্বর লিখুন"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">অ্যাকাউন্ট টাইপ</label>
                        <select
                          value={cfg.accountType || 'Personal'}
                          onChange={e => {
                            const val = e.target.value;
                            updateDraftSettings(s => ({
                              ...s,
                              paymentNumbers: { ...s.paymentNumbers, [key]: { ...cfg, accountType: val } },
                            }));
                          }}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="Personal">Personal (পার্সোনাল)</option>
                          <option value="Agent">Agent (এজেন্ট)</option>
                          <option value="Merchant">Merchant (মার্চেন্ট)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-slate-400 mb-1">লেনদেন পদ্ধতি</label>
                        <select
                          value={cfg.actionType || 'Send Money'}
                          onChange={e => {
                            const val = e.target.value;
                            updateDraftSettings(s => ({
                              ...s,
                              paymentNumbers: { ...s.paymentNumbers, [key]: { ...cfg, actionType: val } },
                            }));
                          }}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="Send Money">Send Money (সেন্ড মানি)</option>
                          <option value="Cash In">Cash In (ক্যাশ ইন)</option>
                          <option value="Payment">Payment (পেমেন্ট)</option>
                          <option value="Deposit">Deposit (ডিপোজিট)</option>
                        </select>
                      </div>
                    </div>

                    {/* Logo Upload from Mobile Gallery & URL */}
                    <div className="pt-2.5 border-t border-slate-900 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
                          <span>গেটওয়ে লোগো ছবি (গ্যালারি বা সরাসরি URL)</span>
                        </span>
                        {cfg.logoUrl && (
                          <button
                            type="button"
                            disabled={isSavingSettings}
                            onClick={async () => {
                              const base = settingsRef.current || settings;
                              if (!base) return;
                              const updated = { ...base.paymentNumbers, [key]: { ...cfg, logoUrl: '' } };
                              setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: false }));
                              const ok = await persistSettings({ ...base, paymentNumbers: updated }, true);
                              if (ok) showToast('লোগো মুছে সেভ করা হয়েছে', 'info');
                            }}
                            className="text-rose-400 hover:text-rose-300 text-[10px] cursor-pointer disabled:opacity-50"
                          >
                            লোগো মুছুন
                          </button>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="file"
                          id={fileInputId}
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) void handleGatewayLogoUpload(key, file);
                            e.target.value = '';
                          }}
                        />
                        <label
                          htmlFor={fileInputId}
                          className={`px-3 py-1.5 rounded-xl bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/35 text-pink-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm shrink-0 ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>{isUploading ? 'আপলোড হচ্ছে...' : 'মোবাইলের গ্যালারি থেকে আপলোড'}</span>
                        </label>

                        <div className="flex-1 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={cfg.logoUrl || ''}
                            onChange={e => {
                              const val = e.target.value.trim();
                              setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: false }));
                              updateDraftSettings(s => ({
                                ...s,
                                paymentNumbers: { ...s.paymentNumbers, [key]: { ...cfg, logoUrl: val } },
                              }));
                            }}
                            placeholder="অথবা সরাসরি ছবির URL পেস্ট করুন..."
                            className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 font-mono"
                          />
                          <button
                            type="button"
                            disabled={isSavingSettings}
                            onClick={() => {
                              const latest = settingsRef.current || settings;
                              if (latest) void persistSettings(latest);
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            সেভ
                          </button>
                        </div>
                      </div>

                      {isBroken && (
                        <p className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
                          এই URL থেকে ছবি লোড করা যাচ্ছে না (ওয়েবপেজ লিংক কাজ করে না)। সরাসরি `.png/.jpg` লিংক দিন অথবা মোবাইলের গ্যালারি থেকে আপলোড করুন।
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile Recharge SIM Operator Logos Section */}
          <div className="border-t border-slate-800 pt-5 space-y-4">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-teal-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-teal-400">
                মোবাইল রিচার্জ সিম অপারেটর লোগো ম্যানেজমেন্ট (গ্রামীনফোন, বাংলালিংক, রবি ইত্যাদি)
              </h4>
            </div>
            <p className="text-xs text-slate-400">
              মোবাইলের গ্যালারি থেকে সিম অপারেটরের লোগো নির্বাচন করলে তা সাথে সাথেই সেভ হয়ে মোবাইল রিচার্জ পেজে প্রদর্শিত হবে।
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {[
                { id: 'Grameenphone', name: 'Grameenphone (গ্রামীনফোন)', short: 'GP', color: 'text-sky-400' },
                { id: 'Banglalink', name: 'Banglalink (বাংলালিংক)', short: 'BL', color: 'text-orange-400' },
                { id: 'Robi', name: 'Robi (রবি)', short: 'Robi', color: 'text-rose-400' },
                { id: 'Airtel', name: 'Airtel (এয়ারটেল)', short: 'Airtel', color: 'text-red-400' },
                { id: 'Teletalk', name: 'Teletalk (টেলিটক)', short: 'Teletalk', color: 'text-emerald-400' },
              ].map(op => {
                const currentLogo = settings.operatorLogos?.[op.id] || '';
                const inputId = `sim-logo-${op.id}`;
                const logoKey = `operator:${op.id}`;
                const isUploading = uploadingLogoKey === logoKey;
                const isBroken = Boolean(brokenLogoKeys[logoKey] && currentLogo);
                return (
                  <div key={op.id} className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center p-1 overflow-hidden shrink-0 shadow-inner ${currentLogo && !isBroken ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
                          {currentLogo && !isBroken ? (
                            <img
                              src={currentLogo}
                              alt={op.name}
                              className="w-full h-full object-contain rounded-lg"
                              onLoad={() => setBrokenLogoKeys(prev => (prev[logoKey] ? { ...prev, [logoKey]: false } : prev))}
                              onError={() => setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: true }))}
                            />
                          ) : (
                            <span className={`font-mono font-bold text-xs ${isBroken ? 'text-rose-400' : op.color}`}>
                              {op.short}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{op.name}</div>
                          <div className={`text-[10px] font-mono ${isBroken ? 'text-rose-400' : currentLogo ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {isBroken ? '⚠ ছবি লোড হচ্ছে না' : currentLogo ? '✓ কাস্টম লোগো সক্রিয়' : 'ডিফল্ট টেক্সট'}
                          </div>
                        </div>
                      </div>
                      {currentLogo && (
                        <button
                          type="button"
                          disabled={isSavingSettings}
                          onClick={async () => {
                            const base = settingsRef.current || settings;
                            if (!base) return;
                            const updated = { ...(base.operatorLogos || {}), [op.id]: '' };
                            setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: false }));
                            const ok = await persistSettings({ ...base, operatorLogos: updated }, true);
                            if (ok) showToast(`${op.name} এর লোগো মুছে সেভ করা হয়েছে`, 'info');
                          }}
                          className="text-rose-400 hover:text-rose-300 text-[10px] cursor-pointer disabled:opacity-50"
                        >
                          মুছুন
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <input
                        type="file"
                        id={inputId}
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) void handleOperatorLogoUpload(op.id, file);
                          e.target.value = '';
                        }}
                      />
                      <label
                        htmlFor={inputId}
                        className={`w-full py-1.5 px-3 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/35 text-teal-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isUploading ? 'আপলোড হচ্ছে...' : 'গ্যালারি থেকে লোগো নির্বাচন'}</span>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={currentLogo}
                          onChange={e => {
                            const val = e.target.value.trim();
                            setBrokenLogoKeys(prev => ({ ...prev, [logoKey]: false }));
                            updateDraftSettings(s => ({
                              ...s,
                              operatorLogos: { ...(s.operatorLogos || {}), [op.id]: val },
                            }));
                          }}
                          placeholder="অথবা সরাসরি ছবির URL দিন..."
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono"
                        />
                        <button
                          type="button"
                          disabled={isSavingSettings}
                          onClick={() => {
                            const latest = settingsRef.current || settings;
                            if (latest) void persistSettings(latest);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          সেভ
                        </button>
                      </div>

                      {isBroken && (
                        <p className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2 py-1">
                          ছবিটি লোড হচ্ছে না — গ্যালারি থেকে আপলোড করুন।
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-800 pt-5">
            <label className="block text-xs font-medium text-slate-300 mb-1">
              ইউজার নোটিশ ও ঘোষণা ব্যানার
            </label>
            <textarea
              rows={2}
              value={settings.notice}
              onChange={e => updateDraftSettings(s => ({ ...s, notice: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* P2P Wallet Transfer Settings */}
          {(() => {
            const p2p = settings.p2pConfig || getDefaultP2PConfig();
            const updateP2p = (patch: Partial<typeof p2p>) =>
              updateDraftSettings(s => ({
                ...s,
                p2pConfig: { ...p2p, ...patch },
              }));
            return (
              <div className="border-t border-slate-800 pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-indigo-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                      P2P ব্যালেন্স ট্রান্সফার সিস্টেম
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateP2p({ enabled: !p2p.enabled })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                      p2p.enabled
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {p2p.enabled ? 'P2P ট্রান্সফার চালু' : 'P2P ট্রান্সফার বন্ধ'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      সর্বনিম্ন ট্রান্সফার (৳)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={10000}
                      value={p2p.minAmount}
                      onChange={e => updateP2p({ minAmount: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      সর্বোচ্চ ট্রান্সফার (৳)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={50000}
                      value={p2p.maxAmount}
                      onChange={e => updateP2p({ maxAmount: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      ট্রান্সফার ফি (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={25}
                      step="0.5"
                      value={p2p.feePercent}
                      onChange={e => updateP2p({ feePercent: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Withdrawal Time-Window & Holiday Scheduler */}
          {(() => {
            const sched = settings.withdrawalSchedule || getDefaultWithdrawalSchedule();
            const updateSched = (patch: Partial<typeof sched>) =>
              updateDraftSettings(s => ({
                ...s,
                withdrawalSchedule: { ...sched, ...patch },
              }));
            const toggleDay = (dayIdx: number) => {
              const exists = sched.closedDays.includes(dayIdx);
              const nextDays = exists
                ? sched.closedDays.filter(d => d !== dayIdx)
                : [...sched.closedDays, dayIdx].sort((a, b) => a - b);
              updateSched({ closedDays: nextDays });
            };
            return (
              <div className="border-t border-slate-800 pt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-cyan-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                      উইথড্র টাইম-উইন্ডো ও হলিডে শিডিউলার (বাংলাদেশ সময়)
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateSched({ enabled: !sched.enabled })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        sched.enabled
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {sched.enabled ? 'সময়সূচি সক্রিয়' : '২৪/৭ খোলা (সময়সূচি বন্ধ)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSched({ holidayMode: !sched.holidayMode })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        sched.holidayMode
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {sched.holidayMode ? 'হলিডে মোড চালু (উইথড্র বন্ধ)' : 'হলিডে মোড বন্ধ'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      দৈনিক উইথড্র শুরু (সকাল/সময়)
                    </label>
                    <input
                      type="time"
                      value={sched.startTime}
                      onChange={e => updateSched({ startTime: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      দৈনিক উইথড্র শেষ (রাত/সময়)
                    </label>
                    <input
                      type="time"
                      value={sched.endTime}
                      onChange={e => updateSched({ endTime: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-2">
                    সাপ্তাহিক ছুটির দিন (যে দিনগুলোতে উইথড্র বন্ধ থাকবে সিলেক্ট করুন):
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SHORT_DAY_NAMES_BN.map((dayName, idx) => {
                      const isClosed = sched.closedDays.includes(idx);
                      return (
                        <button
                          key={dayName}
                          type="button"
                          onClick={() => toggleDay(idx)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                            isClosed
                              ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {dayName} {isClosed ? '(বন্ধ)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    হলিডে বা ছুটির বিশেষ বার্তা (ইউজারদের দেখাবে)
                  </label>
                  <input
                    type="text"
                    maxLength={250}
                    placeholder="যেমন: প্রতি শুক্রবার সাপ্তাহিক ছুটির কারণে উইথড্র বন্ধ থাকে।"
                    value={sched.holidayMessage}
                    onChange={e => updateSched({ holidayMessage: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            );
          })()}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-purple-950"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingSettings ? 'সেভ হচ্ছে...' : 'সেটিংস সেভ করুন'}</span>
            </button>
          </div>
        </form>

        {/* Global Broadcast Notification Sender Card */}
        <div className="bg-slate-900 border border-rose-500/30 rounded-3xl p-6 sm:p-8 space-y-5 shadow-xl shadow-rose-950/20">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Bell className="w-5 h-5 text-rose-400" />
              <span>সকল ইউজারের কাছে নোটিফিকেশন ব্রডকাস্ট করুন</span>
            </h3>
            <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2.5 py-1 rounded-lg font-semibold border border-rose-500/40">
              ইন্সট্যান্ট অ্যালার্ট
            </span>
          </div>
          <p className="text-xs text-slate-300">
            এখানে শিরোনাম বা যেকোনো বার্তা লিখে পাঠালেই সকল ইউজারের নোটিফিকেশন বেল আইকনে লাল বাতি জ্বলে উঠবে এবং বক্সে সম্পূর্ণ বিবরণ দেখা যাবে।
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">নোটিফিকেশনের শিরোনাম (ঐচ্ছিক)</label>
              <input
                type="text"
                placeholder="যেমন: বিশেষ ঘোষণা বা বোনাস আপডেট!"
                value={announcementTitle}
                onChange={e => setAnnouncementTitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">বিস্তারিত বার্তা</label>
              <textarea
                rows={3}
                placeholder="যেকোনো লেখা বা বিস্তারিত লিখে পাঠান..."
                value={announcementBody}
                onChange={e => setAnnouncementBody(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={isSendingAnn}
                onClick={handleSendBroadcast}
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-rose-950 disabled:opacity-50"
              >
                <Bell className="w-4 h-4" />
                <span>{isSendingAnn ? 'পাঠানো হচ্ছে...' : 'সকলের কাছে নোটিফিকেশন পাঠান'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* TAB: DEDICATED NOTIFICATIONS BROADCAST & HISTORY */}
      {adminTab === 'notifications' && (
        <div className="space-y-6">
          <form onSubmit={handleSendBroadcast} className="bg-slate-900 border border-rose-500/30 rounded-3xl p-6 sm:p-8 space-y-5 shadow-xl shadow-rose-950/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Bell className="w-5 h-5 text-rose-400" />
                <span>সকল ইউজারের কাছে নোটিফিকেশন পাঠান</span>
              </h3>
              <span className="text-[11px] bg-rose-500/20 text-rose-300 px-3 py-1 rounded-lg font-semibold border border-rose-500/40">
                বেল আইকনে অটো লাল বাতি জ্বলবে
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              এখান থেকে আপনি যাই লিখুন না কেন (শিরোনাম বা শুধু বিস্তারিত বার্তা), পাঠানোর সাথে সাথে সকল ইউজারের নোটিফিকেশন বেল আইকনে লাল বাতি জ্বলতে শুরু করবে এবং বক্সে সকল বিবরণ দেখা যাবে।
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">নোটিফিকেশনের শিরোনাম (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: জরুরি ঘোষণা / বোনাস অফার / আপডেট"
                  value={announcementTitle}
                  onChange={e => setAnnouncementTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">বিস্তারিত বার্তা (সব ইউজার এটি দেখতে পাবে)</label>
                <textarea
                  rows={4}
                  placeholder="ইউজারদের উদ্দেশ্যে আপনার সম্পূর্ণ বার্তাটি এখানে লিখুন..."
                  value={announcementBody}
                  onChange={e => setAnnouncementBody(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendAlsoToTelegram}
                    onChange={e => setSendAlsoToTelegram(e.target.checked)}
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                  />
                  <span>টেলিগ্রাম বটে যুক্ত ইউজারদের কাছেও লাইভ পাঠান</span>
                </label>
                <button
                  type="submit"
                  disabled={isSendingAnn}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-rose-950 disabled:opacity-50"
                >
                  <Bell className="w-4 h-4" />
                  <span>{isSendingAnn ? 'পাঠানো হচ্ছে...' : 'এখনই সবার কাছে পাঠান'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Sent Notifications List */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-rose-400" />
                <span>পাঠানো সকল নোটিফিকেশন ({settings?.announcements?.length || 0})</span>
              </h4>
            </div>

            {!settings?.announcements || settings.announcements.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800/80">
                এখনো কোনো নোটিফিকেশন পাঠানো হয়নি। উপরের বক্স থেকে একটি নোটিফিকেশন পাঠান।
              </div>
            ) : (
              <div className="space-y-3">
                {settings.announcements.map((ann, idx) => (
                  <div
                    key={ann.id || idx}
                    className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                        <h5 className="text-xs font-bold text-white break-words">{ann.title}</h5>
                        {idx === 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                            সর্বশেষ
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                        {ann.body}
                      </p>
                      <div className="text-[10px] text-slate-500 font-mono">{ann.createdAt}</div>
                    </div>
                    <button
                      type="button"
                      disabled={isSendingAnn}
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-500/40 transition-colors cursor-pointer shrink-0"
                      title="নোটিফিকেশন মুছুন"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: TELEGRAM BOT LIVE RECEIPT MANAGEMENT */}
      {adminTab === 'telegram' && <AdminTelegramPanel />}

      {/* TAB: ANDROID DEPOSIT SMS GATEWAY & APK MONITORING */}
      {adminTab === 'sms-gateway' && (
        <AdminSmsGatewayPanel
          pendingDeposits={pendingDeposits}
          onApproveMatchedDeposit={handleApproveMatchedDepositFromGateway}
        />
      )}

      {/* TAB: DAILY EARNING PLANS MANAGEMENT SYSTEM */}
      {adminTab === 'plans' && settings && (() => {
        const currentPlans: EarningPlan[] = Array.isArray(settings.earningPlans)
          ? settings.earningPlans
          : getDefaultEarningPlans();

        const totalPlanSoldCount = userPlans.length;
        const activePlanCount = userPlans.filter(p => p.status === 'active').length;
        const totalPlanInvested = userPlans.reduce((sum, p) => sum + (p.price || 0), 0);
        const totalPlanClaimedOut = userPlans.reduce((sum, p) => sum + (p.totalClaimedAmount || 0), 0);

        const handleCreatePlan = async (e: React.FormEvent) => {
          e.preventDefault();
          const name = newPlanName.trim();
          const price = Math.max(10, Number(newPlanPrice) || 0);
          const dailyIncome = Math.max(1, Number(newPlanDailyIncome) || 0);
          const durationDays = Math.max(1, Math.floor(Number(newPlanDuration) || 30));
          if (!name) {
            showToast('প্ল্যানের নাম লিখুন!', 'error');
            return;
          }
          if (price < 10 || dailyIncome < 1) {
            showToast('সঠিক মূল্য (৳১০+) এবং দৈনিক আয় (৳১+) দিন।', 'error');
            return;
          }

          const newPlan: EarningPlan = {
            id: `plan-${Date.now().toString(36)}`,
            name,
            price,
            dailyIncome,
            durationDays,
            badge: newPlanBadge.trim() || 'নতুন',
            description: newPlanDesc.trim() || `প্রতিদিন ক্লেইম করে ৳${dailyIncome} আয় করুন (${durationDays} দিন মেয়াদ)।`,
            color: newPlanColor,
            enabled: true,
            sortOrder: currentPlans.length + 1,
            createdAt: new Date().toISOString(),
          };

          const updatedSettings: SystemSettings = {
            ...settings,
            earningPlans: [...currentPlans, newPlan],
          };
          const ok = await persistSettings(updatedSettings);
          if (ok) {
            setNewPlanName('');
            setNewPlanDesc('');
            showToast(`নতুন প্ল্যান "${name}" সফলভাবে যুক্ত হয়েছে!`, 'success');
          }
        };

        const updatePlanItem = (planId: string, patch: Partial<EarningPlan>) => {
          const nextPlans = currentPlans.map(p => (p.id === planId ? { ...p, ...patch } : p));
          setSettings({ ...settings, earningPlans: nextPlans });
        };

        const deletePlanItem = async (planId: string, planName: string) => {
          const nextPlans = currentPlans.filter(p => p.id !== planId);
          const ok = await persistSettings({ ...settings, earningPlans: nextPlans });
          if (ok) {
            showToast(`"${planName}" প্ল্যানটি ডিলিট করা হয়েছে।`, 'info');
          }
        };

        const saveAllPlans = async () => {
          const ok = await persistSettings({ ...settings, earningPlans: currentPlans });
          if (ok) {
            showToast('সকল প্ল্যানের মূল্য ও দৈনিক ইনকাম সফলভাবে সেভ হয়েছে!', 'success');
          }
        };

        const resetDefaults = async () => {
          const defaults = getDefaultEarningPlans();
          const ok = await persistSettings({ ...settings, earningPlans: defaults });
          if (ok) {
            showToast('ডিফল্ট ৫০০, ১০০০ এবং ১৫০০ টাকার প্ল্যান রিস্টোর করা হয়েছে!', 'success');
          }
        };

        return (
          <div className="space-y-6">
            {/* Header & KPI Strip */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-amber-500/35 space-y-4 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-400" />
                    <span>ডেইলি ইনকাম প্ল্যান কন্ট্রোল ও ম্যানেজমেন্ট সিস্টেম</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    এখান থেকে ৫০০, ১০০০, ১৫০০ টাকার বা যেকোনো নতুন প্ল্যান তৈরি করুন, প্রতিদিন কয় টাকা করে পাবে তা পরিবর্তন করুন এবং ইউজারদের প্ল্যান ক্রয় লাইভ মনিটর করুন।
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={resetDefaults}
                    disabled={isSavingSettings}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>ডিফল্ট প্ল্যান রিসেট</span>
                  </button>
                  <button
                    type="button"
                    onClick={saveAllPlans}
                    disabled={isSavingSettings}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-950/40"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingSettings ? 'সেভ হচ্ছে...' : 'সকল প্ল্যান সেভ করুন'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] text-slate-400">মোট প্ল্যান বিক্রি</div>
                  <div className="text-lg font-extrabold font-mono text-white mt-0.5 tabular-nums">
                    {totalPlanSoldCount} টি
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] text-slate-400">বর্তমানে অ্যাক্টিভ প্ল্যান</div>
                  <div className="text-lg font-extrabold font-mono text-emerald-400 mt-0.5 tabular-nums">
                    {activePlanCount} টি
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] text-slate-400">মোট প্ল্যান সেল ভলিউম</div>
                  <div className="text-lg font-extrabold font-mono text-amber-400 mt-0.5 tabular-nums">
                    ৳{totalPlanInvested.toFixed(2)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] text-slate-400">মোট ডেইলি ক্লেইম পেআউট</div>
                  <div className="text-lg font-extrabold font-mono text-cyan-400 mt-0.5 tabular-nums">
                    ৳{totalPlanClaimedOut.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Add New Plan Card */}
            <form onSubmit={handleCreatePlan} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>নতুন ডেইলি ইনকাম প্ল্যান যুক্ত করুন</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">প্ল্যানের নাম *</label>
                  <input
                    type="text"
                    required
                    value={newPlanName}
                    onChange={e => setNewPlanName(e.target.value)}
                    placeholder="যেমন: ডায়মন্ড প্ল্যান (৳২,০০০)"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">প্ল্যানের দাম (৳) *</label>
                  <input
                    type="number"
                    min="10"
                    step="1"
                    required
                    value={newPlanPrice}
                    onChange={e => setNewPlanPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">প্রতিদিন ক্লেইম ইনকাম (৳) *</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={newPlanDailyIncome}
                    onChange={e => setNewPlanDailyIncome(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">প্ল্যানের মেয়াদ (দিন) *</label>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    required
                    value={newPlanDuration}
                    onChange={e => setNewPlanDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">ব্যাজ টেক্সট (ঐচ্ছিক)</label>
                  <input
                    type="text"
                    value={newPlanBadge}
                    onChange={e => setNewPlanBadge(e.target.value)}
                    placeholder="যেমন: সেরা অফার"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">কার্ড থিম কালার</label>
                  <select
                    value={newPlanColor}
                    onChange={e => setNewPlanColor(e.target.value as PlanThemeColor)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="emerald">Emerald (সবুজ)</option>
                    <option value="amber">Amber / Gold (সোনালী)</option>
                    <option value="purple">Purple (বেগুনি)</option>
                    <option value="cyan">Cyan (আকাশি)</option>
                    <option value="rose">Rose (গোলাপি)</option>
                  </select>
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-slate-300 font-semibold mb-1">সংক্ষিপ্ত বিবরণ (ঐচ্ছিক)</label>
                  <input
                    type="text"
                    value={newPlanDesc}
                    onChange={e => setNewPlanDesc(e.target.value)}
                    placeholder="প্ল্যানের সুবিধা সম্পর্কে সংক্ষেপে লিখুন..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg"
                >
                  <Plus className="w-4 h-4" />
                  <span>নতুন প্ল্যান যুক্ত করুন</span>
                </button>
              </div>
            </form>

            {/* Manage Existing Plans List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>বিদ্যমান প্ল্যানসমূহ ({currentPlans.length} টি) — প্রতিদিন আয় ও দাম এডিট করুন</span>
                </h4>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {currentPlans.map(plan => {
                  const totalReturn = (Number(plan.dailyIncome) || 0) * (Number(plan.durationDays) || 1);
                  return (
                    <div
                      key={plan.id}
                      className={`p-5 rounded-2xl border space-y-4 transition-all ${
                        plan.enabled !== false
                          ? 'bg-slate-900 border-slate-700'
                          : 'bg-slate-950/60 border-slate-800/60 opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {plan.id}
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={plan.enabled !== false}
                              onChange={e => updatePlanItem(plan.id, { enabled: e.target.checked })}
                              className="rounded accent-emerald-500 w-3.5 h-3.5"
                            />
                            <span className={plan.enabled !== false ? 'text-emerald-400' : 'text-slate-500'}>
                              {plan.enabled !== false ? 'চালু' : 'বন্ধ'}
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => deletePlanItem(plan.id, plan.name)}
                            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 cursor-pointer"
                            title="প্ল্যান ডিলিট করুন"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">প্ল্যানের নাম</label>
                          <input
                            type="text"
                            value={plan.name}
                            onChange={e => updatePlanItem(plan.id, { name: e.target.value })}
                            className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-semibold focus:outline-none focus:border-amber-400"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">মূল্য (৳)</label>
                            <input
                              type="number"
                              min="10"
                              value={plan.price}
                              onChange={e => updatePlanItem(plan.id, { price: Number(e.target.value) || 0 })}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-emerald-400 font-bold mb-1">প্রতিদিন আয় (৳)</label>
                            <input
                              type="number"
                              min="1"
                              step="0.5"
                              value={plan.dailyIncome}
                              onChange={e => updatePlanItem(plan.id, { dailyIncome: Number(e.target.value) || 0 })}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-emerald-500/40 rounded-xl text-emerald-400 font-mono font-extrabold focus:outline-none focus:border-emerald-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">মেয়াদ (দিন)</label>
                            <input
                              type="number"
                              min="1"
                              value={plan.durationDays}
                              onChange={e => updatePlanItem(plan.id, { durationDays: Math.max(1, Number(e.target.value) || 1) })}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-amber-400"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">ব্যাজ টেক্সট</label>
                            <input
                              type="text"
                              value={plan.badge || ''}
                              onChange={e => updatePlanItem(plan.id, { badge: e.target.value })}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">থিম কালার</label>
                            <select
                              value={plan.color || 'emerald'}
                              onChange={e => updatePlanItem(plan.id, { color: e.target.value as PlanThemeColor })}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-400"
                            >
                              <option value="emerald">সবুজ (Emerald)</option>
                              <option value="amber">সোনালী (Amber)</option>
                              <option value="purple">বেগুনি (Purple)</option>
                              <option value="cyan">আকাশি (Cyan)</option>
                              <option value="rose">গোলাপি (Rose)</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">বিবরণ</label>
                          <input
                            type="text"
                            value={plan.description || ''}
                            onChange={e => updatePlanItem(plan.id, { description: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-amber-400"
                          />
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">মোট রিটার্ন:</span>
                          <span className="font-mono font-bold text-emerald-400">
                            ৳{totalReturn.toFixed(0)} ({plan.durationDays} দিনে)
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={saveAllPlans}
                  disabled={isSavingSettings}
                  className="px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center gap-2 cursor-pointer shadow-lg"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingSettings ? 'সেভ হচ্ছে...' : 'পরিবর্তনগুলো Firestore-এ সেভ করুন'}</span>
                </button>
              </div>
            </div>

            {/* Live User Subscriptions Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Gift className="w-4 h-4 text-emerald-400" />
                  <span>ইউজারদের প্ল্যান ক্রয় ও ডেইলি ক্লেইম লাইভ তালিকা</span>
                </h4>
                <span className="text-xs text-slate-400">মোট: {userPlans.length} টি</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">ইউজার ও আইডি</th>
                      <th className="py-3 px-4">প্ল্যানের নাম</th>
                      <th className="py-3 px-4 text-right">মূল্য</th>
                      <th className="py-3 px-4 text-right">দৈনিক আয়</th>
                      <th className="py-3 px-4 text-center">ক্লেইম অগ্রগতি</th>
                      <th className="py-3 px-4 text-right">মোট ক্লেইম</th>
                      <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {userPlans.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500">
                          এখনো কোনো ইউজার প্ল্যান ক্রয় করেনি।
                        </td>
                      </tr>
                    ) : (
                      userPlans.map(sub => (
                        <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-white text-[11px]">{sub.id}</div>
                            <div className="text-slate-200 font-semibold">{sub.userName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{sub.userEmail}</div>
                          </td>
                          <td className="py-3 px-4 font-bold text-amber-300">{sub.planName}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-200 tabular-nums">
                            ৳{sub.price.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 tabular-nums">
                            ৳{sub.dailyIncome.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-slate-300 tabular-nums">
                            {sub.claimedDays} / {sub.durationDays} দিন
                            {sub.lastClaimDate && (
                              <div className="text-[10px] text-slate-500">শেষ ক্লেইম: {sub.lastClaimDate}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-cyan-400 tabular-nums">
                            ৳{sub.totalClaimedAmount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                sub.status === 'completed'
                                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {sub.status === 'completed' ? 'সম্পন্ন' : 'সক্রিয়'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB: SYSTEM HEALTH, SELF-HEALING & ERROR RADAR */}
      {adminTab === 'telemetry' && <AdminTelemetryPanel />}

      {/* TAB 6: AUDIT LOGS */}
      {adminTab === 'logs' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-slate-400" />
            <span>অ্যাডমিন অডিট ও অ্যাকশন হিস্ট্রি</span>
          </h3>

          <div className="space-y-2">
            {auditLogs.map(log => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-bold text-amber-400">{log.action}: </span>
                  <span className="text-slate-200">{log.details}</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: Balance Adjustment (Add / Deduct / Exact Set) */}
      {adjustingUser && (() => {
        const amt = Number(balanceDelta);
        const validAmt = Number.isFinite(amt) && amt >= 0;
        const previewBal = !validAmt
          ? adjustingUser.balance
          : balanceMode === 'set'
          ? amt
          : balanceMode === 'deduct'
          ? Math.max(0, adjustingUser.balance - amt)
          : adjustingUser.balance + amt;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">ইউজারের ব্যালেন্স সমন্বয় ও যোগ করুন</h3>
                <button
                  type="button"
                  onClick={() => setAdjustingUser(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">ইউজার:</span>
                  <strong className="text-white">{adjustingUser.name}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">বর্তমান ব্যালেন্স:</span>
                  <span className="text-emerald-400 font-mono font-bold">৳{adjustingUser.balance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 pt-1 mt-1">
                  <span className="text-slate-400">আপডেটের পর হবে:</span>
                  <span className="text-amber-300 font-mono font-bold">৳{previewBal.toFixed(2)}</span>
                </div>
              </div>

              {/* Action Mode Selector */}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setBalanceMode('add')}
                  className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                    balanceMode === 'add'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  + টাকা যোগ
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceMode('deduct')}
                  className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                    balanceMode === 'deduct'
                      ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  - টাকা কাটুন
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceMode('set')}
                  className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                    balanceMode === 'set'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  সরাসরি সেট
                </button>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1.5">
                  {balanceMode === 'add'
                    ? 'যোগ করার পরিমাণ (৳):'
                    : balanceMode === 'deduct'
                    ? 'কাটার পরিমাণ (৳):'
                    : 'নতুন মোট ব্যালেন্স (৳):'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={balanceDelta}
                  onChange={e => setBalanceDelta(e.target.value)}
                  placeholder="যেমন: 100"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[50, 100, 250, 500, 1000].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBalanceDelta(String(preset))}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] font-bold border border-slate-700 cursor-pointer"
                    >
                      ৳{preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">কারণ বা বিবরণ</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  placeholder="যেমন: রেফারেল বোনাস / অ্যাডমিন ডিপোজিট"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustingUser(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="button"
                  onClick={handleAdjustBalance}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Approve Withdrawal Payout */}
      {approvingWithdrawal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">উইথড্র পেমেন্ট অনুমোদন</h3>
              <button
                onClick={() => setApprovingWithdrawal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div>প্রাপক: <strong className="text-white">{approvingWithdrawal.userName}</strong></div>
              <div>মাধ্যম: <strong className="text-cyan-400">{approvingWithdrawal.method} ({approvingWithdrawal.accountType})</strong></div>
              <div>নাম্বার: <strong className="text-white font-mono">{approvingWithdrawal.accountNumber}</strong></div>
              <div>পরিমাণ: <strong className="text-emerald-400 font-mono text-sm">৳{approvingWithdrawal.amount}</strong></div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                পেমেন্ট ট্রানজেকশন TrxID (বিকাশ/নগদ রেফারেন্স)
              </label>
              <input
                type="text"
                placeholder="যেমন: BKP982310"
                value={payoutTrxId}
                onChange={e => setPayoutTrxId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono uppercase text-white focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 block mt-1">ফাঁকা রাখলে অটো জেনারেটেড আইডি বসবে।</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setApprovingWithdrawal(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={() => handleWithdrawalAction(approvingWithdrawal.id, 'approve', payoutTrxId)}
                className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
              >
                পেমেন্ট অনুমোদন নিশ্চিত করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Custom Daily Captcha Limit for User */}
      {userForCustomLimit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">ইউজারের দৈনিক ক্যাপচা লিমিট</h3>
              <button
                onClick={() => setUserForCustomLimit(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-400">
              ইউজার: <strong className="text-white">{userForCustomLimit.name}</strong>
              <div className="text-cyan-400 font-mono mt-0.5">
                আজ পূরণ: {userForCustomLimit.captchasSolvedToday} টি · প্যাকেজ: {userForCustomLimit.vipTier.toUpperCase()}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                নতুন দৈনিক লিমিট (ফাঁকা রাখলে প্যাকেজের ডিফল্ট লিমিট প্রযোজ্য হবে)
              </label>
              <input
                type="number"
                min="0"
                value={customLimitInput}
                onChange={e => setCustomLimitInput(e.target.value)}
                placeholder="যেমন: 50 (ফাঁকা রাখলে ডিফল্ট)"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUserForCustomLimit(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleSaveCustomLimit}
                className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer"
              >
                লিমিট সেভ করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Rejection Note for Deposit or Recharge */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>
                  {rejectingItem.type === 'deposit' ? 'ডিপোজিট আবেদন বাতিল' : 'মোবাইল রিচার্জ বাতিল'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setRejectingItem(null);
                  setRejectionReason('');
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
              <div>ইউজার: <strong className="text-white">{rejectingItem.userName}</strong></div>
              <div>পরিমাণ: <span className="text-amber-400 font-mono font-bold">৳{rejectingItem.amount.toFixed(2)}</span> ({rejectingItem.method})</div>
              {rejectingItem.type === 'recharge' ? (
                <div className="text-[11px] text-emerald-400 font-semibold pt-1">
                  ✓ বাতিল নিশ্চিত করলে ইউজারের কেটে নেওয়া টাকা স্বয়ংক্রিয়ভাবে ব্যালেন্সে ফেরত দেওয়া হবে।
                </div>
              ) : (
                <div className="text-[11px] text-rose-300 pt-1">
                  ⚠ লেনদেন অকার্যকর হিসেবে চিহ্নিত হবে এবং কোনো ব্যালেন্স যুক্ত হবে না।
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                বাতিলের কারণ / নোট (ঐচ্ছিক):
              </label>
              <textarea
                rows={2}
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder={rejectingItem.type === 'deposit' ? 'যেমন: ভুল TrxID বা অ্যাকাউন্টে টাকা জমা হয়নি' : 'যেমন: ভুল নাম্বার বা অপারেটরে সমস্যা'}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500 placeholder-slate-600 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setRejectingItem(null);
                  setRejectionReason('');
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                ফিরে যান
              </button>
              <button
                type="button"
                onClick={() => handleRechargeAction(rejectingItem.id, 'reject', rejectionReason)}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                বাতিল নিশ্চিত করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
