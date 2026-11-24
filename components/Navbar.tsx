import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { 
  ShieldCheck, 
  Wallet, 
  PlusCircle, 
  ArrowDownToLine, 
  Clock, 
  LayoutDashboard, 
  LogOut, 
  User as UserIcon,
  Globe,
  ChevronDown,
  Bell,
  CheckCheck,
  X,
  KeyRound,
  Send,
  Crown
} from 'lucide-react';

const LAST_VIEWED_ANN_KEY = 'captchapay_last_viewed_ann';

function getStoredLastViewedAnnId(): string {
  try {
    return window.localStorage.getItem(LAST_VIEWED_ANN_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredLastViewedAnnId(id: string): void {
  try {
    window.localStorage.setItem(LAST_VIEWED_ANN_KEY, id);
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenDeposit: () => void;
  onOpenRecharge: () => void;
  onOpenWithdraw: () => void;
  onOpenP2PTransfer: () => void;
  onOpenSecurityPin: () => void;
  onOpenTelegramAlerts: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenDeposit,
  onOpenRecharge,
  onOpenWithdraw,
  onOpenP2PTransfer,
  onOpenSecurityPin,
  onOpenTelegramAlerts,
}) => {
  const { user, isAdmin, logout, setIsLoginModalOpen, settings } = useAuth();
  const { lang, toggleLang } = useLanguage();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [lastViewedAnnId, setLastViewedAnnId] = useState<string>(() => getStoredLastViewedAnnId());
  const [sessionBaselineId, setSessionBaselineId] = useState<string>('');

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          onClick={() => setActiveTab('solve')}
          className="flex items-center gap-2.5 text-left group shrink-0 cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50 group-hover:scale-105 transition-transform">
            <span className="font-extrabold text-white text-lg">C</span>
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white group-hover:text-emerald-400 transition-colors whitespace-nowrap">
              CaptchaPay
            </span>
          </div>
        </button>

        {/* Zone 2: Navigation Links (Single-line, 4-5 concise links) */}
        <nav className="hidden md:flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                setActiveTab('solve');
              }
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'solve' && user
                ? 'bg-slate-800 text-emerald-400 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-900'
            }`}
          >
            ক্যাপচা পূরণ
          </button>

          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                setActiveTab('plans');
              }
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'plans' && user
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold'
                : 'text-amber-300 hover:text-amber-200 hover:bg-slate-900'
            }`}
          >
            <Crown className="w-4 h-4 text-amber-400" />
            <span>ডেইলি প্ল্যান</span>
          </button>

          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                onOpenDeposit();
              }
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-300 hover:text-pink-300 hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Wallet className="w-4 h-4 text-pink-400" />
            <span>ডিপোজিট</span>
          </button>

          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                onOpenRecharge();
              }
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-300 hover:text-emerald-300 hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 text-emerald-400" />
            <span>রিচার্জ</span>
          </button>

          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                onOpenWithdraw();
              }
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-slate-300 hover:text-cyan-300 hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
            <span>উইথড্র</span>
          </button>

          <button
            onClick={() => {
              if (!user) {
                setIsLoginModalOpen(true);
              } else {
                setActiveTab('history');
              }
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history' && user
                ? 'bg-slate-800 text-cyan-400 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>লেনদেন হিস্ট্রি</span>
          </button>

          {/* Admin Panel Tab - ONLY visible for verified administrator */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer border ${
                activeTab === 'admin'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-950'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 text-amber-400" />
              <span>অ্যাডমিন প্যানেল</span>
            </button>
          )}
        </nav>

        {/* Zone 3: 1 Primary Action Area */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Notification Bell Icon - Left of language toggle */}
          {(() => {
            const announcements = settings?.announcements || [];

            const getUnreadCount = (baselineId: string): number => {
              if (announcements.length === 0) return 0;
              if (!baselineId) return announcements.length;
              const idx = announcements.findIndex((a) => a.id === baselineId);
              return idx === -1 ? announcements.length : idx;
            };

            const unreadCount = getUnreadCount(lastViewedAnnId);
            const hasUnread = unreadCount > 0;
            const highlightCount = isNotifOpen
              ? Math.max(unreadCount, getUnreadCount(sessionBaselineId))
              : unreadCount;

            const markAllAsRead = () => {
              if (announcements.length > 0) {
                const latestId = announcements[0].id;
                setStoredLastViewedAnnId(latestId);
                setLastViewedAnnId(latestId);
              }
            };

            const handleToggleNotif = () => {
              if (!isNotifOpen) {
                setSessionBaselineId(lastViewedAnnId);
                if (announcements.length > 0) {
                  setStoredLastViewedAnnId(announcements[0].id);
                }
                setIsNotifOpen(true);
              } else {
                markAllAsRead();
                setIsNotifOpen(false);
              }
            };

            const handleCloseNotif = () => {
              markAllAsRead();
              setIsNotifOpen(false);
            };

            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={handleToggleNotif}
                  className={`p-2 transition-all relative rounded-xl cursor-pointer flex items-center justify-center border ${
                    hasUnread
                      ? 'bg-red-500/20 text-red-400 border-red-500 shadow-[0_0_16px_rgba(239,68,68,0.65)] ring-2 ring-red-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900 border-slate-800'
                  }`}
                  title="নোটিফিকেশন ও ঘোষণা"
                  aria-label="নোটিফিকেশন ও ঘোষণা"
                >
                  {hasUnread && (
                    <span className="absolute inset-0.5 rounded-lg bg-red-500/30 animate-pulse pointer-events-none" />
                  )}
                  <Bell
                    className={`w-4 h-4 relative z-10 transition-transform ${
                      hasUnread
                        ? 'text-red-400 fill-red-500/40 animate-bounce'
                        : 'text-emerald-400'
                    }`}
                  />
                  {hasUnread && (
                    <span className="absolute -top-1.5 -right-1.5 z-20 flex items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-red-500 opacity-90" />
                      <span className="relative inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-[9px] font-extrabold text-white shadow-[0_0_8px_#ef4444] border border-red-300/60 tabular-nums">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    </span>
                  )}
                </button>

                {isNotifOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-slate-950/30 sm:bg-transparent"
                      onClick={handleCloseNotif}
                    />
                    <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:w-96 max-h-[82vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95">
                      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 mb-3 shrink-0">
                        <h3 className="text-xs font-bold text-white flex items-center gap-1.5 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${highlightCount > 0 ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                          <span className="truncate">নোটিফিকেশন ও ঘোষণা</span>
                        </h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {highlightCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                markAllAsRead();
                                setSessionBaselineId(announcements[0]?.id || '');
                              }}
                              className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/50 hover:bg-red-500/30 flex items-center gap-1 cursor-pointer transition-colors"
                              title="সব নোটিফিকেশন পড়া হয়েছে হিসেবে চিহ্নিত করুন"
                            >
                              <CheckCheck className="w-3 h-3" />
                              <span>নতুন ({highlightCount})</span>
                            </button>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300">
                              সকল আপডেট
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={handleCloseNotif}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                            aria-label="বন্ধ করুন"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {settings?.notice?.trim() && (
                        <div className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed whitespace-pre-wrap break-words shrink-0">
                          <span className="font-bold text-amber-400">জরুরি নোটিশ: </span>
                          {settings.notice}
                        </div>
                      )}

                      <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                        {announcements.length > 0 ? (
                          announcements.map((ann, idx) => {
                            const isNewItem = idx < highlightCount;
                            return (
                              <div
                                key={ann.id || idx}
                                className={`p-3 rounded-xl border transition-colors ${
                                  isNewItem
                                    ? 'bg-red-950/35 border-red-500/60 shadow-inner shadow-red-950/50'
                                    : 'bg-slate-950 border-slate-800/80'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                  <div className="text-xs font-bold text-white flex items-start gap-2 min-w-0">
                                    <span
                                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                        isNewItem ? 'bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]' : 'bg-emerald-400'
                                      }`}
                                    />
                                    <span className="break-words">{ann.title || 'অ্যাডমিন ঘোষণা'}</span>
                                  </div>
                                  {isNewItem && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500 text-white shrink-0">
                                      নতুন
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words pl-4">
                                  {ann.body || ann.title}
                                </div>
                                {ann.createdAt && (
                                  <div className="text-[10px] text-slate-500 mt-2 pl-4">
                                    {ann.createdAt}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                            <div className="text-xs font-bold text-white mb-1 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                              <span>স্বাগত CaptchaPay-তে!</span>
                            </div>
                            <div className="text-xs text-slate-300 leading-relaxed">
                              সঠিক নিয়মে ক্যাপচা পূরণ করুন এবং ভিডিও অ্যাড দেখে প্রতিদিন আনলিমিটেড আয় করুন। বিকাশ, নগদ ও রকেটে দ্রুত পেমেন্ট দেওয়া হয়।
                            </div>
                            <div className="text-[10px] text-slate-500 mt-2">অফিশিয়াল আপডেট • ২৪/৭ চালু</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Language Toggle */}
          <button
            onClick={toggleLang}
            className="p-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-colors flex items-center gap-1"
            title="Toggle Language (বাংলা / English)"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'BN' : 'EN'}</span>
          </button>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 p-1.5 pr-3 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer group"
              >
                <img
                  src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`}
                  alt={user.name}
                  className="w-7 h-7 rounded-full object-cover border border-slate-700"
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold font-mono text-emerald-400 tabular-nums">
                    ৳{user.balance.toFixed(2)}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
                </div>
              </button>

              {/* Profile Menu Dropdown */}
              {isProfileOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsProfileOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95">
                    <div className="p-2 border-b border-slate-800 mb-2">
                      <div className="flex items-center justify-between mb-1 gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">{user.name}</span>
                        {isAdmin ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            ADMIN
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            USER
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">{user.email}</div>
                    </div>

                    <div className="px-2 py-1.5 bg-slate-950 rounded-xl mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Wallet className="w-4 h-4 text-emerald-400" />
                        <span>ব্যালেন্স:</span>
                      </div>
                      <span className="text-sm font-bold font-mono text-emerald-400 tabular-nums">
                        ৳{user.balance.toFixed(2)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setActiveTab('admin');
                            setIsProfileOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4 text-amber-400" />
                          <span>অ্যাডমিন ড্যাশবোর্ড</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setActiveTab('plans');
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Crown className="w-4 h-4 text-amber-400" />
                        <span>ডেইলি ইনকাম প্ল্যান</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveTab('history');
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Clock className="w-4 h-4 text-cyan-400" />
                        <span>লেনদেন হিস্ট্রি</span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenSecurityPin();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/10 rounded-lg flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 text-amber-400" />
                          <span>উইথড্র সিকিউরিটি পিন</span>
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            user.hasWithdrawPin
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          {user.hasWithdrawPin ? 'সক্রিয়' : 'সেট করুন'}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenTelegramAlerts();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/10 rounded-lg flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Send className="w-4 h-4 text-sky-400" />
                          <span>টেলিগ্রাম লাইভ রিসিট</span>
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            user.telegramChatId
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          }`}
                        >
                          {user.telegramChatId ? 'সক্রিয়' : 'যুক্ত করুন'}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          setIsLoginModalOpen(true);
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <UserIcon className="w-4 h-4 text-slate-400" />
                        <span>অ্যাকাউন্ট পরিবর্তন করুন</span>
                      </button>

                      <button
                        onClick={() => {
                          logout();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-lg flex items-center gap-2 cursor-pointer mb-1 border-b border-slate-800"
                      >
                        <LogOut className="w-4 h-4 text-rose-400" />
                        <span>লগআউট</span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenDeposit();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-pink-400 hover:bg-pink-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Wallet className="w-4 h-4 text-pink-400" />
                        <span>ডিপোজিট (Deposit)</span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenRecharge();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <PlusCircle className="w-4 h-4 text-emerald-400" />
                        <span>রিচার্জ (Recharge)</span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenWithdraw();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
                        <span>উইথড্র (Withdraw)</span>
                      </button>

                      <button
                        onClick={() => {
                          onOpenP2PTransfer();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-indigo-400 hover:bg-indigo-500/10 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Send className="w-4 h-4 text-indigo-400" />
                        <span>P2P ব্যালেন্স ট্রান্সফার</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow-md shadow-emerald-950 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>গুগল দিয়ে লগইন</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Bar (visible on phones & small screens) */}
      {user && (
        <div className="md:hidden border-t border-slate-800/80 bg-slate-950/95 px-2 py-2">
          <div className="flex items-center justify-around gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('solve')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'solve'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              ক্যাপচা পূরণ
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plans')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer transition-colors ${
                activeTab === 'plans'
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                  : 'text-amber-300 hover:bg-slate-900'
              }`}
            >
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>প্ল্যান</span>
            </button>
            <button
              type="button"
              onClick={onOpenRecharge}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 hover:bg-slate-900 whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>রিচার্জ</span>
            </button>
            <button
              type="button"
              onClick={onOpenWithdraw}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 hover:bg-slate-900 whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>উইথড্র</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer transition-colors ${
                activeTab === 'history'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>হিস্ট্রি</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer border ${
                  activeTab === 'admin'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>অ্যাডমিন</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
