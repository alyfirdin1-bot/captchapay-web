import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Navbar } from './components/Navbar';
import { CaptchaSolver } from './components/CaptchaSolver';
import { VideoAdSection } from './components/VideoAdSection';

import type { HistorySubTab } from './components/HistoryView';
const HistoryView = lazy(() => import('./components/HistoryView').then(m => ({ default: m.HistoryView })));
const PlansPage = lazy(() => import('./components/PlansPage').then(m => ({ default: m.PlansPage })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
import { getDefaultEarningPlans } from './lib/defaults';
import { BrandLogo } from './components/BrandLogo';
import { RechargeModal } from './components/RechargeModal';
import { DepositModal } from './components/DepositModal';
import { WithdrawModal } from './components/WithdrawModal';
import { P2PTransferModal } from './components/P2PTransferModal';
import { SecurityPinModal } from './components/SecurityPinModal';
import { TelegramAlertModal } from './components/TelegramAlertModal';
import { GoogleSignInModal } from './components/GoogleSignInModal';
import { LoginGate } from './components/LoginGate';
import { ToastContainer } from './components/ToastContainer';
import { 
  ShieldCheck, 
  Coins, 
  ArrowRight, 
  CheckCircle2, 
  PlusCircle, 
  ArrowDownToLine, 
  Crown, 
  Clock, 
  AlertCircle,
  HelpCircle,
  Sparkles,
  PlayCircle,
  Lock,
  LogOut,
  Send,
  BellRing,
  Wallet
} from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'অপ্রত্যাশিত ত্রুটি ঘটেছে।',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-3xl bg-slate-900 border border-rose-500/40 p-8 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white">সাময়িক সংযোগ সমস্যা হয়েছে</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              অনুগ্রহ করে পেজটি রিলোড করে আবার চেষ্টা করুন। আপনার সকল তথ্য নিরাপদ রয়েছে।
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
            >
              পেজ রিলোড করুন
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppContent: React.FC = () => {
  const { user, isAdmin, settings, logout, setIsLoginModalOpen } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'solve' | 'plans' | 'history' | 'admin'>('solve');
  const [historySubTab, setHistorySubTab] = useState<HistorySubTab>('deposits');
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isP2POpen, setIsP2POpen] = useState(false);
  const [isSecurityPinOpen, setIsSecurityPinOpen] = useState(false);
  const [isTelegramOpen, setIsTelegramOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin && activeTab === 'admin') {
      setActiveTab('solve');
    }
  }, [isAdmin, activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Notice Ticker / Banner */}
      {settings?.notice && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-b border-emerald-500/20 py-2 px-4 text-xs text-center text-emerald-300 flex items-center justify-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate max-w-4xl">{settings.notice}</span>
        </div>
      )}

      {/* Admin Quick Switch Alert Bar (When logged in as Admin) */}
      {isAdmin && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 py-2 px-4 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>
              আপনি সুপার অ্যাডমিন (<strong className="font-mono text-white">{user?.email}</strong>) হিসেবে সাইন ইন আছেন।
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab(activeTab === 'admin' ? 'solve' : 'admin')}
              className="px-2.5 py-0.5 rounded-md bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-colors text-[11px] cursor-pointer"
            >
              {activeTab === 'admin' ? 'ক্যাপচা সলভার ভিউ' : 'অ্যাডমিন ড্যাশবোর্ড খুলুন'}
            </button>
          </div>
        </div>
      )}

      {/* Top Navbar adhering to 3-zone contract */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab: string) => setActiveTab(tab as any)}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenRecharge={() => setIsRechargeOpen(true)}
        onOpenWithdraw={() => setIsWithdrawOpen(true)}
        onOpenP2PTransfer={() => setIsP2POpen(true)}
        onOpenSecurityPin={() => setIsSecurityPinOpen(true)}
        onOpenTelegramAlerts={() => setIsTelegramOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {!user ? (
          <LoginGate />
        ) : user.isBanned && !isAdmin ? (
          <div className="max-w-lg mx-auto px-4 py-20 text-center">
            <div className="p-8 rounded-3xl bg-slate-900 border border-rose-500/40 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
                <Lock className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-extrabold text-white">আপনার অ্যাকাউন্টটি ব্যান (স্থগিত) করা হয়েছে!</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  অ্যাডমিন দ্বারা আপনার অ্যাকাউন্ট (<span className="font-mono text-rose-300">{user.email}</span>) সাময়িক বা স্থায়ীভাবে বন্ধ করা হয়েছে। বিস্তারিত জানতে অ্যাডমিনের সাথে যোগাযোগ করুন।
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
                <span className="text-slate-400">সংরক্ষিত ব্যালেন্স:</span>
                <span className="font-mono font-bold text-emerald-400">৳{user.balance.toFixed(2)}</span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>লগআউট করে অন্য অ্যাকাউন্টে প্রবেশ করুন</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* TAB 1: CAPTCHA SOLVER */}
            {activeTab === 'solve' && (
              <div>
                {/* Hero Banner Section */}
                <section className="relative overflow-hidden pt-8 pb-4">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6">
                    <div className="rounded-3xl bg-slate-900/60 border border-slate-800 p-6 sm:p-8 lg:p-10 relative overflow-hidden flex flex-col lg:flex-row items-center justify-between gap-8">
                      {/* Text zone */}
                      <div className="max-w-xl space-y-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                          <span>স্বয়ংক্রিয় মাইক্রোটাস্ক আর্নিং প্ল্যাটফর্ম</span>
                          <span aria-hidden="true">·</span>
                          <span>বিকাশ ও নগদ উইথড্র</span>
                        </div>

                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                          ক্যাপচা পূরণ করে ঘরে বসেই আয় করুন
                        </h1>

                        <p className="text-sm text-slate-400 leading-relaxed">
                          সহজ টেক্সট, ম্যাথ ও স্লাইডার ক্যাপচা সমাধান করে প্রতিদিন টাকা আয় করুন। কোনো জটিলতা নেই, সর্বনিম্ন ৳১০০ হলেই ইনস্ট্যান্ট উইথড্র রিকোয়েস্ট পাঠান।
                        </p>

                        <div className="flex flex-wrap items-center gap-3 pt-2">
                          <button
                            onClick={() => {
                              const el = document.getElementById('solver-area');
                              if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-emerald-950 flex items-center gap-2 cursor-pointer"
                          >
                            <span>ক্যাপচা শুরু করুন</span>
                            <ArrowRight className="w-4 h-4 text-slate-950" />
                          </button>

                          {settings?.adConfig?.enabled !== false && (
                            <button
                              onClick={() => {
                                const el = document.getElementById('ad-earn-area');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className="px-4 py-2.5 bg-purple-600/25 hover:bg-purple-600/40 text-purple-200 font-bold rounded-xl text-xs border border-purple-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <PlayCircle className="w-4 h-4 text-purple-300" />
                              <span>অ্যাড দেখে ইনকাম</span>
                            </button>
                          )}

                          <button
                            onClick={() => setActiveTab('plans')}
                            className="px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 font-bold rounded-xl text-xs border border-amber-500/45 transition-colors flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-950/30"
                          >
                            <Crown className="w-4 h-4 text-amber-400" />
                            <span>ডেইলি ইনকাম প্ল্যান</span>
                          </button>

                          <button
                            onClick={() => setIsDepositOpen(true)}
                            className="px-4 py-2.5 bg-pink-600/20 hover:bg-pink-600/35 text-pink-200 font-bold rounded-xl text-xs border border-pink-500/45 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <Wallet className="w-4 h-4 text-pink-400" />
                            <span>ফান্ড ডিপোজিট</span>
                          </button>

                          <button
                            onClick={() => setIsRechargeOpen(true)}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <PlusCircle className="w-4 h-4 text-emerald-400" />
                            <span>রিচার্জ অপশন</span>
                          </button>

                          <button
                            onClick={() => setIsWithdrawOpen(true)}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
                            <span>উইথড্র সিস্টেম</span>
                          </button>

                          <button
                            onClick={() => setIsP2POpen(true)}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <Send className="w-4 h-4 text-indigo-400" />
                            <span>P2P ট্রান্সফার</span>
                          </button>

                          <button
                            onClick={() => setIsTelegramOpen(true)}
                            className={`px-4 py-2.5 font-semibold rounded-xl text-xs border transition-colors flex items-center gap-1.5 cursor-pointer ${
                              user.telegramChatId
                                ? 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border-sky-500/40'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                            }`}
                          >
                            <BellRing className="w-4 h-4 text-sky-400" />
                            <span>টেলিগ্রাম রিসিট</span>
                            {user.telegramChatId && (
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            )}
                          </button>

                          <button
                            onClick={() => setActiveTab('history')}
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <Clock className="w-4 h-4 text-amber-400" />
                            <span>লেনদেন হিস্ট্রি</span>
                          </button>
                        </div>
                      </div>

                      {/* Visual Image slot */}
                      <div className="w-full lg:max-w-md relative shrink-0">
                        <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
                          <img
                            src="/src/assets/images/captcha_hero_banner_1794912114794.jpg"
                            alt="CaptchaPay Platform Hero"
                            className="w-full h-auto object-cover rounded-2xl"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
                          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-slate-300">
                            <span className="font-semibold text-emerald-400">নিরাপদ ও দ্রুত পেমেন্ট</span>
                            <span className="font-mono text-slate-400">২৪/৭ এক্টিভ</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Captcha Solver Section */}
                <div id="solver-area">
                  <CaptchaSolver
                    onOpenRecharge={() => setIsRechargeOpen(true)}
                    onOpenWithdraw={() => setIsWithdrawOpen(true)}
                  />
                </div>

                {/* Video Ad Watch & Earn Section (Real-Time Controlled by Admin) */}
                <div id="ad-earn-area">
                  <VideoAdSection />
                </div>

                {/* Daily Earning Plans Preview Banner */}
                <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-2">
                  <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/35 border border-amber-500/35 p-6 sm:p-7 shadow-xl space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                          <Crown className="w-5 h-5" />
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-extrabold text-white">
                            ডেইলি ইনকাম প্ল্যান (৳৫০০ – ৳১,৫০০+)
                          </h2>
                          <p className="text-xs text-slate-400 mt-1">
                            যেকোনো একটি প্ল্যান কিনুন এবং প্রতিদিন ১ ক্লিকে ক্লেইম করে সরাসরি মূল ব্যালেন্সে আয় করুন।
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTab('plans')}
                        className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-950/50 shrink-0"
                      >
                        <span>প্ল্যান কিনুন ও ক্লেইম করুন</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      {(settings?.earningPlans && settings.earningPlans.length > 0
                        ? settings.earningPlans
                        : getDefaultEarningPlans()
                      )
                        .filter(p => p.enabled !== false)
                        .slice(0, 3)
                        .map(plan => (
                          <div
                            key={plan.id}
                            onClick={() => setActiveTab('plans')}
                            className="p-4 rounded-2xl bg-slate-950/85 border border-slate-800 hover:border-amber-500/50 transition-all cursor-pointer flex items-center justify-between gap-3"
                          >
                            <div>
                              <div className="text-xs font-bold text-white">{plan.name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                মেয়াদ: {plan.durationDays} দিন
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono font-extrabold text-amber-400 text-sm">
                                ৳{plan.price}
                              </div>
                              <div className="text-[11px] font-bold text-emerald-400">
                                +৳{plan.dailyIncome}/দিন
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 2: DAILY EARNING PLANS PAGE */}
            {activeTab === 'plans' && (
              <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-16 text-center text-xs text-slate-400">প্ল্যান পেজ লোড হচ্ছে...</div>}>
                <PlansPage
                  onBack={() => setActiveTab('solve')}
                  onOpenDeposit={() => setIsDepositOpen(true)}
                />
              </Suspense>
            )}

            {/* TAB 3: TRANSACTION HISTORY */}
            {activeTab === 'history' && (
              <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-16 text-center text-xs text-slate-400">লোড হচ্ছে...</div>}>
                <HistoryView initialTab={historySubTab} onBack={() => setActiveTab('solve')} />
              </Suspense>
            )}

            {/* TAB 3: ADMIN PANEL (Exclusively rendered when isAdmin is true) */}
            {activeTab === 'admin' && isAdmin && (
              <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-16 text-center text-xs text-slate-400">অ্যাডমিন প্যানেল লোড হচ্ছে...</div>}>
                <AdminPanel />
              </Suspense>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-10 px-4 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
              C
            </div>
            <div>
              <div className="text-sm font-bold text-white">CaptchaPay Bangladesh</div>
              <div className="text-xs text-slate-500">
                বিশ্বস্ত ক্যাপচা সমাধান ও দ্রুত মোবাইল ব্যাংকিং পেমেন্ট সিস্টেম
              </div>
            </div>
          </div>

          {/* Payment Gateways Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 text-xs text-slate-400">
            <span>সমর্থিত পেমেন্ট মাধ্যম:</span>
            {([
              { key: 'bkash', label: 'বিকাশ (bKash)', cls: 'text-pink-400' },
              { key: 'nagad', label: 'নগদ (Nagad)', cls: 'text-orange-400' },
              { key: 'rocket', label: 'রকেট (Rocket)', cls: 'text-purple-400' },
              { key: 'binance', label: 'USDT', cls: 'text-amber-400' },
            ] as const).map(gw => {
              const rawGw = (settings?.paymentNumbers as Record<string, any> | undefined)?.[gw.key];
              const logoUrl = typeof rawGw === 'object' && rawGw !== null ? rawGw.logoUrl : undefined;
              return (
                <span
                  key={gw.key}
                  className={`px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 font-bold inline-flex items-center gap-1.5 ${gw.cls}`}
                >
                  <BrandLogo
                    src={logoUrl}
                    alt={gw.label}
                    className="w-4 h-4 rounded-sm"
                    imgClassName="w-full h-full object-contain"
                    fallback={null}
                  />
                  <span>{gw.label}</span>
                </span>
              );
            })}
          </div>

          <div className="text-xs text-slate-500">
            © {new Date().getFullYear()} CaptchaPay. All rights reserved.
          </div>
        </div>
      </footer>

      {/* Modals */}
      <GoogleSignInModal />
      <RechargeModal
        isOpen={isRechargeOpen}
        onClose={() => setIsRechargeOpen(false)}
        onSuccess={() => {
          setHistorySubTab('recharges');
          setActiveTab('history');
        }}
        onOpenSecurityPin={() => setIsSecurityPinOpen(true)}
      />
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onSuccess={() => {
          setHistorySubTab('deposits');
          setActiveTab('history');
        }}
      />
      <WithdrawModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onSuccess={() => {
          setHistorySubTab('withdrawals');
          setActiveTab('history');
        }}
        onOpenSecurityPin={() => setIsSecurityPinOpen(true)}
      />
      <P2PTransferModal
        isOpen={isP2POpen}
        onClose={() => setIsP2POpen(false)}
        onSuccess={() => {
          setHistorySubTab('p2p');
          setActiveTab('history');
        }}
        onOpenSecurityPin={() => setIsSecurityPinOpen(true)}
      />
      <SecurityPinModal
        isOpen={isSecurityPinOpen}
        onClose={() => setIsSecurityPinOpen(false)}
      />
      <TelegramAlertModal
        isOpen={isTelegramOpen}
        onClose={() => setIsTelegramOpen(false)}
        onOpenAdminTelegram={() => setActiveTab('admin')}
      />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </LanguageProvider>
    </AppErrorBoundary>
  );
}
