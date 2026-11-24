import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { setOrUpdateWithdrawPinInFirestore, submitWithdrawalTransaction } from '../lib/dbService';
import { isValidFourDigitPin } from '../lib/pinSecurity';
import { PinCodeInput } from './PinCodeInput';
import { PaymentMethod } from '../types';
import { evaluateWithdrawalWindow } from '../lib/withdrawalSchedule';
import { BrandLogo } from './BrandLogo';
import { X, ArrowDownToLine, Wallet, AlertCircle, ArrowRight, ShieldCheck, Lock, KeyRound, Clock } from 'lucide-react';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenSecurityPin?: () => void;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onOpenSecurityPin,
}) => {
  const { user, settings, showToast, applyUser, setIsLoginModalOpen } = useAuth();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('bKash');
  const [accountType, setAccountType] = useState<'personal' | 'agent'>('personal');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('100');
  const [withdrawPin, setWithdrawPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);

  // Inline first-time PIN setup states
  const [setupPin, setSetupPin] = useState('');
  const [confirmSetupPin, setConfirmSetupPin] = useState('');
  const [setupError, setSetupError] = useState('');
  const [isSettingPin, setIsSettingPin] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) {
      setWithdrawPin('');
      setPinError('');
      setSetupPin('');
      setConfirmSetupPin('');
      setSetupError('');
      return;
    }
    setNowMs(Date.now());
    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(ticker);
  }, [isOpen]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  if (!isOpen) return null;

  const minWithdrawal = settings?.minWithdrawal || 100;
  const currentBalance = user?.balance || 0;
  const hasWithdrawPin = Boolean(user?.hasWithdrawPin);
  const windowStatus = evaluateWithdrawalWindow(settings?.withdrawalSchedule, nowMs);

  const handleWithdrawAll = () => {
    if (currentBalance >= minWithdrawal) {
      setAmount(Math.floor(currentBalance).toString());
    }
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError('');
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }
    if (!isValidFourDigitPin(setupPin)) {
      setSetupError('৪ সংখ্যার (০-৯) একটি সিকিউরিটি পিন লিখুন।');
      return;
    }
    if (setupPin !== confirmSetupPin) {
      setSetupError('পিন দুটি মেলেনি! অনুগ্রহ করে একই ৪টি সংখ্যা লিখুন।');
      return;
    }

    setIsSettingPin(true);
    try {
      const res = await setOrUpdateWithdrawPinInFirestore({
        uid: user.id,
        newPin: setupPin,
      });
      applyUser(res.user);
      setSetupPin('');
      setConfirmSetupPin('');
      showToast(res.message, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'সিকিউরিটি পিন সেট করা যায়নি';
      setSetupError(msg);
      showToast(msg, 'error');
    } finally {
      setIsSettingPin(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    if (!windowStatus.isOpen) {
      showToast(windowStatus.headline, 'error');
      return;
    }

    if (!hasWithdrawPin) {
      showToast('উইথড্র করার আগে ৪-ডিজিট সিকিউরিটি পিন সেট করুন।', 'error');
      return;
    }

    if (lockSeconds > 0) {
      const msg = `ভুল পিনের কারণে ${lockSeconds} সেকেন্ড অপেক্ষা করুন।`;
      setPinError(msg);
      showToast(msg, 'error');
      return;
    }

    if (!isValidFourDigitPin(withdrawPin)) {
      setPinError('আপনার ৪-ডিজিট সিকিউরিটি পিন দিন।');
      showToast('৪-ডিজিট সিকিউরিটি পিন প্রদান করুন', 'error');
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < minWithdrawal) {
      showToast(`সর্বনিম্ন উত্তোলন পরিমাণ ৳${minWithdrawal}`, 'error');
      return;
    }

    if (numAmount > currentBalance) {
      showToast('আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!', 'error');
      return;
    }

    if (!accountNumber.trim()) {
      showToast('একাউন্ট নাম্বার প্রদান করুন', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await submitWithdrawalTransaction({
        uid: user.id,
        amount: numAmount,
        method: selectedMethod,
        accountNumber: accountNumber.trim(),
        accountType,
        minWithdrawal,
        pin: withdrawPin,
      });

      applyUser(data.user);
      setFailedAttempts(0);
      setWithdrawPin('');
      showToast(`৳${numAmount} উইথড্র রিকোয়েস্ট গৃহীত হয়েছে! অ্যাডমিন অনুমোদন করলে একাউন্টে টাকা পৌঁছাবে।`, 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'উইথড্র রিকোয়েস্ট ব্যর্থ হয়েছে';
      if (msg.includes('ভুল ৪-ডিজিট')) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setLockSeconds(30);
          setFailedAttempts(0);
          setPinError('৫ বার ভুল পিন দেওয়ায় নিরাপত্তার জন্য ৩০ সেকেন্ড লক করা হয়েছে।');
        } else {
          setPinError(`${msg} (বাকি চেষ্টা: ${5 - nextAttempts} বার)`);
        }
      }
      showToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">টাকা উত্তোলন (Withdraw)</h2>
              <p className="text-xs text-slate-400">৪-ডিজিট সিকিউরিটি পিন সুরক্ষিত পেমেন্ট</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Balance card */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Wallet className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="text-xs text-slate-400 block">বর্তমান উত্তোলণযোগ্য ব্যালেন্স</span>
                <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
                  ৳{currentBalance.toFixed(2)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleWithdrawAll}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              সবটুকু তুলুন
            </button>
          </div>

          {/* Withdrawal Time-Window & Holiday Scheduler Status */}
          {!windowStatus.isOpen ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/40 space-y-2">
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-xs font-bold text-rose-300">{windowStatus.headline}</div>
                  <p className="text-[11px] text-rose-200/80 leading-relaxed">{windowStatus.detail}</p>
                </div>
              </div>
              {windowStatus.countdownText && (
                <div className="px-3 py-2 rounded-xl bg-slate-950/90 border border-rose-500/30 flex items-center justify-between text-xs">
                  <span className="text-slate-400">পরবর্তী উইথড্র চালু হতে বাকি:</span>
                  <span className="font-mono font-bold text-amber-300 tabular-nums">
                    {windowStatus.countdownText}
                  </span>
                </div>
              )}
            </div>
          ) : (
            settings?.withdrawalSchedule?.enabled && (
              <div className="px-3.5 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
                <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{windowStatus.detail}</span>
              </div>
            )
          )}

          {!hasWithdrawPin ? (
            <form
              onSubmit={handleSetupPin}
              className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    প্রথমে ৪-ডিজিট সিকিউরিটি পিন সেট করুন
                  </h3>
                  <p className="text-xs text-amber-200/80 leading-relaxed mt-1">
                    আপনার ব্যালেন্স সুরক্ষিত রাখতে টাকা উত্তোলনের আগে নিজস্ব ৪ সংখ্যার গোপন পিন সেট করা বাধ্যতামূলক, যাতে অন্য কেউ একাউন্ট থেকে টাকা তুলে নিতে না পারে।
                  </p>
                </div>
              </div>

              <PinCodeInput
                label="নতুন ৪-ডিজিট পিন দিন"
                value={setupPin}
                onChange={setSetupPin}
                disabled={isSettingPin}
                autoFocus
                accent="amber"
              />

              <PinCodeInput
                label="পিনটি পুনরায় নিশ্চিত করুন"
                value={confirmSetupPin}
                onChange={setConfirmSetupPin}
                disabled={isSettingPin}
                accent="emerald"
                error={
                  confirmSetupPin.length === 4 && setupPin !== confirmSetupPin
                    ? 'পিন দুটি মেলেনি!'
                    : undefined
                }
              />

              {setupError && (
                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{setupError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  isSettingPin ||
                  setupPin.length !== 4 ||
                  confirmSetupPin.length !== 4 ||
                  setupPin !== confirmSetupPin
                }
                className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-950/50"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isSettingPin ? 'সেট হচ্ছে...' : 'পিন সেট করে উইথড্র চালু করুন'}</span>
              </button>
            </form>
          ) : (
            <>
              {/* Security PIN Active Status Banner */}
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-emerald-300 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>৪-ডিজিট উইথড্র পিন লক সক্রিয়</span>
                </div>
                {onOpenSecurityPin && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSecurityPin();
                    }}
                    className="text-[11px] font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <KeyRound className="w-3 h-3" />
                    <span>পিন পরিবর্তন</span>
                  </button>
                )}
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  পেমেন্ট মাধ্যম বেছে নিন:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {([
                    { id: 'bKash' as PaymentMethod, name: 'বিকাশ (bKash)', color: 'text-[#f03b87]' },
                    { id: 'Nagad' as PaymentMethod, name: 'নগদ (Nagad)', color: 'text-[#fb923c]' },
                    { id: 'Rocket' as PaymentMethod, name: 'রকেট (Rocket)', color: 'text-[#c084fc]' },
                    { id: 'Binance USDT' as PaymentMethod, name: 'বাইনান্স (USDT)', color: 'text-[#facc15]' },
                  ]).map(m => {
                    const raw = settings?.paymentNumbers as Record<string, any> | undefined;
                    let logoUrl: string | undefined;
                    if (raw) {
                      if (m.id === 'bKash') logoUrl = typeof raw.bkash === 'object' ? raw.bkash?.logoUrl : undefined;
                      else if (m.id === 'Nagad') logoUrl = typeof raw.nagad === 'object' ? raw.nagad?.logoUrl : undefined;
                      else if (m.id === 'Rocket') logoUrl = typeof raw.rocket === 'object' ? raw.rocket?.logoUrl : undefined;
                      else if (m.id === 'Binance USDT') logoUrl = typeof raw.binance === 'object' ? raw.binance?.logoUrl : undefined;
                    }
                    const isSelected = selectedMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMethod(m.id)}
                        className={`p-3 rounded-2xl border text-xs font-semibold flex flex-col items-center justify-between gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-lg shadow-cyan-950 ring-2 ring-cyan-500/30'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <BrandLogo
                          src={logoUrl}
                          alt={m.name}
                          className="w-10 h-10 rounded-xl"
                          fallback={
                            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1 overflow-hidden shadow-inner">
                              <span className={`font-bold font-mono text-xs ${m.color}`}>
                                {m.id.slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                          }
                        />
                        <div className="text-center">
                          <div className="text-[11px] font-bold text-white leading-tight">{m.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Account Type (Personal / Agent) */}
              {selectedMethod !== 'Binance USDT' && (
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-300">একাউন্ট টাইপ:</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAccountType('personal')}
                      className={`px-3 py-1 text-xs rounded-lg border cursor-pointer ${
                        accountType === 'personal'
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Personal (পার্সোনাল)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountType('agent')}
                      className={`px-3 py-1 text-xs rounded-lg border cursor-pointer ${
                        accountType === 'agent'
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Agent (এজেন্ট)
                    </button>
                  </div>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {selectedMethod === 'Binance USDT' ? 'USDT (TRC20) Wallet Address' : `${selectedMethod} একাউন্ট নাম্বার`}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={selectedMethod === 'Binance USDT' ? 'TX...' : 'যেমন: 017XXXXXXXX'}
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-300">
                      উত্তোলনের পরিমাণ (টাকা ৳)
                    </label>
                    <span className="text-[11px] text-slate-400">সর্বনিম্ন ৳{minWithdrawal}</span>
                  </div>
                  <input
                    type="number"
                    min={minWithdrawal}
                    max={Math.max(minWithdrawal, currentBalance)}
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* 4-Digit Security PIN Verification */}
                <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-cyan-500/30">
                  <PinCodeInput
                    label="৪-ডিজিট সিকিউরিটি পিন যাচাই করুন *"
                    value={withdrawPin}
                    onChange={val => {
                      setWithdrawPin(val);
                      if (pinError) setPinError('');
                    }}
                    disabled={isSubmitting || lockSeconds > 0}
                    accent="cyan"
                    error={
                      lockSeconds > 0
                        ? `নিরাপত্তার জন্য ${lockSeconds} সেকেন্ড অপেক্ষা করুন`
                        : pinError
                    }
                    hint="উইথড্র কনফার্ম করতে আপনার সেট করা ৪ সংখ্যার পিন দিন"
                  />
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span>
                    উইথড্র রিকোয়েস্ট সাবমিটের সাথে সাথেই একাউন্ট থেকে টাকা কেটে নেওয়া হবে। অ্যাডমিন বাতিল করলে টাকা ফেরত আসবে, আর অনুমোদন করলে একাউন্টে পেমেন্ট পৌঁছে যাবে।
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={
                    !windowStatus.isOpen ||
                    isSubmitting ||
                    lockSeconds > 0 ||
                    currentBalance < minWithdrawal ||
                    Number(amount) > currentBalance ||
                    !accountNumber.trim() ||
                    withdrawPin.length !== 4
                  }
                  className="w-full mt-2 py-3 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-cyan-950 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>
                    {!windowStatus.isOpen
                      ? 'উইথড্র উইন্ডো বর্তমানে বন্ধ'
                      : isSubmitting
                      ? 'প্রসেসিং হচ্ছে...'
                      : lockSeconds > 0
                      ? `লকড (${lockSeconds}s)`
                      : 'উইথড্র রিকোয়েস্ট পাঠান'}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-950" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
