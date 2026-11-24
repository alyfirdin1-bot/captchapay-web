import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  disconnectAdminChannelBot,
  disconnectAdminTelegramBot,
  fetchAdminTelegramOverview,
  saveAdminChannelBotConfig,
  saveAdminTelegramBotToken,
  sendAdminChannelTest,
  syncAdminTelegramCommands,
  toggleAdminChannelEnabled,
  toggleAdminTelegramRadar,
  type AdminTelegramOverview,
} from '../lib/telegramService';
import {
  Send,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  Unlink,
  Users,
  FileText,
  Sparkles,
  ShieldCheck,
  Radio,
  Terminal,
  Megaphone,
  Lock,
  Cloud,
  Pencil,
} from 'lucide-react';

export const AdminTelegramPanel: React.FC = () => {
  const { showToast } = useAuth();
  const [overview, setOverview] = useState<AdminTelegramOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [botTokenInput, setBotTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingRadar, setIsTogglingRadar] = useState(false);
  const [isSyncingCommands, setIsSyncingCommands] = useState(false);
  const [isEditingMainBot, setIsEditingMainBot] = useState(false);

  // Dedicated Send-Only Channel Bot state
  const [channelBotTokenInput, setChannelBotTokenInput] = useState('');
  const [showChannelToken, setShowChannelToken] = useState(false);
  const [channelChatIdInput, setChannelChatIdInput] = useState('');
  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [isTogglingChannel, setIsTogglingChannel] = useState(false);
  const [isTestingChannel, setIsTestingChannel] = useState(false);
  const [isEditingChannelBot, setIsEditingChannelBot] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminTelegramOverview();
      setOverview(data);
      setChannelChatIdInput(prev => prev || data.channelChatId || '');
      if (!data.channelBotConfigured) {
        setIsEditingChannelBot(true);
      }
      if (!data.botConfigured) {
        setIsEditingMainBot(true);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'টেলিগ্রাম তথ্য লোড করতে সমস্যা হয়েছে', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = botTokenInput.trim();
    if (!trimmed) {
      showToast('অনুগ্রহ করে @BotFather থেকে পাওয়া বট টোকেন দিন।', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const res = await saveAdminTelegramBotToken(trimmed);
      setBotTokenInput('');
      setIsEditingMainBot(false);
      showToast(
        `টেলিগ্রাম বট (@${res.botUsername || res.botName}) স্থায়ীভাবে সক্রিয় হয়েছে!`,
        'success'
      );
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'বট টোকেন যাচাই ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnectBot = async () => {
    setIsSaving(true);
    try {
      await disconnectAdminTelegramBot();
      setIsEditingMainBot(true);
      showToast('টেলিগ্রাম বট সংযোগ বিচ্ছিন্ন করা হয়েছে।', 'info');
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'বিচ্ছিন্ন করতে ব্যর্থ', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleRadar = async () => {
    if (!overview || isTogglingRadar) return;
    const nextState = overview.adminRadarEnabled === false;
    setIsTogglingRadar(true);
    try {
      const res = await toggleAdminTelegramRadar(nextState);
      setOverview(prev =>
        prev
          ? {
              ...prev,
              adminRadarEnabled: res.adminRadarEnabled,
              vaultSynced: res.vaultSynced ?? prev.vaultSynced,
            }
          : prev
      );
      showToast(
        res.adminRadarEnabled
          ? 'অ্যাডমিন মাস্টার লাইভ রাডার চালু হয়েছে!'
          : 'অ্যাডমিন লাইভ রাডার বন্ধ করা হয়েছে।',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'রাডার পরিবর্তন ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsTogglingRadar(false);
    }
  };

  const handleSyncCommands = async () => {
    setIsSyncingCommands(true);
    try {
      const res = await syncAdminTelegramCommands();
      showToast(`টেলিগ্রাম বটে ${res.commandsCount}টি স্ল্যাশ কমান্ড সিঙ্ক হয়েছে!`, 'success');
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'কমান্ড সিঙ্ক ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsSyncingCommands(false);
    }
  };

  const handleSaveChannelBot = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanChannelId = (channelChatIdInput || overview?.channelChatId || '').trim();
    const cleanToken = channelBotTokenInput.trim();
    if (!cleanChannelId) {
      showToast('অনুগ্রহ করে চ্যানেল @username অথবা চ্যানেল আইডি (-100...) দিন।', 'error');
      return;
    }
    if (!cleanToken && !overview?.channelBotConfigured) {
      showToast('অনুগ্রহ করে আলাদা চ্যানেল বটের @BotFather টোকেন দিন।', 'error');
      return;
    }
    setIsSavingChannel(true);
    try {
      const res = await saveAdminChannelBotConfig({
        botToken: cleanToken || undefined,
        channelChatId: cleanChannelId,
      });
      setChannelBotTokenInput('');
      setChannelChatIdInput(res.channelChatId || cleanChannelId);
      setIsEditingChannelBot(false);
      showToast(
        `চ্যানেল বট (@${res.channelBotUsername || res.channelBotName}) "${res.channelTitle}" চ্যানেলে স্থায়ীভাবে সেভ হয়েছে!`,
        'success'
      );
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'চ্যানেল বট সেটআপ ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsSavingChannel(false);
    }
  };

  const handleToggleChannelEnabled = async () => {
    if (!overview || isTogglingChannel) return;
    const nextState = overview.channelEnabled === false;
    setIsTogglingChannel(true);
    try {
      const res = await toggleAdminChannelEnabled(nextState);
      setOverview(prev =>
        prev
          ? {
              ...prev,
              channelEnabled: res.channelEnabled,
              vaultSynced: res.vaultSynced ?? prev.vaultSynced,
            }
          : prev
      );
      showToast(
        res.channelEnabled
          ? 'টেলিগ্রাম চ্যানেল লাইভ নোটিফিকেশন চালু হয়েছে!'
          : 'টেলিগ্রাম চ্যানেল নোটিফিকেশন সাময়িক বন্ধ করা হয়েছে।',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'স্ট্যাটাস পরিবর্তন ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsTogglingChannel(false);
    }
  };

  const handleTestChannel = async () => {
    if (isTestingChannel) return;
    setIsTestingChannel(true);
    try {
      await sendAdminChannelTest();
      showToast('চ্যানেলে টেস্ট নোটিফিকেশন পাঠানো হয়েছে!', 'success');
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'টেস্ট মেসেজ পাঠানো যায়নি', 'error');
    } finally {
      setIsTestingChannel(false);
    }
  };

  const handleDisconnectChannel = async () => {
    setIsSavingChannel(true);
    try {
      await disconnectAdminChannelBot();
      setChannelChatIdInput('');
      setChannelBotTokenInput('');
      setIsEditingChannelBot(true);
      showToast('চ্যানেল নোটিফিকেশন বট সংযোগ বিচ্ছিন্ন করা হয়েছে।', 'info');
      await loadOverview();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ডিসকানেক্ট করতে ব্যর্থ', 'error');
    } finally {
      setIsSavingChannel(false);
    }
  };

  const radarOn = overview?.adminRadarEnabled !== false;
  const channelOn = overview?.channelEnabled !== false;

  return (
    <div className="space-y-6">
      {/* Top Status & Bot Token Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-sky-500/30 rounded-3xl p-6 space-y-5 shadow-xl shadow-sky-950/20">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-sky-400" />
              <span>টেলিগ্রাম লাইভ রিসিট বট কনফিগারেশন</span>
            </h3>
            <button
              type="button"
              onClick={() => void loadOverview()}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-colors disabled:opacity-50"
              title="রিফ্রেশ করুন"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>

          {overview?.botConfigured ? (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    বট সক্রিয়: <span className="text-sky-300 font-mono">@{overview.botUsername}</span> (
                    {overview.botName})
                  </span>
                </div>
                <span className="text-[11px] px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                  {overview.pollingActive ? 'লাইভ পোলিং চালু' : 'স্থায়ী সংযুক্ত'}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono flex flex-wrap items-center gap-3">
                <span>টোকেন: {overview.maskedToken}</span>
                <span>•</span>
                <span>সংযুক্ত ইউজার: {overview.linkedCount} জন</span>
              </div>
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {overview.envManaged
                    ? 'সার্ভার Environment Secret থেকে স্থায়ীভাবে লোড হয়েছে।'
                    : overview.vaultSynced
                    ? 'ক্লাউড ভল্টে স্থায়ীভাবে সেভ আছে — আর পুনরায় সেট করতে হবে না।'
                    : 'সার্ভারে স্থায়ীভাবে সংরক্ষিত আছে।'}
                </span>
              </div>

              {!isEditingMainBot && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {!overview.envManaged && (
                    <button
                      type="button"
                      onClick={() => setIsEditingMainBot(true)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>বট টোকেন পরিবর্তন করুন</span>
                    </button>
                  )}
                  {!overview.envManaged && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleDisconnectBot}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>বট ডিসকানেক্ট</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                এখনো কোনো টেলিগ্রাম বট যুক্ত নেই। নিচে <span className="font-mono">@BotFather</span> টোকেন বসিয়ে সেভ করলেই ইউজারদের টেলিগ্রামে লাইভ রিসিট যাওয়া শুরু হবে।
              </span>
            </div>
          )}

          {(!overview?.botConfigured || isEditingMainBot) && (
            <form onSubmit={handleSaveToken} className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                @BotFather বট টোকেন (একবার সেভ করলে ক্লাউড ভল্টে স্থায়ী থাকবে)
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder="যেমন: 7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={botTokenInput}
                  onChange={e => setBotTokenInput(e.target.value)}
                  className="w-full pr-10 pl-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="টোকেন দেখান/লুকান"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSaving ? 'যাচাই ও সেভ হচ্ছে...' : 'টোকেন যাচাই ও স্থায়ী সেভ করুন'}</span>
                </button>

                {overview?.botConfigured && isEditingMainBot && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingMainBot(false);
                      setBotTokenInput('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-xs cursor-pointer transition-colors"
                  >
                    বাতিল
                  </button>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Admin Master Live Radar & Command Control Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${radarOn ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                <span className="text-xs font-bold text-white">অ্যাডমিন মাস্টার লাইভ রাডার</span>
              </div>
              <button
                type="button"
                disabled={isTogglingRadar || !overview?.botConfigured}
                onClick={handleToggleRadar}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                  radarOn
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {radarOn ? '🟢 চালু আছে' : '🔴 বন্ধ আছে'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              রাডার চালু থাকলে কোনো ইউজার নতুন <strong className="text-slate-200">উইথড্র, রিচার্জ, P2P বা /support</strong> পাঠালেই অ্যাডমিনের নিজস্ব টেলিগ্রামে সাথে সাথে লাইভ সতর্কবার্তা চলে যাবে।
            </p>
          </div>

          <h3 className="text-sm font-bold text-white flex items-center gap-2 pt-1">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>৩০ সেকেন্ডে টেলিগ্রাম বট তৈরি ও চালু করার নিয়ম</span>
          </h3>

          <ol className="space-y-2 text-xs text-slate-300 leading-relaxed list-decimal list-inside">
            <li>
              টেলিগ্রাম অ্যাপে <span className="font-mono text-sky-300">@BotFather</span> ওপেন করে{' '}
              <code className="px-1.5 py-0.5 rounded bg-slate-950 text-emerald-300">/newbot</code> দিয়ে বট তৈরি করুন।
            </li>
            <li>
              পাওয়া <span className="text-amber-300 font-semibold">HTTP API Token</span> বাম পাশের বক্সে পেস্ট করে সেভ করুন।
            </li>
            <li>
              ব্যস! একবার সেভ করলেই ক্লাউড ভল্টে স্থায়ীভাবে সংরক্ষিত থাকবে—রিফ্রেশ বা রিস্টার্টে আর কখনো পুনরায় সেট করতে হবে না।
            </li>
          </ol>

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center gap-2.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              সুরক্ষা: বট টোকেন কখনোই সাধারণ ইউজার বা ব্রাউজারে পাঠানো হয় না—এবং টেলিগ্রাম বট থেকে কোনো অ্যাডমিন প্যানেল এক্সেস করা যায় না।
            </span>
          </div>
        </div>
      </div>

      {/* Dedicated Send-Only Official Channel Notification Bot */}
      <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 space-y-5 shadow-xl shadow-emerald-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-emerald-400" />
              <span>অফিশিয়াল টেলিগ্রাম চ্যানেল নোটিফিকেশন বট (আলাদা সেন্ড-অনলি বট)</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              একবার সেট করলে ক্লাউড ভল্টে স্থায়ীভাবে সেভ থাকবে (আর পুনরায় সেট করতে হবে না)। সকল উইথড্র, রিচার্জ, P2P, বোনাস ও সাপোর্ট নোটিফিকেশন ইউজারদের নাম/নম্বর হাইড রেখে চ্যানেলে পোস্ট হবে।
            </p>
          </div>

          <div className="flex items-center gap-2">
            {overview?.channelBotConfigured && (
              <button
                type="button"
                disabled={isTogglingChannel}
                onClick={handleToggleChannelEnabled}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                  channelOn
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {channelOn ? '🟢 চ্যানেল পোস্ট চালু' : '🔴 চ্যানেল পোস্ট বন্ধ'}
              </button>
            )}
          </div>
        </div>

        {overview?.channelBotConfigured ? (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-white flex-wrap">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  চ্যানেল: <span className="text-emerald-300">{overview.channelTitle || overview.channelChatId}</span>
                </span>
                <span className="text-slate-300 font-mono text-[11px]">
                  ({overview.channelUsername ? `${overview.channelUsername} • ` : ''}
                  {overview.channelChatId})
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-[10px] font-bold">
                  একবার সেভ — স্থায়ী সক্রিয়
                </span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono flex flex-wrap items-center gap-3">
                <span>চ্যানেল বট: @{overview.channelBotUsername || overview.channelBotName}</span>
                <span>•</span>
                <span>টোকেন: {overview.channelMaskedToken}</span>
                <span>•</span>
                <span className="text-emerald-300">DM কমান্ড লকড (Send-Only)</span>
              </div>
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {overview.channelEnvManaged || overview.channelChatIdEnvManaged
                    ? 'সার্ভার Environment Secret থেকে স্থায়ীভাবে যুক্ত আছে।'
                    : overview.vaultSynced
                    ? 'এনক্রিপ্টেড ক্লাউড ভল্টে স্থায়ীভাবে সংরক্ষিত — রিফ্রেশ, রিস্টার্ট বা পাবলিশ করলেও আর সেট করতে হবে না।'
                    : 'সার্ভারে স্থায়ীভাবে সংরক্ষিত আছে।'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isTestingChannel}
                onClick={handleTestChannel}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isTestingChannel ? 'পাঠানো হচ্ছে...' : 'টেস্ট চ্যানেল পোস্ট'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setChannelChatIdInput(overview.channelUsername || overview.channelChatId || '');
                  setIsEditingChannelBot(prev => !prev);
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{isEditingChannelBot ? 'ফর্ম লুকান' : 'পরিবর্তন করুন'}</span>
              </button>
              <button
                type="button"
                disabled={isSavingChannel}
                onClick={handleDisconnectChannel}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>ডিসকানেক্ট</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-2.5 text-xs text-slate-300">
            <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              এখনো কোনো আলাদা চ্যানেল বট যুক্ত নেই। নিচে একবার <span className="font-mono text-sky-300">@BotFather</span> টোকেন এবং আপনার টেলিগ্রাম চ্যানেলের <span className="font-mono text-emerald-300">@username</span> বা <span className="font-mono text-emerald-300">-100...</span> আইডি সেভ করলেই এটি স্থায়ীভাবে সংরক্ষিত থাকবে—আর পুনরায় সেট করতে হবে না।
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {(!overview?.channelBotConfigured || isEditingChannelBot) ? (
            <form onSubmit={handleSaveChannelBot} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  চ্যানেল বটের @BotFather টোকেন{' '}
                  {overview?.channelBotConfigured ? '(আগের টোকেন রাখতে চাইলে ফাঁকা রাখুন)' : ''}
                </label>
                <div className="relative">
                  <input
                    type={showChannelToken ? 'text' : 'password'}
                    placeholder={
                      overview?.channelBotConfigured
                        ? 'টোকেন সেভ করা আছে — শুধু বদলাতে চাইলে নতুন টোকেন দিন'
                        : 'যেমন: 7987654321:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                    }
                    value={channelBotTokenInput}
                    onChange={e => setChannelBotTokenInput(e.target.value)}
                    className="w-full pr-10 pl-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowChannelToken(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    aria-label="চ্যানেল বট টোকেন দেখান/লুকান"
                  >
                    {showChannelToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  টেলিগ্রাম চ্যানেল @username অথবা চ্যানেল ID
                </label>
                <input
                  type="text"
                  placeholder="যেমন: @captchapay_live অথবা -1001234567890"
                  value={channelChatIdInput}
                  onChange={e => setChannelChatIdInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={isSavingChannel}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {isSavingChannel
                      ? 'যাচাই ও স্থায়ীভাবে সেভ হচ্ছে...'
                      : overview?.channelBotConfigured
                      ? 'পরিবর্তন স্থায়ীভাবে সেভ করুন'
                      : 'চ্যানেল বট যাচাই ও স্থায়ী সেভ করুন'}
                  </span>
                </button>
                {overview?.channelBotConfigured && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingChannelBot(false);
                      setChannelBotTokenInput('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-xs cursor-pointer transition-colors"
                  >
                    বাতিল
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/20 flex flex-col justify-center space-y-2">
              <div className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>চ্যানেল বট স্থায়ীভাবে সেটআপ সম্পন্ন হয়েছে</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                আপনার চ্যানেল বট টোকেন ও চ্যানেল আইডি (<span className="font-mono text-slate-200">{overview.channelChatId}</span>) স্থায়ীভাবে সংরক্ষিত রয়েছে। নতুন করে আর টোকেন বা চ্যানেল আইডি বসাতে হবে না—সব নোটিফিকেশন স্বয়ংক্রিয়ভাবে চ্যানেলে যাবে।
              </p>
            </div>
          )}

          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs text-slate-300">
              <div className="font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>গোপনীয়তা ও স্থায়ী সুরক্ষা (গ্যারান্টি)</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed list-disc list-inside">
                <li>
                  <strong className="text-slate-200">একবার সেট করলে আর লাগবে না:</strong> চ্যানেল বট টোকেন এবং চ্যানেল আইডি সার্ভার ও এনক্রিপ্টেড ক্লাউড ভল্টে ডাবল-ব্যাকআপ থাকে।
                </li>
                <li>
                  <strong className="text-slate-200">বটের ইনবক্স (DM) সম্পূর্ণ বন্ধ:</strong> এই চ্যানেল বটটি শুধুমাত্র চ্যানেলেই মেসেজ পাঠাবে। কোনো ইউজার এই বটের ভেতর গিয়ে মেসেজ বা কমান্ড দিয়ে কিছুই দেখতে পারবে না।
                </li>
                <li>
                  <strong className="text-slate-200">নাম, ফোন ও ইমেইল হাইড:</strong> চ্যানেলের প্রতিটি পোস্টে আসল নাম, ইমেইল, ফোন/বিকাশ/নগদ নম্বর ও TrxID গোপন থাকবে—শুধুমাত্র ইউজারনেম (<code className="text-emerald-300">@username</code>) দেখাবে।
                </li>
                <li>
                  <strong className="text-slate-200">সেটআপ:</strong> <span className="font-mono text-sky-300">@BotFather</span> দিয়ে একটি নতুন বট বানান → আপনার চ্যানেলের <strong>Administrators</strong>-এ গিয়ে বটটিকে <em>Post Messages</em> পারমিশনসহ অ্যাড করুন → টোকেন ও চ্যানেল আইডি দিয়ে একবার সেভ করুন।
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Registered Slash Commands Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-sky-400" />
              <span>টেলিগ্রাম বটের সক্রিয় কমান্ড লিস্ট ({overview?.commands?.length || 12}টি)</span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              টেলিগ্রামের বাম পাশের <strong>Menu</strong> বাটনে এই কমান্ডগুলো স্বয়ংক্রিয়ভাবে যুক্ত থাকে
            </p>
          </div>

          {overview?.botConfigured && (
            <button
              type="button"
              disabled={isSyncingCommands}
              onClick={handleSyncCommands}
              className="px-3.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCommands ? 'animate-spin' : ''}`} />
              <span>{isSyncingCommands ? 'সিঙ্ক হচ্ছে...' : 'কমান্ড লিস্ট সিঙ্ক'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {(overview?.commands || []).map(c => (
            <div key={c.command} className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-0.5">
              <code className="text-xs font-bold text-sky-300 font-mono">/{c.command}</code>
              <div className="text-[11px] text-slate-400">{c.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Linked Users Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            <span>টেলিগ্রাম যুক্ত ইউজার ({overview?.linkedCount || 0})</span>
          </h4>
        </div>

        {!overview?.linkedUsers || overview.linkedUsers.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800">
            এখনো কোনো ইউজার টেলিগ্রাম বট যুক্ত করেননি।
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {overview.linkedUsers.map(u => (
              <div
                key={u.uid}
                className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1"
              >
                <div className="text-xs font-bold text-white truncate">{u.name}</div>
                <div className="text-[11px] text-slate-400 font-mono truncate">{u.email}</div>
                <div className="text-[11px] text-sky-300 font-mono flex items-center justify-between pt-1">
                  <span>{u.username ? `@${u.username}` : 'Username নেই'}</span>
                  <span className="text-emerald-400">ID: {u.chatId}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivery Logs */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-emerald-400" />
          <span>সাম্প্রতিক টেলিগ্রাম রিসিট ডেলিভারি লগ ({overview?.recentLogs?.length || 0})</span>
        </h4>

        {!overview?.recentLogs || overview.recentLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800">
            এখনো কোনো লাইভ রিসিট লগ তৈরি হয়নি।
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {overview.recentLogs.map(log => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        log.status === 'sent'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : log.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {log.status === 'sent' ? 'পাঠানো হয়েছে' : log.status === 'failed' ? 'ব্যর্থ' : 'স্কিপ'}
                    </span>
                    <span className="font-bold text-white">{log.recipientLabel}</span>
                    <span className="text-[11px] text-sky-300 font-mono">[{log.eventType}]</span>
                  </div>
                  <div className="text-[11px] text-slate-300 truncate">{log.summary}</div>
                  {log.error && (
                    <div className="text-[10px] text-rose-400">ত্রুটি: {log.error}</div>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
