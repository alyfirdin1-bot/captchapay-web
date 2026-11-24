import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { submitRechargeTransaction } from '../lib/dbService';
import { isValidFourDigitPin } from '../lib/pinSecurity';
import { PinCodeInput } from './PinCodeInput';
import { BrandLogo } from './BrandLogo';
import { X, CreditCard, ArrowRight, Smartphone, Wallet, AlertCircle, Lock } from 'lucide-react';

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenSecurityPin?: () => void;
}

export const RechargeModal: React.FC<RechargeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onOpenSecurityPin,
}) => {
  const { user, settings, showToast, applyUser, setIsLoginModalOpen } = useAuth();
  const [senderSim, setSenderSim] = useState('Grameenphone');
  const [senderNumber, setSenderNumber] = useState('');
  const [amount, setAmount] = useState('100');
  const [securityPin, setSecurityPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSecurityPin('');
      setPinError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  if (!isOpen) return null;

  const currentBalance = user?.balance || 0;
  const numAmount = Number(amount);
  const isInsufficient = !isNaN(numAmount) && numAmount > currentBalance;
  const hasWithdrawPin = Boolean(user?.hasWithdrawPin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    if (isNaN(numAmount) || numAmount < 10) {
      showToast('সর্বনিম্ন রিচার্জ পরিমাণ ৳১০', 'error');
      return;
    }

    if (numAmount > currentBalance) {
      showToast('আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!', 'error');
      return;
    }

    if (!senderNumber.trim()) {
      showToast('আপনার মোবাইল নাম্বার দিন', 'error');
      return;
    }

    if (hasWithdrawPin) {
      if (lockSeconds > 0) {
        const msg = `ভুল পিনের কারণে ${lockSeconds} সেকেন্ড অপেক্ষা করুন।`;
        setPinError(msg);
        showToast(msg, 'error');
        return;
      }
      if (!isValidFourDigitPin(securityPin)) {
        setPinError('আপনার ৪-ডিজিট সিকিউরিটি পিন দিন।');
        showToast('৪-ডিজিট সিকিউরিটি পিন প্রদান করুন', 'error');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const data = await submitRechargeTransaction({
        uid: user.id,
        amount: numAmount,
        senderNumber: senderNumber.trim(),
        senderSim,
        method: 'Mobile Recharge',
        pin: hasWithdrawPin ? securityPin : undefined,
      });

      applyUser(data.user);
      setFailedAttempts(0);
      setSecurityPin('');
      showToast('রিচার্জ রিকোয়েস্ট সফলভাবে জমা হয়েছে!', 'success');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'রিচার্জ রিকোয়েস্ট ব্যর্থ হয়েছে';
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
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">মোবাইল রিচার্জ করুন</h2>
              <p className="text-xs text-slate-400">একাউন্ট ব্যালেন্স থেকে সরাসরি মোবাইল রিচার্জ রিকোয়েস্ট পাঠান</p>
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Current Balance Card */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Wallet className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="text-xs text-slate-400 block">আপনার বর্তমান ব্যালেন্স</span>
                <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
                  ৳{currentBalance.toFixed(2)}
                </span>
              </div>
            </div>
            {currentBalance >= 10 && (
              <button
                type="button"
                onClick={() => setAmount(Math.floor(currentBalance).toString())}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                সব ব্যালেন্স নিন
              </button>
            )}
          </div>

          {/* SIM Operator Selection with Logos */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
              ১. সিম অপারেটর বেছে নিন (SIM Operator):
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'Grameenphone', name: 'গ্রামীনফোন', en: 'GP', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30' },
                { id: 'Banglalink', name: 'বাংলালিংক', en: 'BL', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
                { id: 'Robi', name: 'রবি', en: 'Robi', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
                { id: 'Airtel', name: 'এয়ারটেল', en: 'Airtel', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
                { id: 'Teletalk', name: 'টেলিটক', en: 'Teletalk', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
              ].map(op => {
                const isSelected = senderSim === op.id;
                const logoUrl = settings?.operatorLogos?.[op.id];
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => setSenderSim(op.id)}
                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-between gap-1.5 ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-400 ring-2 ring-emerald-500/40 shadow-lg shadow-emerald-950 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <BrandLogo
                      src={logoUrl}
                      alt={op.id}
                      className="w-10 h-10 rounded-xl"
                      fallback={
                        <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1 overflow-hidden shadow-inner">
                          <span className={`font-bold font-mono text-xs ${op.color}`}>{op.en}</span>
                        </div>
                      }
                    />
                    <div>
                      <div className="text-[11px] font-bold text-white leading-tight">{op.name}</div>
                      <div className="text-[9px] text-slate-400">{op.en}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              রিচার্জ করার মোবাইল নাম্বার (Mobile Number):
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Smartphone className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                placeholder="যেমন: 017XXXXXXXX"
                value={senderNumber}
                onChange={e => setSenderNumber(e.target.value)}
                className="w-full pl-10 pr-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Amount Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                রিচার্জ পরিমাণ নির্বাচন করুন (৳):
              </label>
              <span className="text-[11px] text-slate-400">সর্বনিম্ন ৳১০</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {['20', '50', '100', '300'].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(val)}
                  className={`py-2.5 rounded-xl text-xs font-mono font-bold border transition-colors cursor-pointer tabular-nums ${
                    amount === val
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  ৳{val}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="10"
              max={Math.max(10, currentBalance)}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="রিচার্জ পরিমাণ লিখুন (যেমন: 50)"
              className="w-full px-3.5 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {isInsufficient && (
              <p className="text-xs text-rose-400 mt-1.5 font-medium">
                আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই! সর্বোচ্চ ৳{currentBalance.toFixed(2)} রিচার্জ করতে পারবেন।
              </p>
            )}
          </div>

          {hasWithdrawPin ? (
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-emerald-500/30">
              <PinCodeInput
                label="৪-ডিজিট সিকিউরিটি পিন যাচাই করুন *"
                value={securityPin}
                onChange={val => {
                  setSecurityPin(val);
                  if (pinError) setPinError('');
                }}
                disabled={isSubmitting || lockSeconds > 0}
                accent="emerald"
                error={
                  lockSeconds > 0
                    ? `নিরাপত্তার জন্য ${lockSeconds} সেকেন্ড অপেক্ষা করুন`
                    : pinError
                }
                hint="আপনার ব্যালেন্স সুরক্ষার জন্য সেট করা ৪-ডিজিট পিন দিন"
              />
            </div>
          ) : (
            onOpenSecurityPin && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>অতিরিক্ত নিরাপত্তার জন্য ৪-ডিজিট সিকিউরিটি পিন সেট করতে পারেন।</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSecurityPin();
                  }}
                  className="text-[11px] font-bold text-amber-300 hover:text-amber-200 underline cursor-pointer shrink-0"
                >
                  পিন সেট
                </button>
              </div>
            )
          )}

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              রিকোয়েস্ট পাঠানোর সাথে সাথেই একাউন্ট থেকে টাকা কেটে নেওয়া হবে। অ্যাডমিন বাতিল (Reject) করলে টাকা আবার আপনার একাউন্টে ফেরত আসবে।
            </span>
          </div>

          <button
            type="submit"
            disabled={
              isSubmitting ||
              lockSeconds > 0 ||
              !senderNumber.trim() ||
              currentBalance < 10 ||
              isInsufficient ||
              isNaN(numAmount) ||
              numAmount < 10 ||
              (hasWithdrawPin && securityPin.length !== 4)
            }
            className="w-full mt-2 py-3.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>
              {isSubmitting
                ? 'প্রক্রিয়াধীন...'
                : lockSeconds > 0
                ? `লকড (${lockSeconds}s)`
                : 'রিচার্জ নিশ্চিত করুন'}
            </span>
            <ArrowRight className="w-4 h-4 text-slate-950" />
          </button>
        </form>
      </div>
    </div>
  );
};
