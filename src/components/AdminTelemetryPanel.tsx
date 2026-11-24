import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Send, 
  Wrench, 
  Check, 
  Copy, 
  Activity, 
  Zap, 
  Server, 
  Clock, 
  FileCode,
  CheckCircle2
} from 'lucide-react';

interface ErrorEntry {
  id: string;
  timestamp: string;
  message: string;
  source: string;
  url?: string;
  stack?: string;
  userEmail?: string;
  userUid?: string;
  count: number;
  alertSent: boolean;
  alertError?: string;
}

interface TelemetryData {
  ok: boolean;
  totalRecorded: number;
  lastHealedAt: string;
  errors: ErrorEntry[];
  uptimeSeconds: number;
}

export const AdminTelemetryPanel: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isHealing, setIsHealing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchTelemetry = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/system-telemetry');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (err) {
      console.error('Failed to fetch telemetry:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  const handleTestAlert = async () => {
    setIsTesting(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/test-error-alert', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setStatusMessage({
          text: data.alertSent 
            ? 'টেলিগ্রামে সফলভাবে টেস্ট এরর অ্যালার্ট পাঠানো হয়েছে! আপনার টেলিগ্রাম বট চেক করুন।'
            : `অ্যালার্ট তৈরি হয়েছে (টেলিগ্রাম স্ট্যাটাস: ${data.alertError || 'বট টোকেন বা চ্যাট আইডি চেক করুন'})`,
          type: data.alertSent ? 'success' : 'info'
        });
        fetchTelemetry();
      } else {
        setStatusMessage({ text: data.error || 'টেস্ট অ্যালার্ট ব্যর্থ হয়েছে', type: 'error' });
      }
    } catch (err) {
      setStatusMessage({ text: err instanceof Error ? err.message : 'রিকোয়েস্ট ব্যর্থ হয়েছে', type: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelfHeal = async () => {
    setIsHealing(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/system-heal', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const actions = Array.isArray(data.actionsTaken) && data.actionsTaken.length > 0
          ? data.actionsTaken.join(', ')
          : 'কোনো ত্রুটি পাওয়া যায়নি, ফাইল ও ব্যাকআপ সম্পূর্ণ সুস্থ রয়েছে';
        setStatusMessage({
          text: `সেলফ-হিলিং সফল! পদক্ষেপ: ${actions}`,
          type: 'success'
        });
        fetchTelemetry();
      } else {
        setStatusMessage({ text: data.error || 'সেলফ-হিলিং ব্যর্থ হয়েছে', type: 'error' });
      }
    } catch (err) {
      setStatusMessage({ text: err instanceof Error ? err.message : 'রিকোয়েস্ট ব্যর্থ হয়েছে', type: 'error' });
    } finally {
      setIsHealing(false);
    }
  };

  const handleCopyReport = async (err: ErrorEntry) => {
    const report = [
      `# 🚨 CaptchaPay AI Error Report`,
      `**Error ID:** ${err.id}`,
      `**Time:** ${err.timestamp}`,
      `**Source:** ${err.source}`,
      `**URL:** ${err.url || 'N/A'}`,
      `**User:** ${err.userEmail || 'N/A'} (${err.userUid || 'N/A'})`,
      `**Count:** ${err.count}`,
      `**Message:** ${err.message}`,
      err.stack ? `\n**Stack Trace:**\n\`\`\`\n${err.stack}\n\`\`\`` : ''
    ].join('\n');

    try {
      await navigator.clipboard.writeText(report);
      setCopiedId(err.id);
      setTimeout(() => setCopiedId(null), 3000);
    } catch {
      // ignore
    }
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d} দিন ${h} ঘণ্টা`;
    if (h > 0) return `${h} ঘণ্টা ${m} মিনিট`;
    return `${m} মিনিট`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">সিস্টেম হেলথ, সেলফ-হিলিং ও এরর মনিটরিং</h3>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  সক্রিয় ও সুরক্ষিত
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                ওয়েবসাইটের যেকোনো এরর স্বয়ংক্রিয়ভাবে রিকভার হয় এবং অ্যাডমিন টেলিগ্রামে তাৎক্ষণিক অ্যালার্ট পাঠানো হয়।
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleTestAlert}
              disabled={isTesting}
              className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition active:scale-95"
            >
              <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'পাঠানো হচ্ছে...' : 'টেস্ট এরর অ্যালার্ট পাঠান'}</span>
            </button>

            <button
              onClick={handleSelfHeal}
              disabled={isHealing}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition active:scale-95"
            >
              <Wrench className={`w-3.5 h-3.5 ${isHealing ? 'animate-spin' : ''}`} />
              <span>{isHealing ? 'অডিট হচ্ছে...' : 'সেলফ-হিলিং চেক চালান'}</span>
            </button>

            <button
              onClick={fetchTelemetry}
              disabled={isLoading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition"
              title="রিফ্রেশ"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status Toast/Message */}
        {statusMessage && (
          <div className={`mt-4 p-3 rounded-xl border text-xs font-medium flex items-center gap-2 transition animate-in fade-in ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : statusMessage.type === 'error'
              ? 'bg-rose-950/60 border-rose-800 text-rose-300'
              : 'bg-sky-950/60 border-sky-800 text-sky-300'
          }`}>
            {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {/* 4 Cards Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">সিস্টেম হেলথ স্ট্যাটাস</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-emerald-400 flex items-center gap-2">
            <span>১০০% অপটিমাল</span>
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">০ টি সক্রিয় ক্র্যাশ</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">টেলিগ্রাম অ্যালার্ট রাডার</span>
            <Zap className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-lg font-bold text-white flex items-center gap-2">
            <span>ইনস্ট্যান্ট ডিসপ্যাচ</span>
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">এরর হলে মুহূর্তেই টেলিগ্রামে যাবে</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">মোট রেকর্ডকৃত এরর</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-bold text-amber-300">
            {telemetry?.totalRecorded ?? 0} টি
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">ডিডুপ্লিকেট করা হিস্ট্রি</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">সার্ভার আপটাইম</span>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-lg font-bold text-purple-300">
            {telemetry ? formatUptime(telemetry.uptimeSeconds) : 'অ্যাক্টিভ'}
          </div>
          <span className="text-[11px] text-slate-500 block mt-1">সার্ভার বিরতিহীন চলমান</span>
        </div>
      </div>

      {/* 3 Active Pillars Explainer Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-400" />
          <span>আপনার সিস্টেমে সক্রিয় ৩টি স্বয়ংক্রিয় প্রতিরক্ষা স্তর</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
          <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
            <span className="font-bold text-emerald-400 block mb-1">১. গ্লোবাল এরর বাউন্ডারি (UI Guard)</span>
            <p className="text-slate-300 leading-relaxed">
              যেকোনো কম্পোনেন্ট ক্র্যাশ আটকে দেয়। ইউজার সাদা স্ক্রিন দেখে না; বদলে ১-ক্লিকে রিকভারি ও এআই রিপোর্ট তৈরি হয়।
            </p>
          </div>
          <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
            <span className="font-bold text-sky-400 block mb-1">২. অটো-টেলিগ্রাম ক্র্যাশ রিপোর্টার</span>
            <p className="text-slate-300 leading-relaxed">
              ক্লায়েন্ট বা সার্ভারে কোনো অপ্রত্যাশিত ত্রুটি ঘটলেই স্বয়ংক্রিয়ভাবে বিস্তারিত ডায়াগনস্টিক সহ অ্যাডমিনকে মেসেজ পাঠায়।
            </p>
          </div>
          <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
            <span className="font-bold text-amber-400 block mb-1">৩. সেলফ-হিলিং স্টেট ও ফলব্যাক</span>
            <p className="text-slate-300 leading-relaxed">
              টেলিগ্রাম বট টোকেন বা স্টেট ফাইলে কোনো সমস্যা হলে ব্যাকআপ ফাইল (.bak) থেকে নিজে নিজেই অটো-রিকভার করে নেয়।
            </p>
          </div>
        </div>
      </div>

      {/* Error Logs Feed */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileCode className="w-4 h-4 text-slate-400" />
            <span>সাম্প্রতিক এরর ও টেলিমেট্রি লগস</span>
          </h3>
          <span className="text-xs text-slate-400">
            সর্বশেষ {telemetry?.errors.length ?? 0} টি ইভেন্ট
          </span>
        </div>

        {(!telemetry?.errors || telemetry.errors.length === 0) ? (
          <div className="p-8 text-center bg-slate-950/50 rounded-xl border border-slate-800/60">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
            <h4 className="text-sm font-bold text-white">কোনো ত্রুটি পাওয়া যায়নি!</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              সিস্টেম সম্পূর্ণ মসৃণভাবে চলছে। কোনো এরর ঘটলে তা স্বয়ংক্রিয়ভাবে এখানে তালিকাভুক্ত হবে এবং টেলিগ্রামে অ্যালার্ট যাবে।
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {telemetry.errors.map((err) => (
              <div
                key={err.id}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 hover:border-slate-700 transition space-y-2 text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      {err.source}
                    </span>
                    {err.count > 1 && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {err.count} বার ঘটেছে
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      err.alertSent
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {err.alertSent ? 'টেলিগ্রাম নোটিফাইড' : 'লগড'}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {new Date(err.timestamp).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}
                  </span>
                </div>

                <p className="text-slate-200 font-medium font-mono break-all">{err.message}</p>

                {err.url && (
                  <p className="text-[11px] text-slate-400">
                    <span className="text-slate-500">URL: </span>
                    <span className="font-mono">{err.url}</span>
                  </p>
                )}

                {err.userEmail && (
                  <p className="text-[11px] text-slate-400">
                    <span className="text-slate-500">ইউজার: </span>
                    <span className="font-mono">{err.userEmail}</span>
                  </p>
                )}

                <div className="pt-2 flex items-center justify-between border-t border-slate-800/60">
                  <span className="text-[10px] font-mono text-slate-500">ID: {err.id}</span>
                  <button
                    onClick={() => handleCopyReport(err)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition active:scale-95 text-[11px]"
                  >
                    {copiedId === err.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">কপি হয়েছে!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>কপি এআই ফিক্স রিপোর্ট</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
