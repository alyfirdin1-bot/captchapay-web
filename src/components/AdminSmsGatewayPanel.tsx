import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  deleteGatewaySmsLog,
  downloadAndroidSmsGatewayZip,
  fetchSmsGatewayAdminState,
  sendTestGatewaySms,
  updateSmsGatewayConfig,
  type SmsGatewayAdminState,
  type SmsGatewayLogItem,
} from '../lib/smsGatewayService';
import type { RechargeRequest } from '../types';
import {
  Smartphone,
  Download,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
  BatteryCharging,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Activity,
  CheckCircle2,
  Trash2,
  Send,
  FileCode2,
  FolderOpen,
  Power,
  Sparkles,
  Cloud,
  AlertCircle,
  Search,
} from 'lucide-react';

interface AdminSmsGatewayPanelProps {
  pendingDeposits: RechargeRequest[];
  onApproveMatchedDeposit: (deposit: RechargeRequest, smsLogId: string) => Promise<void>;
}

export const AdminSmsGatewayPanel: React.FC<AdminSmsGatewayPanelProps> = ({
  pendingDeposits,
  onApproveMatchedDeposit,
}) => {
  const { showToast } = useAuth();
  const [state, setState] = useState<SmsGatewayAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [approvingDepositId, setApprovingDepositId] = useState<string | null>(null);

  // Test simulator state
  const [simSender, setSimSender] = useState('bKash');
  const [simBody, setSimBody] = useState(
    'You have received Tk 500.00 from 01712345678. Fee Tk 0.00. Balance Tk 4500.00. TrxID 9J7K3X2L8P'
  );
  const [isSimulating, setIsSimulating] = useState(false);
  const [logSearchQuery, setLogSearchQuery] = useState('');

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchSmsGatewayAdminState();
      setState(data);
    } catch (err) {
      if (!silent) {
        showToast(
          err instanceof Error ? err.message : 'SMS গেটওয়ে তথ্য লোড করতে ব্যর্থ',
          'error'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadState(false);
    const timer = setInterval(() => {
      void loadState(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [loadState]);

  const copyText = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
      showToast(`${label} কপি হয়েছে!`, 'success');
    } catch {
      showToast('কপি করা যায়নি', 'error');
    }
  };

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try {
      await downloadAndroidSmsGatewayZip();
      showToast('Android SMS Gateway প্রজেক্ট (.zip) ডাউনলোড শুরু হয়েছে!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ডাউনলোড ব্যর্থ হয়েছে', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!state || isUpdatingConfig) return;
    setIsUpdatingConfig(true);
    try {
      const res = await updateSmsGatewayConfig({ enabled: !state.enabled });
      setState(res.state);
      showToast(
        res.state.enabled ? 'SMS গেটওয়ে রিসিভার চালু করা হয়েছে' : 'SMS গেটওয়ে সাময়িক বন্ধ করা হয়েছে',
        'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'আপডেট ব্যর্থ', 'error');
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleRotateToken = async () => {
    if (!state || state.envManaged || isUpdatingConfig) return;
    setIsUpdatingConfig(true);
    try {
      const res = await updateSmsGatewayConfig({ rotateToken: true });
      setState(res.state);
      setShowSecret(true);
      showToast('নতুন সিকিউরিটি টোকেন তৈরি ও ক্লাউড ভল্টে সংরক্ষণ করা হয়েছে!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'টোকেন পরিবর্তন ব্যর্থ', 'error');
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleSimulateSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simBody.trim()) return;
    setIsSimulating(true);
    try {
      const res = await sendTestGatewaySms({ smsSender: simSender, rawBody: simBody });
      setState(res.state);
      showToast('টেস্ট SMS পার্সার ও মনিটরে যুক্ত হয়েছে!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'টেস্ট ব্যর্থ', 'error');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await deleteGatewaySmsLog(logId);
      setState(prev =>
        prev
          ? {
              ...prev,
              smsLogs: prev.smsLogs.filter(l => l.id !== logId),
            }
          : prev
      );
      showToast('লগ মুছে ফেলা হয়েছে', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'মুছতে ব্যর্থ', 'error');
    }
  };

  const findMatchingDeposit = useCallback(
    (log: SmsGatewayLogItem): RechargeRequest | undefined => {
      if (!log.trxId) return undefined;
      const logTrx = log.trxId.trim().toUpperCase();
      return pendingDeposits.find(d => (d.trxId || '').trim().toUpperCase() === logTrx);
    },
    [pendingDeposits]
  );

  const androidJsonConfig = useMemo(() => {
    if (!state) return '';
    return JSON.stringify(
      {
        serverUrl: state.serverUrl,
        gatewayToken: state.gatewayToken,
      },
      null,
      2
    );
  }, [state]);

  const filteredSmsLogs = useMemo(() => {
    const logs = state?.smsLogs || [];
    const q = logSearchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l => {
      return (
        (l.trxId || '').toLowerCase().includes(q) ||
        String(l.amount ?? '').toLowerCase().includes(q) ||
        (l.senderNumber || '').toLowerCase().includes(q) ||
        (l.smsSender || '').toLowerCase().includes(q) ||
        (l.deviceName || '').toLowerCase().includes(q) ||
        (l.rawBody || '').toLowerCase().includes(q)
      );
    });
  }, [state?.smsLogs, logSearchQuery]);

  const handleQuickApprove = async (deposit: RechargeRequest, log: SmsGatewayLogItem) => {
    setApprovingDepositId(deposit.id);
    try {
      await onApproveMatchedDeposit(deposit, log.id);
      await loadState(true);
    } finally {
      setApprovingDepositId(null);
    }
  };

  if (loading && !state) {
    return (
      <div className="p-10 bg-slate-900 border border-slate-800 rounded-2xl text-center text-slate-400 text-sm">
        SMS গেটওয়ে ও ডিভাইস মনিটর লোড হচ্ছে...
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="space-y-6">
      {/* Top Hero Banner: Android APK Project & Live Monitoring Overview */}
      <div className="p-6 bg-gradient-to-br from-emerald-950/50 via-slate-900 to-sky-950/40 border border-emerald-500/30 rounded-2xl shadow-xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-white">
                  অ্যান্ড্রয়েড ডিপোজিট SMS গেটওয়ে অ্যাপ ও লাইভ মনিটরিং
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                    state.enabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  }`}
                >
                  {state.enabled ? 'গেটওয়ে সক্রিয়' : 'গেটওয়ে বিরতিতে'}
                </span>
                {state.vaultSynced && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    <Cloud className="w-3 h-3" />
                    Cloud Vault সিঙ্কড
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
                আপনার অ্যান্ড্রয়েড ফোনে ইনস্টল করার জন্য সম্পূর্ণ নেটিভ <b>CaptchaPay SMS Gateway</b>{' '}
                প্রজেক্ট তৈরি রয়েছে—যা ফোনের বিকাশ/নগদ/রকেট SMS পড়ে রিয়েল-টাইমে ডিপোজিট সার্ভারে পাঠাবে এবং
                পেন্ডিং ডিপোজিটের TrxID-এর সাথে স্বয়ংক্রিয়ভাবে ম্যাচ করবে।
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadState(false)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>রিফ্রেশ</span>
            </button>

            <button
              type="button"
              onClick={handleToggleEnabled}
              disabled={isUpdatingConfig}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                state.enabled
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{state.enabled ? 'গেটওয়ে থামান' : 'গেটওয়ে চালু করুন'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isDownloading}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 cursor-pointer transition shadow-lg active:scale-95 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              <span>
                {isDownloading ? 'প্যাকেজ তৈরি হচ্ছে...' : 'Android অ্যাপ প্রজেক্ট (.zip) ডাউনলোড'}
              </span>
            </button>
          </div>
        </div>

        {/* File Path & Honest APK Compilation Info */}
        <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span>প্রজেক্ট ফাইলের অবস্থান (Workspace Path):</span>
              <code className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-emerald-300 font-mono">
                /android-sms-gateway/
              </code>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              APK Output Path: app/build/outputs/apk/debug/app-debug.apk
            </span>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-300 leading-relaxed bg-amber-500/10 border border-amber-500/25 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <b>গুরুত্বপূর্ণ তথ্য (APK বিল্ড):</b> এই ওয়েব সার্ভার এনভায়রনমেন্টে Java JDK / Android SDK না থাকায় সরাসরি
              বাইনারি <code className="text-amber-200">.apk</code> এখানে কম্পাইল করা সম্ভব নয়। তাই উপরের{' '}
              <b>ডাউনলোড (.zip)</b> বাটনে ক্লিক করে সম্পূর্ণ Android Studio Kotlin প্রজেক্টটি ডাউনলোড করুন—এতে থাকা{' '}
              <code className="text-emerald-300">Android Studio</code> দিয়ে অথবা ভেতরে যুক্ত{' '}
              <code className="text-sky-300">.github/workflows/build-sms-gateway-apk.yml</code>{' '}
              ফাইলটি GitHub Actions-এ রান করে ২ মিনিটেই আসল <b>.apk</b> ফাইল পেয়ে যাবেন। প্রজেক্টে{' '}
              <code className="text-slate-200">RECEIVE_SMS</code>, <code className="text-slate-200">READ_SMS</code>,{' '}
              <code className="text-slate-200">FOREGROUND_SERVICE</code>,{' '}
              <code className="text-slate-200">BOOT_COMPLETED</code>, এবং{' '}
              <code className="text-slate-200">IGNORE_BATTERY_OPTIMIZATIONS</code> সহ সব পারমিশন যুক্ত করা আছে।
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">সংযুক্ত ফোন (Online)</div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {state.stats.onlineDevices} / {state.stats.totalDevices}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">মোট ক্যাপচারড SMS</div>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {state.stats.totalCaptured} টি
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">ডিপোজিট ম্যাচড</div>
            <div className="text-xl font-bold font-mono text-sky-400 mt-1">
              {state.stats.matchedCount} টি
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">পেন্ডিং আনম্যাচড TrxID</div>
            <div className="text-xl font-bold font-mono text-amber-400 mt-1">
              {state.stats.unmatchedPaymentCount} টি
            </div>
          </div>
        </div>
      </div>

      {/* Credentials & 1-Tap Android JSON Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-sky-400" />
              <span>অ্যান্ড্রয়েড অ্যাপ কানেকশন সেটিংস</span>
            </h4>
            {!state.envManaged && (
              <button
                type="button"
                onClick={handleRotateToken}
                disabled={isUpdatingConfig}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>নতুন টোকেন</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Server Base URL</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={state.serverUrl}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300"
                />
                <button
                  type="button"
                  onClick={() => void copyText('url', state.serverUrl, 'Server URL')}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white cursor-pointer"
                >
                  {copiedKey === 'url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {(state.serverUrl.includes('ais-dev-') || state.serverUrl.includes('ais-pre-')) && (
                <p className="text-[10px] text-amber-300/90 mt-1.5 leading-relaxed">
                  নোট: <code>ais-dev</code> / <code>ais-pre</code> প্রিভিউ লিংকে Google লগইন গেট (HTTP 302) থাকায় ফোনের ব্যাকগ্রাউন্ড অ্যাপ থেকে সরাসরি কানেক্ট হতে হলে অ্যাপটি পাবলিক Cloud Run বা কাস্টম ডোমেইনে Deploy/Publish করে সেই URL-টি ফোনের অ্যাপে দিন।
                </p>
              )}
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Gateway Secret Token (HMAC-SHA256 Auth)
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={showSecret ? state.gatewayToken : state.maskedToken}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-amber-300"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(v => !v)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText('token', state.gatewayToken, 'Gateway Token')}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white cursor-pointer"
                >
                  {copiedKey === 'token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void copyText('json', androidJsonConfig, 'Android JSON Config')}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition"
            >
              {copiedKey === 'json' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>১-ক্লিকে Android App Config JSON কপি করুন (ফোনের অ্যাপে পেস্টের জন্য)</span>
            </button>
          </div>
        </div>

        {/* Live Test SMS Simulator */}
        <form
          onSubmit={handleSimulateSms}
          className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>লাইভ SMS গেটওয়ে টেস্ট সিমুলেটর</span>
            </h4>
            <span className="text-[10px] text-slate-400">ডিপোজিট সার্ভার যাচাই</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={simSender}
              onChange={e => setSimSender(e.target.value)}
              placeholder="Sender (bKash)"
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
            />
            <button
              type="button"
              onClick={() => {
                const pendingFirst = pendingDeposits[0];
                if (pendingFirst) {
                  setSimSender(pendingFirst.method);
                  setSimBody(
                    `You have received Tk ${pendingFirst.amount}.00 from ${pendingFirst.senderNumber}. Fee Tk 0.00. TrxID ${pendingFirst.trxId}`
                  );
                } else {
                  showToast('কোনো পেন্ডিং ডিপোজিট নেই', 'info');
                }
              }}
              className="col-span-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
            >
              সর্বশেষ পেন্ডিং ডিপোজিটের নমুনা SMS বসান
            </button>
          </div>

          <textarea
            rows={2}
            value={simBody}
            onChange={e => setSimBody(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 resize-none"
          />

          <button
            type="submit"
            disabled={isSimulating}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSimulating ? 'পাঠানো হচ্ছে...' : 'টেস্ট SMS ডিপোজিট সার্ভারে পাঠান'}</span>
          </button>
        </form>
      </div>

      {/* Connected Android Devices Live Monitoring */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>সংযুক্ত অ্যান্ড্রয়েড ডিভাইস মনিটর ({state.devices.length})</span>
          </h4>
          <span className="text-[11px] text-slate-400">প্রতি ১০ সেকেন্ডে অটো-রিফ্রেশ</span>
        </div>

        {state.devices.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
            এখনো কোনো অ্যান্ড্রয়েড ফোন সংযুক্ত হয়নি। অ্যাপটি ইনস্টল করে <b>Test Connection</b> বা{' '}
            <b>Save &amp; Start Monitor</b> চাপলে এখানে লাইভ ব্যাটারি, সিম ও অনলাইন স্ট্যাটাস দেখা যাবে।
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {state.devices.map(dev => (
              <div
                key={dev.deviceId}
                className={`p-4 rounded-xl bg-slate-950 border ${
                  dev.isOnline ? 'border-emerald-500/40' : 'border-slate-800'
                } space-y-2.5`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">{dev.deviceName}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{dev.model}</div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      dev.isOnline
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        dev.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                      }`}
                    />
                    {dev.isOnline ? 'অনলাইন' : 'অফলাইন'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <BatteryCharging className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {dev.batteryPct >= 0 ? `${dev.batteryPct}%` : 'N/A'}
                      {dev.isCharging ? ' ⚡' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-sky-400" />
                    <span>{dev.networkType}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {dev.permissionsGranted ? (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    <span>{dev.permissionsGranted ? 'SMS Perm OK' : 'Perm Missing'}</span>
                  </div>
                  <div className="font-mono text-slate-400">
                    SIM: {dev.simOperator || 'Unknown'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Sent: {dev.totalSmsSent} | Queue: {dev.queueDepth}</span>
                  <span>
                    {new Date(dev.lastHeartbeatAt).toLocaleTimeString('bn-BD', {
                      timeZone: 'Asia/Dhaka',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Received SMS Stream & Auto-Matching Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-white">
              লাইভ ফরোয়ার্ডকৃত পেমেন্ট SMS ও ডিপোজিট ম্যাচিং ({filteredSmsLogs.length})
            </h4>
            <span className="text-[11px] text-slate-400">
              ফোন অ্যাপ বা সিমুলেটর থেকে আসা প্রতিটি SMS এখানে রিয়েল-টাইমে TrxID ও পরিমাণসহ দেখা যায়
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={logSearchQuery}
              onChange={e => setLogSearchQuery(e.target.value)}
              placeholder="TrxID বা পরিমাণ দিয়ে খুঁজুন..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="py-3 px-4">সময় ও সোর্স</th>
                <th className="py-3 px-4">পার্সড মেথড ও পরিমাণ</th>
                <th className="py-3 px-4">TrxID ও সেন্ডার</th>
                <th className="py-3 px-4">মূল SMS টেক্সট</th>
                <th className="py-3 px-4 text-center">ডিপোজিট ম্যাচিং স্ট্যাটাস</th>
                <th className="py-3 px-4 text-center">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredSmsLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    {logSearchQuery.trim()
                      ? `"${logSearchQuery}" দিয়ে কোনো SMS পাওয়া যায়নি।`
                      : 'এখনো কোনো SMS আসেনি। উপরের টেস্ট সিমুলেটর বা আপনার অ্যান্ড্রয়েড অ্যাপ থেকে টেস্ট করতে পারেন।'}
                  </td>
                </tr>
              ) : (
                filteredSmsLogs.map(log => {
                  const pendingMatch = findMatchingDeposit(log);
                  const amountMatches =
                    pendingMatch &&
                    typeof log.amount === 'number' &&
                    Math.abs(pendingMatch.amount - log.amount) <= 1;

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white">{log.smsSender}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              log.source === 'android'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {log.source === 'android' ? 'ফোন অ্যাপ' : 'সিমুলেটর'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {log.deviceName} {log.isTest ? '(Test)' : ''}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {new Date(log.receivedAt).toLocaleString('bn-BD', {
                            timeZone: 'Asia/Dhaka',
                          })}
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-pink-300">
                          {log.detectedMethod || 'অজানা'}
                        </div>
                        <div className="font-mono font-bold text-emerald-400 text-sm">
                          {typeof log.amount === 'number' ? `৳${log.amount}` : 'N/A'}
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap font-mono">
                        <div className="text-amber-300 font-bold">{log.trxId || 'N/A'}</div>
                        <div className="text-[11px] text-slate-400">{log.senderNumber || '-'}</div>
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-[11px] text-slate-300 font-mono break-words line-clamp-2">
                          {log.rawBody}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        {log.matchedDepositId ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/35 text-emerald-300 text-[11px] font-bold font-mono">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            অনুমোদিত ({log.matchedDepositId})
                          </span>
                        ) : pendingMatch ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                amountMatches
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {amountMatches
                                ? `১০০% ম্যাচ: ${pendingMatch.userName} (৳${pendingMatch.amount})`
                                : `TrxID ম্যাচ, কিন্তু পরিমাণ ভিন্ন (আবেদন ৳${pendingMatch.amount})`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">কোনো পেন্ডিং আবেদন নেই</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {pendingMatch && !log.matchedDepositId && (
                            <button
                              type="button"
                              disabled={approvingDepositId === pendingMatch.id}
                              onClick={() => void handleQuickApprove(pendingMatch, log)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              {approvingDepositId === pendingMatch.id
                                ? 'অনুমোদন হচ্ছে...'
                                : '১-ক্লিক অনুমোদন'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteLog(log.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer transition"
                            title="লগ মুছুন"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
  );
};
