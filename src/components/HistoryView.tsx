import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToUserTransactions, subscribeToUserAdLogs, subscribeToUserP2PTransfers } from '../lib/dbService';
import { RechargeRequest, WithdrawalRequest, AdWatchLog, P2PTransfer, RequestStatus } from '../types';
import { BrandLogo } from './BrandLogo';
import {
  Clock,
  ArrowDownToLine,
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  ArrowLeft,
  Wallet,
  Printer,
  X,
  Send,
} from 'lucide-react';

export type HistorySubTab = 'deposits' | 'withdrawals' | 'recharges' | 'p2p' | 'ads';

interface HistoryViewProps {
  onBack?: () => void;
  initialTab?: HistorySubTab;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onBack, initialTab = 'deposits' }) => {
  const { user, settings } = useAuth();
  const [activeTab, setActiveTab] = useState<HistorySubTab>(initialTab);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [recharges, setRecharges] = useState<RechargeRequest[]>([]);
  const [p2pTransfers, setP2pTransfers] = useState<P2PTransfer[]>([]);
  const [adLogs, setAdLogs] = useState<AdWatchLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all');
  const [selectedReceipt, setSelectedReceipt] = useState<{
    type: 'withdrawal' | 'deposit' | 'recharge';
    item: WithdrawalRequest | RechargeRequest;
  } | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!user?.id) {
      setWithdrawals([]);
      setRecharges([]);
      setP2pTransfers([]);
      setAdLogs([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubTx = subscribeToUserTransactions(user.id, data => {
      setWithdrawals(data.withdrawals);
      setRecharges(data.recharges);
      setIsLoading(false);
    });
    const unsubAds = subscribeToUserAdLogs(user.id, logs => {
      setAdLogs(logs);
    });
    const unsubP2p = subscribeToUserP2PTransfers(user.id, transfers => {
      setP2pTransfers(transfers);
    });
    return () => {
      unsubTx();
      unsubAds();
      unsubP2p();
    };
  }, [user?.id]);

  // Strictly separate Wallet Deposits from Mobile Recharges
  const deposits = useMemo(
    () => recharges.filter(r => r.method !== 'Mobile Recharge'),
    [recharges]
  );

  const mobileRecharges = useMemo(
    () => recharges.filter(r => r.method === 'Mobile Recharge'),
    [recharges]
  );

  const approvedDepositsTotal = useMemo(
    () =>
      deposits
        .filter(d => d.status === 'approved')
        .reduce((sum, d) => sum + d.amount, 0),
    [deposits]
  );

  const approvedMobileRechargesTotal = useMemo(
    () =>
      mobileRecharges
        .filter(r => r.status === 'approved')
        .reduce((sum, r) => sum + r.amount, 0),
    [mobileRecharges]
  );

  const getPaymentMethodLogo = (methodName: string): string | undefined => {
    const m = (methodName || '').toLowerCase();
    const raw = settings?.paymentNumbers as Record<string, any> | undefined;
    if (!raw) return undefined;
    if (m.includes('bkash') || m.includes('বিকাশ')) return typeof raw.bkash === 'object' ? raw.bkash?.logoUrl : undefined;
    if (m.includes('nagad') || m.includes('নগদ')) return typeof raw.nagad === 'object' ? raw.nagad?.logoUrl : undefined;
    if (m.includes('rocket') || m.includes('রকেট')) return typeof raw.rocket === 'object' ? raw.rocket?.logoUrl : undefined;
    if (m.includes('binance') || m.includes('usdt')) return typeof raw.binance === 'object' ? raw.binance?.logoUrl : undefined;
    return undefined;
  };

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>অনুমোদিত (Approved)</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" />
            <span>বাতিল (Rejected)</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>অপেক্ষমান (Pending)</span>
          </span>
        );
    }
  };

  const filteredDeposits = deposits.filter(
    d => statusFilter === 'all' || d.status === statusFilter
  );

  const filteredWithdrawals = withdrawals.filter(
    w => statusFilter === 'all' || w.status === statusFilter
  );

  const filteredMobileRecharges = mobileRecharges.filter(
    r => statusFilter === 'all' || r.status === statusFilter
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            <span>লেনদেন ও আয়ের হিস্ট্রি</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            আপনার সকল ডিপোজিট, উত্তোলন, মোবাইল রিচার্জ এবং ভিডিও অ্যাড দেখার রিয়েল-টাইম বিবরণী
          </p>
        </div>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>ক্যাপচা ও হোমপেজে ফিরুন</span>
          </button>
        )}
      </div>

      {/* User Account Summary Cards */}
      {user && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              <span>বর্তমান ব্যালেন্স</span>
            </div>
            <div className="text-lg font-extrabold font-mono text-emerald-400 mt-1 tabular-nums">
              ৳{user.balance.toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="text-[11px] text-slate-400">সর্বমোট আয়</div>
            <div className="text-lg font-extrabold font-mono text-white mt-1 tabular-nums">
              ৳{user.totalEarned.toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 border border-pink-500/20">
            <div className="text-[11px] text-pink-300/80">মোট ডিপোজিট</div>
            <div className="text-lg font-extrabold font-mono text-pink-400 mt-1 tabular-nums">
              ৳{approvedDepositsTotal.toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="text-[11px] text-slate-400">মোট উইথড্র</div>
            <div className="text-lg font-extrabold font-mono text-cyan-400 mt-1 tabular-nums">
              ৳{user.totalWithdrawn.toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 col-span-2 sm:col-span-1">
            <div className="text-[11px] text-slate-400">মোট মোবাইল রিচার্জ</div>
            <div className="text-lg font-extrabold font-mono text-amber-300 mt-1 tabular-nums">
              ৳{approvedMobileRechargesTotal.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Tabs and Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1.5 bg-slate-900 rounded-2xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('deposits')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'deposits'
                ? 'bg-pink-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>ডিপোজিট ({deposits.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('withdrawals')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'withdrawals'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>উইথড্র ({withdrawals.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('recharges')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'recharges'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>মোবাইল রিচার্জ ({mobileRecharges.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('p2p')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'p2p'
                ? 'bg-indigo-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>P2P ট্রান্সফার ({p2pTransfers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ads')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'ads'
                ? 'bg-purple-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <PlayCircle className="w-3.5 h-3.5" />
            <span>ভিডিও অ্যাড ({adLogs.length})</span>
          </button>
        </div>

        {/* Status filter for deposits, withdrawals & mobile recharges */}
        {(activeTab === 'deposits' || activeTab === 'withdrawals' || activeTab === 'recharges') && (
          <div className="flex items-center gap-1 px-2">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(filter => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                  statusFilter === filter
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {filter === 'all' ? 'সকল' : filter === 'pending' ? 'পেন্ডিং' : filter === 'approved' ? 'অনুমোদিত' : 'বাতিল'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Deposits Table (ONLY Deposit requests: method !== 'Mobile Recharge') */}
      {activeTab === 'deposits' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 text-sm">হিস্ট্রি লোড হচ্ছে...</div>
          ) : filteredDeposits.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              কোনো ডিপোজিট রেকর্ড পাওয়া যায়নি।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">আইডি ও তারিখ</th>
                    <th className="py-3 px-4">পেমেন্ট মাধ্যম</th>
                    <th className="py-3 px-4">সেন্ডার নাম্বার / একাউন্ট</th>
                    <th className="py-3 px-4">ট্রানজেকশন আইডি (TrxID)</th>
                    <th className="py-3 px-4 text-right">পরিমাণ (৳)</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4">মন্তব্য</th>
                    <th className="py-3 px-4 text-center">রসিদ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredDeposits.map(item => {
                    const logoUrl = getPaymentMethodLogo(item.method);
                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4 font-mono">
                          <span className="font-bold text-white block">{item.id}</span>
                          <span className="text-[11px] text-slate-500">
                            {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-pink-300">
                          <div className="flex items-center gap-2">
                            <BrandLogo
                              src={logoUrl}
                              alt={item.method}
                              className="w-6 h-6 rounded"
                              imgClassName="w-full h-full object-contain"
                              fallback={null}
                            />
                            <span>{item.method}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">
                          {item.senderNumber}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-amber-400">
                          {item.trxId}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm tabular-nums">
                          ৳{item.amount.toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {getStatusBadge(item.status)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                          {item.adminNote || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {item.status === 'approved' ? (
                            <button
                              type="button"
                              onClick={() => setSelectedReceipt({ type: 'deposit', item })}
                              className="px-2.5 py-1 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 border border-pink-500/30 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                              title="ডিজিটাল রসিদ দেখুন"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>রসিদ</span>
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Withdrawals Table */}
      {activeTab === 'withdrawals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 text-sm">হিস্ট্রি লোড হচ্ছে...</div>
          ) : filteredWithdrawals.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              কোনো উইথড্র রেকর্ড পাওয়া যায়নি।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">আইডি ও তারিখ</th>
                    <th className="py-3 px-4">মাধ্যম</th>
                    <th className="py-3 px-4">একাউন্ট নাম্বার</th>
                    <th className="py-3 px-4 text-right">পরিমাণ (৳)</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4">নোট / TrxID</th>
                    <th className="py-3 px-4 text-center">রসিদ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredWithdrawals.map(item => (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono">
                        <span className="font-bold text-white block">{item.id}</span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-cyan-300">
                        <div className="flex items-center gap-2">
                          <BrandLogo
                            src={getPaymentMethodLogo(item.method)}
                            alt={item.method}
                            className="w-6 h-6 rounded"
                            imgClassName="w-full h-full object-contain"
                            fallback={null}
                          />
                          <span>{item.method} ({item.accountType})</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {item.accountNumber}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm tabular-nums">
                        ৳{item.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {getStatusBadge(item.status)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {item.payoutTrxId && (
                          <div className="font-mono text-emerald-400 font-semibold mb-0.5">
                            TrxID: {item.payoutTrxId}
                          </div>
                        )}
                        <span className="text-[11px]">{item.adminNote || '—'}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {item.status === 'approved' ? (
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt({ type: 'withdrawal', item })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                            title="ডিজিটাল রসিদ দেখুন"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>রসিদ</span>
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Mobile Recharges Table (ONLY Mobile Recharge requests: method === 'Mobile Recharge') */}
      {activeTab === 'recharges' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 text-sm">হিস্ট্রি লোড হচ্ছে...</div>
          ) : filteredMobileRecharges.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              কোনো মোবাইল রিচার্জ রেকর্ড পাওয়া যায়নি।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">আইডি ও তারিখ</th>
                    <th className="py-3 px-4">সিম অপারেটর</th>
                    <th className="py-3 px-4">মোবাইল নাম্বার</th>
                    <th className="py-3 px-4">রেফারেন্স আইডি</th>
                    <th className="py-3 px-4 text-right">পরিমাণ (৳)</th>
                    <th className="py-3 px-4 text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4">মন্তব্য</th>
                    <th className="py-3 px-4 text-center">রসিদ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredMobileRecharges.map(item => (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono">
                        <span className="font-bold text-white block">{item.id}</span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-emerald-300">
                        {(() => {
                          const opName = item.senderSim || item.method;
                          const opLogo = settings?.operatorLogos?.[opName];
                          return (
                            <div className="flex items-center gap-2">
                              <BrandLogo
                                src={opLogo}
                                alt={opName}
                                className="w-6 h-6 rounded"
                                imgClassName="w-full h-full object-contain"
                                fallback={null}
                              />
                              <span>{opName}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        <div>{item.senderNumber}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-amber-400">
                        {item.trxId}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm tabular-nums">
                        ৳{item.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {getStatusBadge(item.status)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {item.adminNote || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {item.status === 'approved' ? (
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt({ type: 'recharge', item })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                            title="ডিজিটাল রসিদ দেখুন"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>রসিদ</span>
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* P2P Transfers Table */}
      {activeTab === 'p2p' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {p2pTransfers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                এখনো কোনো P2P ব্যালেন্স ট্রান্সফার রেকর্ড নেই।
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">আইডি ও তারিখ</th>
                      <th className="py-3 px-4">ধরন</th>
                      <th className="py-3 px-4">প্রাপক / প্রেরক</th>
                      <th className="py-3 px-4 text-right">পরিমাণ ও ফি (৳)</th>
                      <th className="py-3 px-4">নোট</th>
                      <th className="py-3 px-4 text-center">অবস্থা / অ্যাকশন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {p2pTransfers.map(t => {
                      const isOutgoing = t.senderId === user?.id;
                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono">
                            <span className="font-bold text-white block">{t.id}</span>
                            <span className="text-[11px] text-slate-500">
                              {new Date(t.createdAt).toLocaleDateString()} {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            {isOutgoing ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold text-[11px]">
                                পাঠানো (Sent)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold text-[11px]">
                                প্রাপ্ত (Received)
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">
                              {isOutgoing ? t.recipientName : t.senderName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {isOutgoing ? t.recipientEmail : t.senderEmail}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                            {isOutgoing ? (
                              <>
                                <div className="font-bold text-rose-400 text-sm">-৳{t.totalDeducted.toFixed(2)}</div>
                                <div className="text-[10px] text-slate-500">
                                  মূল ৳{t.amount.toFixed(2)} + ফি ৳{t.fee.toFixed(2)}
                                </div>
                              </>
                            ) : (
                              <div className="font-bold text-emerald-400 text-sm">+৳{t.amount.toFixed(2)}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                            {t.note || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {t.status === 'claimed' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>ব্যালেন্সে যোগ হয়েছে</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>স্বয়ংক্রিয়ভাবে যোগ হচ্ছে...</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video Ad Watch History Table */}
      {activeTab === 'ads' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {adLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              এখনো কোনো ভিডিও অ্যাড দেখার রেকর্ড নেই।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">ভিডিও ও তারিখ</th>
                    <th className="py-3 px-4 text-center">দেখার সময়</th>
                    <th className="py-3 px-4 text-right">আয় (৳)</th>
                    <th className="py-3 px-4 text-center">অবস্থা</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {adLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{log.adTitle}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                        {log.watchedSeconds}s / {log.requiredSeconds}s
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-sm tabular-nums">
                        {log.status === 'completed' ? (
                          <span className="text-emerald-400">+৳{log.earned.toFixed(2)}</span>
                        ) : (
                          <span className="text-rose-400">৳0.00</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {log.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>সম্পন্ন</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>অসম্পূর্ণ (টাকা যোগ হয়নি)</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Digital Payout / Deposit Receipt Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setSelectedReceipt(null)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-2 pb-4 border-b border-slate-800">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-lg">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">CaptchaPay Bangladesh</h3>
              <p className="text-xs text-slate-400">অফিশিয়াল ডিজিটাল লেনদেন ও পেমেন্ট রসিদ</p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">লেনদেন টাইপ:</span>
                <span className="font-bold text-white uppercase">
                  {selectedReceipt.type === 'withdrawal'
                    ? 'উইথড্র রিকোয়েস্ট'
                    : selectedReceipt.type === 'deposit'
                    ? 'ওয়ালেট ডিপোজিট'
                    : 'মোবাইল রিচার্জ'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">রিকোয়েস্ট আইডি (ID):</span>
                <span className="font-mono text-cyan-400 font-bold">{selectedReceipt.item.id}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">ব্যবহারকারী:</span>
                <span className="font-medium text-white">{selectedReceipt.item.userName} ({selectedReceipt.item.userEmail})</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">পেমেন্ট মাধ্যম:</span>
                <span className="font-semibold text-emerald-300">
                  {'senderSim' in selectedReceipt.item && selectedReceipt.item.senderSim
                    ? `${selectedReceipt.item.method} (${selectedReceipt.item.senderSim})`
                    : selectedReceipt.item.method}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">অ্যাকাউন্ট / নাম্বার:</span>
                <span className="font-mono text-white">
                  {'accountNumber' in selectedReceipt.item
                    ? selectedReceipt.item.accountNumber
                    : selectedReceipt.item.senderNumber}
                </span>
              </div>
              {'trxId' in selectedReceipt.item && selectedReceipt.item.trxId && (
                <div className="flex justify-between py-2 border-b border-slate-800/60">
                  <span className="text-slate-400">
                    {selectedReceipt.type === 'deposit' ? 'পেমেন্ট TrxID:' : 'রেফারেন্স আইডি:'}
                  </span>
                  <span className="font-mono text-amber-400 font-bold">{selectedReceipt.item.trxId}</span>
                </div>
              )}
              {'payoutTrxId' in selectedReceipt.item && selectedReceipt.item.payoutTrxId && (
                <div className="flex justify-between py-2 border-b border-slate-800/60">
                  <span className="text-slate-400">অ্যাডমিন পেমেন্ট TrxID:</span>
                  <span className="font-mono text-amber-400 font-bold">{selectedReceipt.item.payoutTrxId}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">পরিমাণ:</span>
                <span className="font-mono font-extrabold text-emerald-400 text-base">৳{selectedReceipt.item.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">স্ট্যাটাস:</span>
                <span className="font-bold text-emerald-400">অনুমোদিত (Approved)</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">তারিখ ও সময়:</span>
                <span className="text-slate-300">{new Date(selectedReceipt.item.createdAt).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-950"
              >
                <Printer className="w-4 h-4" />
                <span>রসিদ প্রিন্ট / সেভ করুন</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
