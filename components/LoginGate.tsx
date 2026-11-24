import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowRight, CheckCircle2, Lock } from 'lucide-react';

export const LoginGate: React.FC = () => {
  const { loginWithGoogle, isLoading } = useAuth();

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="rounded-3xl bg-slate-900 border border-slate-800 p-8 sm:p-12 shadow-2xl relative overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-center gap-10">
          {/* Left Content */}
          <div className="flex-1 space-y-5 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>নিরাপদ ক্লাউড একাউন্টে প্রবেশ করতে লগইন আবশ্যক</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              ক্যাপচা সমাধান ও আয় প্ল্যাটফর্মে আপনাকে স্বাগতম
            </h1>

            <p className="text-sm text-slate-300 leading-relaxed">
              ওয়েবসাইটের ড্যাশবোর্ডে প্রবেশ করতে, ক্যাপচা ও ভিডিও অ্যাড থেকে টাকা আয় করতে এবং বিকাশ/নগদে উইথড্র নিতে আপনার আসল <strong className="text-white">গুগল অ্যাকাউন্ট (Gmail)</strong> দিয়ে সাইন ইন করুন। আপনার ব্যালেন্স ও সকল ডেটা স্থায়ী ক্লাউড ডেটাবেসে ১০০% সুরক্ষিত থাকে।
            </p>

            {/* Google Sign-in Main Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start">
              <button
                type="button"
                onClick={() => loginWithGoogle()}
                disabled={isLoading}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-900 font-bold text-sm shadow-xl flex items-center justify-center gap-3 transition-all cursor-pointer group hover:scale-[1.02]"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{isLoading ? 'সাইন ইন হচ্ছে...' : 'গুগল দিয়ে সাইন ইন করুন'}</span>
                <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>

          {/* Right Feature Summary */}
          <div className="w-full lg:w-80 shrink-0">
            <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider pb-1 border-b border-slate-800">
                প্ল্যাটফর্ম সুবিধাসমূহ
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>টেক্সট, ম্যাথ ও স্লাইডার ক্যাপচা সমাধান</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>বিকাশ ও নগদে সরাসরি টাকা উইথড্র</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>স্থায়ী ক্লাউড ডেটাবেসে ১০০% সুরক্ষিত ব্যালেন্স</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>রিয়েল-টাইম অটোমেটিক সিঙ্ক</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
