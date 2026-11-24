import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  connectManualTelegramChatId,
  DEFAULT_TELEGRAM_PREFS,
  fetchTelegramStatus,
  requestTelegramLinkCode,
  requestTelegramOtp,
  saveTelegramAlertPrefsOnServer,
  sendTestTelegramReceipt,
  unlinkTelegramOnServer,
  verifyTelegramOtp,
} from '../lib/telegramService';
import { updateUserTelegramBindingInFirestore } from '../lib/dbService';
import type { TelegramAlertPrefs, TelegramBotStatus } from '../types';
import {
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  BellRing,
  Unlink,
  FlaskConical,
  Hash,
  Sparkles,
  VolumeX,
  SlidersHorizontal,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

interface TelegramAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAdminTelegram?: () => void;
}

const PREF_ITEMS: Array<{
  key: 'p2pReceived' | 'withdrawals' | 'recharges' | 'adjustments' | 'p2pSent' | 'announcements' | 'dailyDigest';
  title: string;
  desc: string;
}> = [
  {
    key: 'p2pReceived',
    title: 'P2P ব্যালেন্স প্রাপ্তি রিসিট',
    desc: 'অ্যাপ বন্ধ থাকলেও কেউ P2P টাকা পাঠালে সাথে সাথে রিসিট পাবেন',
  },
  {
    key: 'withdrawals',
    title: 'উইথড্র অ্যাপ্রুভ ও রিফান্ড',
    desc: 'উইথড্র পেমেন্ট সম্পন্ন বা বাতিল হলে ট্রানজেকশন আইডিসহ রিসিট',
  },
  {
    key: 'recharges',
    title: 'মোবাইল রিচার্জ স্ট্যাটাস',
    desc: 'রিচার্জ রিকোয়েস্ট অ্যাপ্রুভ বা বাতিল হলে ইনস্ট্যান্ট আপডেট',
  },
  {
    key: 'adjustments',
    title: 'ব্যালেন্স বোনাস ও সমন্বয়',
    desc: 'অ্যাডমিন বোনাস বা ব্যালেন্স পরিবর্তন করলে সরাসরি রিসিট',
  },
  {
    key: 'p2pSent',
    title: 'P2P সেন্ড কনফার্মেশন',
    desc: 'আপনি কাউকে টাকা পাঠালে তার রেকর্ড রিসিট টেলিগ্রামে সেভ থাকবে',
  },
  {
    key: 'announcements',
    title: 'অফিশিয়াল ঘোষণা ও অ্যালার্ট',
    desc: 'অ্যাডমিনের গুরুত্বপূর্ণ আপডেট ও বিশেষ অফার বার্তা',
  },
  {
    key: 'dailyDigest',
    title: 'রাত ৯টার ডেইলি আয়ের রিপোর্ট',
    desc: 'প্রতিদিন রাত ৯টায় আজকের ক্যাপচা, অ্যাড ও ব্যালেন্সের সারসংক্ষেপ কার্ড',
  },
];

const BOT_COMMANDS_GUIDE: Array<{ cmd: string; desc: string }> = [
  { cmd: '/menu', desc: 'ইন্টারেক্টিভ বাটন ড্যাশবোর্ড খুলুন' },
  { cmd: '/balance', desc: 'লাইভ ব্যালেন্স, মোট আয় ও VIP টায়ার' },
  { cmd: '/history', desc: 'সর্বশেষ ৮টি লেনদেনের মিনি-স্টেটমেন্ট' },
  { cmd: '/stats', desc: 'আজকের ক্যাপচা সমাধান ও ভিডিও অ্যাড আয়' },
  { cmd: '/digest', desc: 'তাৎক্ষণিক ডেইলি পারফরম্যান্স রিপোর্ট' },
  { cmd: '/otp', desc: '৬ সংখ্যার ২-স্তরের সিকিউরিটি OTP কোড' },
  { cmd: '/mute 1h', desc: '১ বা ৮ ঘণ্টার নীরব মোড (/unmute দিয়ে বন্ধ)' },
  { cmd: '/support', desc: 'সরাসরি অ্যাডমিন সাপোর্টে মেসেজ পাঠান' },
  { cmd: '/status', desc: 'বর্তমান সংযোগ ও অ্যালার্ট ফিল্টার দেখুন' },
  { cmd: '/myid', desc: 'আপনার টেলিগ্রাম Chat ID জানুন' },
  { cmd: '/help', desc: 'সব কমান্ড ও ব্যবহারের নিয়ম' },
];

const MIN_AMOUNT_OPTIONS = [0, 20, 50, 100, 500];

export const TelegramAlertModal: React.FC<TelegramAlertModalProps> = ({
  isOpen,
  onClose,
  onOpenAdminTelegram,
}) => {
  const { user, isAdmin, showToast, applyUser } = useAuth();
  const [status, setStatus] = useState<TelegramBotStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkData, setLinkData] = useState<{
    code: string;
    botUsername: string;
    deepLink: string;
    expiresInMinutes: number;
  } | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [manualChatId, setManualChatId] = useState('');
  const [isConnectingManual, setIsConnectingManual] = useState(false);
  const [prefs, setPrefs] = useState<TelegramAlertPrefs>(DEFAULT_TELEGRAM_PREFS);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const userId = user?.id || '';
  const userRef = useRef(user);
  userRef.current = user;
  const statusRef = useRef(status);
  statusRef.current = status;
  const syncedBindingKeyRef = useRef('');
  const isFetchingRef = useRef(false);
  const isUnlinkingRef = useRef(false);

  const formatUiError = (err: unknown, fallback: string): string => {
    if (!(err instanceof Error)) return fallback;
    const raw = err.message || '';
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed.error && parsed.error.toLowerCase().includes('permission')) {
          return 'ডেটাবেস পারমিশন সমস্যা হয়েছে। অনুগ্রহ করে পেজ রিলোড করে আবার চেষ্টা করুন।';
        }
      } catch {
        // Ignore JSON parse fallback
      }
      return fallback;
    }
    return raw || fallback;
  };

  const syncFirestoreIfChanged = useCallback(
    async (srv: TelegramBotStatus) => {
      const currentUser = userRef.current;
      if (!currentUser || !srv.linked || !srv.chatId || isUnlinkingRef.current) return;
      const bindingKey = `${currentUser.id}:${srv.chatId}:${srv.username || ''}`;
      if (syncedBindingKeyRef.current === bindingKey) return;

      const needsSync =
        currentUser.telegramChatId !== srv.chatId ||
        (Boolean(srv.username) && currentUser.telegramUsername !== srv.username);
      if (!needsSync) {
        syncedBindingKeyRef.current = bindingKey;
        return;
      }

      syncedBindingKeyRef.current = bindingKey;
      try {
        await updateUserTelegramBindingInFirestore({
          uid: currentUser.id,
          chatId: srv.chatId,
          username: srv.username,
          prefs: srv.prefs || DEFAULT_TELEGRAM_PREFS,
        });
        applyUser({
          ...currentUser,
          telegramChatId: srv.chatId,
          telegramUsername: srv.username,
          telegramAlertPrefs: srv.prefs || DEFAULT_TELEGRAM_PREFS,
        });
      } catch {
        syncedBindingKeyRef.current = '';
      }
    },
    [applyUser]
  );

  const loadStatus = useCallback(
    async (silent = false) => {
      const currentUser = userRef.current;
      if (!currentUser || isFetchingRef.current) return;
      isFetchingRef.current = true;
      const showInitialLoader = !silent && !statusRef.current;
      if (showInitialLoader) setLoading(true);
      setErrorMsg('');
      try {
        const res = await fetchTelegramStatus();
        setStatus(res);
        setPrefs({
          ...DEFAULT_TELEGRAM_PREFS,
          ...(res.prefs || currentUser.telegramAlertPrefs || {}),
        });
        if (res.linked) {
          setLinkData(null);
          await syncFirestoreIfChanged(res);
        }
      } catch (err) {
        if (!silent) {
          setErrorMsg(err instanceof Error ? err.message : 'স্ট্যাটাস লোড করতে সমস্যা হয়েছে');
        }
      } finally {
        isFetchingRef.current = false;
        if (showInitialLoader) setLoading(false);
      }
    },
    [syncFirestoreIfChanged]
  );

  useEffect(() => {
    if (!userId) {
      setStatus(null);
      syncedBindingKeyRef.current = '';
      return;
    }
    if (!isOpen) return;
    setOtpVerified(false);
    setOtpRequested(false);
    setOtpCode('');
    void loadStatus(false);
  }, [isOpen, userId, loadStatus]);

  // Auto-poll every 3s while user has an active link code open waiting for Telegram /start
  useEffect(() => {
    if (!isOpen || !linkData || status?.linked) return;
    const timer = setInterval(() => {
      void loadStatus(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [isOpen, linkData, status?.linked, loadStatus]);

  if (!isOpen) return null;

  const persistPrefs = async (nextPrefs: TelegramAlertPrefs, toastText?: string) => {
    if (!user || isSavingPrefs) return;
    const previous = prefs;
    setPrefs(nextPrefs);
    setIsSavingPrefs(true);
    try {
      await saveTelegramAlertPrefsOnServer(nextPrefs);
      if (status?.chatId) {
        await updateUserTelegramBindingInFirestore({
          uid: user.id,
          chatId: status.chatId,
          username: status.username,
          prefs: nextPrefs,
        });
      }
      applyUser({ ...user, telegramAlertPrefs: nextPrefs });
      showToast(toastText || 'অ্যালার্ট প্রিফারেন্স সেভ হয়েছে।', 'success');
    } catch (err) {
      setPrefs(previous);
      showToast(formatUiError(err, 'সেভ করতে সমস্যা হয়েছে'), 'error');
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleGenerateOneClickLink = async () => {
    setErrorMsg('');
    setIsCreatingLink(true);
    try {
      const data = await requestTelegramLinkCode();
      setLinkData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'লিংক তৈরি করা যায়নি';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleCopyCommand = async () => {
    if (!linkData) return;
    try {
      await navigator.clipboard.writeText(`/start ${linkData.code}`);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      showToast('কমান্ড কপি হয়েছে! টেলিগ্রাম বটে পেস্ট করুন।', 'success');
    } catch {
      showToast('কপি করা যায়নি, ম্যানুয়ালি কপি করুন।', 'error');
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg('');
    const trimmed = manualChatId.trim();
    if (!/^-?\d{5,20}$/.test(trimmed)) {
      setErrorMsg('সঠিক সংখ্যার Telegram Chat ID লিখুন (যেমন: 123456789)।');
      return;
    }

    setIsConnectingManual(true);
    try {
      const res = await connectManualTelegramChatId(trimmed);
      await updateUserTelegramBindingInFirestore({
        uid: user.id,
        chatId: res.chatId,
        username: res.username,
        prefs: res.prefs,
      });
      applyUser({
        ...user,
        telegramChatId: res.chatId,
        telegramUsername: res.username,
        telegramAlertPrefs: res.prefs,
      });
      setManualChatId('');
      showToast('টেলিগ্রাম বট সফলভাবে ভেরিফাই ও কানেক্ট হয়েছে!', 'success');
      await loadStatus(true);
    } catch (err) {
      const msg = formatUiError(err, 'ভেরিফিকেশন ব্যর্থ হয়েছে');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsConnectingManual(false);
    }
  };

  const handleTogglePref = async (key: typeof PREF_ITEMS[number]['key']) => {
    const currentVal = key === 'dailyDigest' ? prefs.dailyDigest !== false : Boolean(prefs[key]);
    await persistPrefs({ ...prefs, [key]: !currentVal });
  };

  const handleSetSnoozeHours = async (hours: number) => {
    const nextMutedUntil = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : '';
    await persistPrefs(
      { ...prefs, mutedUntil: nextMutedUntil },
      hours > 0 ? `${hours} ঘণ্টার জন্য নীরব মোড চালু হয়েছে।` : 'নীরব মোড বন্ধ করা হয়েছে!'
    );
  };

  const handleSetMinAmount = async (amount: number) => {
    await persistPrefs(
      { ...prefs, minAlertAmount: amount },
      amount > 0 ? `৳${amount}+ এর লেনদেনেই শুধু রিসিট পাবেন।` : 'সব অ্যামাউন্টের রিসিট চালু হয়েছে।'
    );
  };

  const handleRequestOtp = async () => {
    setIsRequestingOtp(true);
    setOtpVerified(false);
    try {
      await requestTelegramOtp();
      setOtpRequested(true);
      showToast('আপনার টেলিগ্রামে ৬ সংখ্যার OTP পাঠানো হয়েছে!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'OTP পাঠানো যায়নি', 'error');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.trim().length < 6) {
      showToast('৬ সংখ্যার OTP কোড লিখুন।', 'error');
      return;
    }
    setIsVerifyingOtp(true);
    try {
      await verifyTelegramOtp(otpCode);
      setOtpVerified(true);
      setOtpCode('');
      setOtpRequested(false);
      showToast('টেলিগ্রাম 2FA OTP সফলভাবে ভেরিফাই হয়েছে!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ভুল বা মেয়াদোত্তীর্ণ OTP', 'error');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleSendTest = async () => {
    setIsSendingTest(true);
    setErrorMsg('');
    try {
      await sendTestTelegramReceipt();
      showToast('আপনার টেলিগ্রামে একটি টেস্ট লাইভ রিসিট পাঠানো হয়েছে!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'টেস্ট রিসিট পাঠানো যায়নি';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleUnlink = async () => {
    if (!user || isUnlinking) return;
    setErrorMsg('');
    setIsUnlinking(true);
    isUnlinkingRef.current = true;
    try {
      // Clear Firestore first so AuthContext's snapshot sync never re-creates the server binding during unlink
      if (user.telegramChatId || user.telegramUsername) {
        try {
          await updateUserTelegramBindingInFirestore({
            uid: user.id,
            chatId: '',
            username: '',
            prefs,
          });
        } catch (fsErr) {
          // If Firestore still holds an active binding and rejects clearing, throw friendly error;
          // otherwise proceed to unlink the server state cleanly.
          if (user.telegramChatId) {
            throw fsErr;
          }
        }
      }

      await unlinkTelegramOnServer();
      syncedBindingKeyRef.current = '';
      applyUser({
        ...user,
        telegramChatId: '',
        telegramUsername: '',
      });
      setOtpVerified(false);
      setOtpRequested(false);
      setOtpCode('');
      setLinkData(null);
      setStatus(prev =>
        prev
          ? {
              ...prev,
              linked: false,
              chatId: '',
              username: '',
            }
          : prev
      );
      showToast('টেলিগ্রাম লাইভ রিসিট সংযোগ বিচ্ছিন্ন করা হয়েছে।', 'info');
      void loadStatus(true);
    } catch (err) {
      const msg = formatUiError(err, 'টেলিগ্রাম সংযোগ বিচ্ছিন্ন করা যায়নি।');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      isUnlinkingRef.current = false;
      setIsUnlinking(false);
    }
  };

  const isMutedActive =
    Boolean(prefs.mutedUntil) && new Date(prefs.mutedUntil || '').getTime() > Date.now();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-sky-500/30 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-sky-950/50 via-slate-900 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>টেলিগ্রাম লাইভ রিসিট ও স্মার্ট বট</span>
                {status?.linked && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                    সংযুক্ত
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                অ্যাপ বন্ধ থাকলেও রিসিট, লাইভ ব্যালেন্স কমান্ড, OTP ও সাপোর্ট পান
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="বন্ধ করুন"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-sky-400" />
              <span>টেলিগ্রাম বট স্ট্যাটাস যাচাই হচ্ছে...</span>
            </div>
          ) : !status?.botConfigured ? (
            <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 text-center">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">টেলিগ্রাম বট এখনো চালু হয়নি</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  অ্যাডমিন প্যানেল থেকে <span className="font-mono text-amber-300">@BotFather</span> টোকেন যুক্ত করলেই সকল ইউজারের জন্য টেলিগ্রাম লাইভ রিসিট চালু হয়ে যাবে।
                </p>
              </div>
              {isAdmin && onOpenAdminTelegram && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAdminTelegram();
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
                >
                  অ্যাডমিন প্যানেলে বট সেটআপ করুন
                </button>
              )}
            </div>
          ) : status.linked ? (
            <>
              {/* Connected Card */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span className="text-emerald-400">আপনার বটটি সফলভাবে সংযোগ হয়েছে!</span>
                      </div>
                      <div className="text-[11px] text-emerald-300 font-mono">
                        {status.username ? `@${status.username} • ` : ''}Chat ID: {status.chatId}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                    ২৪/৭ লাইভ
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSendingTest}
                    onClick={handleSendTest}
                    className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>{isSendingTest ? 'পাঠানো হচ্ছে...' : 'টেস্ট লাইভ রিসিট পাঠান'}</span>
                  </button>

                  {status.botUsername && (
                    <a
                      href={`https://t.me/${status.botUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>বট ওপেন করুন</span>
                    </a>
                  )}

                  <button
                    type="button"
                    disabled={isUnlinking}
                    onClick={handleUnlink}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>{isUnlinking ? 'বিচ্ছিন্ন হচ্ছে...' : 'সংযোগ বিচ্ছিন্ন'}</span>
                  </button>
                </div>
              </div>

              {/* Smart Snooze & Min Alert Threshold Filter */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <VolumeX className="w-4 h-4 text-amber-400" />
                    <span>স্মার্ট নীরব মোড (Do Not Disturb)</span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {isMutedActive ? '🔕 চালু আছে' : '🔔 সক্রিয়'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isSavingPrefs}
                    onClick={() => void handleSetSnoozeHours(1)}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 cursor-pointer"
                  >
                    🔕 ১ ঘণ্টা সাইলেন্ট
                  </button>
                  <button
                    type="button"
                    disabled={isSavingPrefs}
                    onClick={() => void handleSetSnoozeHours(8)}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 cursor-pointer"
                  >
                    🌙 ৮ ঘণ্টা সাইলেন্ট
                  </button>
                  {isMutedActive && (
                    <button
                      type="button"
                      disabled={isSavingPrefs}
                      onClick={() => void handleSetSnoozeHours(0)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[11px] font-bold text-emerald-300 cursor-pointer"
                    >
                      🔔 নীরব মোড বন্ধ
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <SlidersHorizontal className="w-4 h-4 text-sky-400" />
                    <span>মিনিমাম অ্যামাউন্ট অ্যালার্ট ফিল্টার</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    কোনো নির্ধারিত পরিমাণের নিচের লেনদেনগুলো ফিল্টার করতে বেছে নিন:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {MIN_AMOUNT_OPTIONS.map(amt => {
                      const active = (prefs.minAlertAmount || 0) === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          disabled={isSavingPrefs}
                          onClick={() => void handleSetMinAmount(amt)}
                          className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-sky-500 text-slate-950 border-sky-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          {amt === 0 ? 'সব পরিমাণ (৳০+)' : `৳${amt}+`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Telegram 2FA OTP Verifier */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>টেলিগ্রাম 2FA OTP ভেরিফিকেশন</span>
                  </div>
                  {otpVerified && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                      যাচাই সম্পন্ন
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  টেলিগ্রামে ৬ সংখ্যার ওয়ান-টাইম কোড পাঠিয়ে আপনার ডিভাইস ও বট সংযোগ যাচাই করুন (বট থেকেও <code className="text-indigo-300">/otp</code> লিখে নিতে পারবেন)।
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isRequestingOtp}
                    onClick={handleRequestOtp}
                    className="px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isRequestingOtp ? 'OTP পাঠানো হচ্ছে...' : 'টেলিগ্রামে OTP পাঠান'}
                  </button>
                </div>

                {(otpRequested || otpCode.length > 0) && (
                  <form onSubmit={handleVerifyOtp} className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="৬ সংখ্যার OTP দিন"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono tracking-widest focus:outline-none focus:border-indigo-400"
                    />
                    <button
                      type="submit"
                      disabled={isVerifyingOtp}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isVerifyingOtp ? 'যাচাই...' : 'ভেরিফাই'}
                    </button>
                  </form>
                )}
              </div>

              {/* Receipt Category Toggles */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <BellRing className="w-4 h-4 text-sky-400" />
                    <span>কোন কোন রিসিট টেলিগ্রামে পেতে চান?</span>
                  </h3>
                  <span className="text-[10px] text-slate-400">স্বয়ংক্রিয়ভাবে সেভ হয়</span>
                </div>

                <div className="space-y-2">
                  {PREF_ITEMS.map(item => {
                    const enabled =
                      item.key === 'dailyDigest' ? prefs.dailyDigest !== false : Boolean(prefs[item.key]);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={isSavingPrefs}
                        onClick={() => void handleTogglePref(item.key)}
                        className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                          enabled
                            ? 'bg-slate-950/90 border-sky-500/35 hover:border-sky-400/60'
                            : 'bg-slate-950/40 border-slate-800/80 opacity-75 hover:opacity-100'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white">{item.title}</div>
                          <div className="text-[11px] text-slate-400 leading-snug">{item.desc}</div>
                        </div>
                        <span
                          className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${
                            enabled ? 'bg-sky-500' : 'bg-slate-700'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                              enabled ? 'left-5.5' : 'left-0.5'
                            }`}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Telegram Bot Slash Commands Guide */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>টেলিগ্রাম বটের সম্পূর্ণ কমান্ড তালিকা</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {BOT_COMMANDS_GUIDE.map(item => (
                    <div
                      key={item.cmd}
                      className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-0.5"
                    >
                      <code className="text-[11px] font-bold text-sky-300 font-mono">{item.cmd}</code>
                      <div className="text-[10px] text-slate-400 leading-snug">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              {/* Step 1: 1-Click Auto Connect */}
              <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-sky-400" />
                    <span>পদ্ধতি ১: ১-ক্লিক অটো কানেক্ট (সবচেয়ে সহজ)</span>
                  </div>
                  {status.botUsername && (
                    <span className="text-[10px] font-mono text-sky-300">@{status.botUsername}</span>
                  )}
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  নিচের বাটনে ক্লিক করে সরাসরি আপনার টেলিগ্রাম বটে <span className="font-mono text-sky-300">Start</span> চাপুন—সাথে সাথেই লাইভ রিসিট চালু হয়ে যাবে।
                </p>

                {!linkData ? (
                  <button
                    type="button"
                    disabled={isCreatingLink}
                    onClick={handleGenerateOneClickLink}
                    className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      {isCreatingLink ? 'কানেক্ট লিংক তৈরি হচ্ছে...' : 'টেলিগ্রাম কানেক্ট লিংক তৈরি করুন'}
                    </span>
                  </button>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {linkData.deepLink && (
                      <a
                        href={linkData.deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>টেলিগ্রাম বট ওপেন করে Start চাপুন (@{linkData.botUsername})</span>
                      </a>
                    )}

                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                      <code className="text-[11px] text-sky-300 font-mono truncate">
                        /start {linkData.code}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCommand}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCode ? 'কপি হয়েছে' : 'কপি'}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                        <span>টেলিগ্রামে Start চাপার সাথে সাথে অটো যুক্ত হবে...</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadStatus(true)}
                        className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                      >
                        চেক করুন
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Manual Chat ID Bind */}
              <form
                onSubmit={handleManualConnect}
                className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3"
              >
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Hash className="w-4 h-4 text-emerald-400" />
                  <span>পদ্ধতি ২: টেলিগ্রাম Chat ID দিয়ে যুক্ত করুন</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {status.botUsername ? (
                    <>
                      টেলিগ্রামে <span className="font-mono text-sky-300">@{status.botUsername}</span> বট ওপেন করে{' '}
                      <code className="text-emerald-300">/myid</code> লিখলে আপনার Chat ID দেখাবে। সেটি নিচে দিন:
                    </>
                  ) : (
                    'বটে /start ও /myid লিখে পাওয়া সংখ্যার Chat ID এখানে বসিয়ে ভেরিফাই করুন:'
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="যেমন: 123456789"
                    value={manualChatId}
                    onChange={e => setManualChatId(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={isConnectingManual}
                    className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                  >
                    {isConnectingManual ? 'যাচাই হচ্ছে...' : 'ভেরিফাই করুন'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
