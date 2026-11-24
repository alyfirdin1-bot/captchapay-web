import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { lookupP2PRecipientByEmail, sendP2PTransferTransaction } from '../lib/dbService';
import { getDefaultP2PConfig } from '../lib/defaults';
import { isValidFourDigitPin } from '../lib/pinSecurity';
import { PinCodeInput } from './PinCodeInput';
import {
  X,
  Send,
  Wallet,
  Mail,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
  Search,
} from 'lucide-react';

interface P2PTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenSecurityPin?: () => void;
}

export const P2PTransferModal: React.FC<P2PTransferModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onOpenSecurityPin,
}) => {
  const { user, settings, showToast, applyUser, setIsLoginModalOpen } = useAuth();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [verifiedRecipient, setVerifiedRecipient] = useState<{
    uid: string;
    name: string;
    email: string;
  } | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [amount, setAmount] = useState('50');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPin('');
      setPinError('');
      setLookupError('');
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

  const p2pCfg = settings?.p2pConfig || getDefaultP2PConfig();
  const currentBalance = user?.balance || 0;
  const hasWithdrawPin = Boolean(user?.hasWithdrawPin);
  const numAmount = Number(amount);
  const validAmount = Number.isFinite(numAmount) && numAmount > 0 ? numAmount : 0;
  const feeAmount = Math.round(((validAmount * p2pCfg.feePercent) / 100) * 100) / 100;
  const totalDeducted = Math.round((validAmount + feeAmount) * 100) / 100;
  const isInsufficient = totalDeducted > currentBalance;

  const handleVerifyRecipient = async () => {
    setLookupError('');
    setVerifiedRecipient(null);
    const clean = recipientEmail.toLowerCase().trim();
    if (!clean || !clean.includes('@')) {
      setLookupError('প্রাপকের সঠিক ইমেইল লিখুন');
      return;
    }
    if (user && clean === user.email.toLowerCase().trim()) {
      setLookupError('নিজের ইমেইলে ব্যালেন্স পাঠানো যাবে না!');
      return;
    }

    setIsLookingUp(true);
    try {
      const found = await lookupP2PRecipientByEmail(clean);
      if (!found || !found.uid) {
        setLookupError('এই ইমেইলে কোনো CaptchaPay একাউন্ট পাওয়া যায়নি (প্রাপককে অন্তত একবার লগইন করতে হবে)।');
      } else {
        setVerifiedRecipient(found);
      }
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }
    if (!p2pCfg.enabled) {
      showToast('অ্যাডমিন সাময়িকভাবে P2P ট্রান্সফার বন্ধ রেখেছেন।', 'error');
      return;
    }
    if (!hasWithdrawPin) {
      showToast('P2P ট্রান্সফারের আগে ৪-ডিজিট সিকিউরিটি পিন সেট করুন।', 'error');
      return;
    }
    if (lockSeconds > 0) {
      const msg = `ভুল পিনের কারণে ${lockSeconds} সেকেন্ড অপেক্ষা করুন।`;
      setPinError(msg);
      showToast(msg, 'error');
      return;
    }
    if (!isValidFourDigitPin(pin)) {
      setPinError('আপনার ৪-ডিজিট সিকিউরিটি পিন দিন।');
      showToast('৪-ডিজিট সিকিউরিটি পিন প্রদান করুন', 'error');
      return;
    }
    if (validAmount < p2pCfg.minAmount || validAmount > p2pCfg.maxAmount) {
      showToast(`ট্রান্সফার পরিমাণ ৳${p2pCfg.minAmount} থেকে ৳${p2pCfg.maxAmount} এর মধ্যে হতে হবে।`, 'error');
      return;
    }
    if (isInsufficient) {
      showToast('আপনার পর্যাপ্ত ব্যালেন্স নেই!', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await sendP2PTransferTransaction({
        uid: user.id,
        recipientEmail,
        amount: validAmount,
        pin,
        note,
      });

      applyUser(res.user);
      setFailedAttempts(0);
      setPin('');
      setRecipientEmail('');
      setVerifiedRecipient(null);
      setNote('');
      showToast(
        `${res.transfer.recipientName}-কে ৳${res.transfer.amount.toFixed(2)} পাঠানো হয়েছে এবং সরাসরি তার ব্যালেন্সে যোগ হয়ে গেছে!`,
        'success'
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'P2P ট্রান্সফার ব্যর্থ হয়েছে';
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
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center text-indigo-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">P2P ব্যালেন্স ট্রান্সফার</h2>
              <p className="text-xs text-slate-400">কোনো ক্লেইম ছাড়াই সরাসরি প্রাপকের ব্যালেন্সে তাৎক্ষণিক যোগ হবে</p>
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

        <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
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
            <div className="text-right text-[11px] text-slate-400">
              <div>ফি: <span className="text-indigo-300 font-bold">{p2pCfg.feePercent}%</span></div>
              <div>সীমা: ৳{p2pCfg.minAmount}–৳{p2pCfg.maxAmount}</div>
            </div>
          </div>

          {!p2pCfg.enabled ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>অ্যাডমিন সাময়িকভাবে P2P ব্যালেন্স ট্রান্সফার বন্ধ রেখেছেন।</span>
            </div>
          ) : !hasWithdrawPin ? (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-200 leading-relaxed">
                <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  P2P ব্যালেন্স ট্রান্সফার ব্যবহার করতে হলে নিরাপত্তার জন্য প্রথমে আপনার ৪-ডিজিট সিকিউরিটি পিন সেট করতে হবে।
                </span>
              </div>
              {onOpenSecurityPin && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSecurityPin();
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  ৪-ডিজিট সিকিউরিটি পিন সেট করুন
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  প্রাপকের গুগল ইমেইল (Recipient Email) *
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      required
                      placeholder="friend@gmail.com"
                      value={recipientEmail}
                      onChange={e => {
                        setRecipientEmail(e.target.value);
                        setVerifiedRecipient(null);
                        setLookupError('');
                      }}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyRecipient}
                    disabled={isLookingUp || !recipientEmail.trim()}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-indigo-300 border border-slate-700 flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{isLookingUp ? 'খোঁজা হচ্ছে...' : 'যাচাই'}</span>
                  </button>
                </div>

                {verifiedRecipient && (
                  <div className="mt-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      প্রাপক নিশ্চিত: <strong>{verifiedRecipient.name}</strong>
                    </span>
                  </div>
                )}

                {lookupError && (
                  <p className="mt-1.5 text-[11px] text-rose-400 font-medium">{lookupError}</p>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-slate-300">ট্রান্সফারের পরিমাণ (৳) *</label>
                  <span className="text-[11px] text-slate-400">
                    সর্বনিম্ন ৳{p2pCfg.minAmount} · সর্বোচ্চ ৳{p2pCfg.maxAmount}
                  </span>
                </div>
                <input
                  type="number"
                  min={p2pCfg.minAmount}
                  max={p2pCfg.maxAmount}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />

                {validAmount > 0 && (
                  <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>প্রাপক পাবেন:</span>
                      <span className="font-mono text-emerald-400 font-bold">৳{validAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>সার্ভিস ফি ({p2pCfg.feePercent}%):</span>
                      <span className="font-mono text-amber-300">৳{feeAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-white font-bold pt-1 border-t border-slate-800">
                      <span>মোট ব্যালেন্স কাটবে:</span>
                      <span className={`font-mono ${isInsufficient ? 'text-rose-400' : 'text-indigo-300'}`}>
                        ৳{totalDeducted.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  নোট (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  maxLength={150}
                  placeholder="যেমন: বন্ধু গিফট / লেনদেন"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-indigo-500/35">
                <PinCodeInput
                  label="৪-ডিজিট সিকিউরিটি পিন যাচাই করুন *"
                  value={pin}
                  onChange={val => {
                    setPin(val);
                    if (pinError) setPinError('');
                  }}
                  disabled={isSubmitting || lockSeconds > 0}
                  accent="cyan"
                  error={
                    lockSeconds > 0
                      ? `নিরাপত্তার জন্য ${lockSeconds} সেকেন্ড অপেক্ষা করুন`
                      : pinError
                  }
                />
              </div>

              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  lockSeconds > 0 ||
                  !recipientEmail.trim() ||
                  validAmount < p2pCfg.minAmount ||
                  validAmount > p2pCfg.maxAmount ||
                  isInsufficient ||
                  pin.length !== 4
                }
                className="w-full py-3 px-4 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-indigo-950 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>
                  {isSubmitting
                    ? 'পাঠানো হচ্ছে...'
                    : lockSeconds > 0
                    ? `লকড (${lockSeconds}s)`
                    : 'P2P ব্যালেন্স পাঠান'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
