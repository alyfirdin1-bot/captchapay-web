import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  processRechargeTransaction,
  submitDepositTransaction,
  subscribeToSingleRecharge,
} from '../lib/dbService';
import {
  markDepositAutoApproved,
  registerVerifiedDepositWithServer,
  verifyDepositPaymentWithServer,
} from '../lib/smsGatewayService';
import { parseDepositSmsText, type ParsedDepositSms } from '../lib/smsParser';
import { PaymentMethod } from '../types';
import { BrandLogo } from './BrandLogo';
import {
  X,
  Wallet,
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
  Smartphone,
  Hash,
  Sparkles,
  ClipboardPaste,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type DepositStep = 'amount' | 'checkout';
type VerifyPhase = 'idle' | 'checking' | 'failed' | 'verified_pending_sync' | 'credited';

const PAYMENT_METHODS: Array<{
  id: PaymentMethod;
  name: string;
  badge: string;
  colorBg: string;
  colorBorder: string;
  logoBg: string;
  numberKey: 'bkash' | 'nagad' | 'rocket' | 'binance';
  instructions: string;
}> = [
  {
    id: 'bKash',
    name: 'বিকাশ (bKash)',
    badge: 'Merchant / Personal',
    colorBg: 'bg-pink-950/40 hover:bg-pink-950/70',
    colorBorder: 'border-pink-500/40',
    logoBg: 'bg-[#E2136E] text-white',
    numberKey: 'bkash',
    instructions: 'উপরের বিকাশ নাম্বারটি কপি করে আপনার বিকাশ অ্যাপ থেকে Send Money / Payment করুন।',
  },
  {
    id: 'Nagad',
    name: 'নগদ (Nagad)',
    badge: 'Merchant / Personal',
    colorBg: 'bg-orange-950/40 hover:bg-orange-950/70',
    colorBorder: 'border-orange-500/40',
    logoBg: 'bg-[#EC1C24] text-white',
    numberKey: 'nagad',
    instructions: 'উপরের নগদ নাম্বারটি কপি করে আপনার নগদ অ্যাপ থেকে Send Money করুন।',
  },
  {
    id: 'Rocket',
    name: 'রকেট (Rocket)',
    badge: 'Personal',
    colorBg: 'bg-purple-950/40 hover:bg-purple-950/70',
    colorBorder: 'border-purple-500/40',
    logoBg: 'bg-[#8C349B] text-white',
    numberKey: 'rocket',
    instructions: 'উপরের রকেট একাউন্ট নাম্বারটি কপি করে রকেট থেকে Send Money করুন।',
  },
  {
    id: 'Binance USDT',
    name: 'বাইন্যান্স (Binance USDT)',
    badge: 'Crypto BEP20/TRC20',
    colorBg: 'bg-amber-950/40 hover:bg-amber-950/70',
    colorBorder: 'border-amber-500/40',
    logoBg: 'bg-amber-500 text-slate-950 font-bold',
    numberKey: 'binance',
    instructions: 'উপরের অ্যাড্রেস/ID কপি করে USDT পাঠিয়ে TxID দিন।',
  },
];

export const DepositModal: React.FC<DepositModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { user, isAdmin, settings, showToast, applyUser, setIsLoginModalOpen } = useAuth();

  const [step, setStep] = useState<DepositStep>('amount');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('bKash');
  const [amount, setAmount] = useState('500');
  const [senderNumber, setSenderNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedDepositSms | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [activeRechargeId, setActiveRechargeId] = useState<string | null>(null);

  const rechargeUnsubRef = useRef<(() => void) | null>(null);
  const savedSenderStorageKey = user?.id ? `captchapay_last_deposit_sender_${user.id}` : '';

  // Reset modal cleanly when opened/closed
  useEffect(() => {
    if (!isOpen) {
      if (rechargeUnsubRef.current) {
        rechargeUnsubRef.current();
        rechargeUnsubRef.current = null;
      }
      setStep('amount');
      setVerifyPhase('idle');
      setVerifyMessage('');
      setActiveRechargeId(null);
      setTrxId('');
      setParsedResult(null);
      return;
    }

    if (savedSenderStorageKey) {
      try {
        const remembered = localStorage.getItem(savedSenderStorageKey) || '';
        if (remembered) {
          setSenderNumber(prev => prev || remembered);
        }
      } catch {
        // ignore storage error
      }
    }
  }, [isOpen, savedSenderStorageKey]);

  // Listen in real time if an instant-verified deposit gets credited in Firestore
  useEffect(() => {
    if (!activeRechargeId || verifyPhase !== 'verified_pending_sync') return;
    if (rechargeUnsubRef.current) rechargeUnsubRef.current();

    const unsub = subscribeToSingleRecharge(activeRechargeId, rec => {
      if (rec?.status === 'approved') {
        setVerifyPhase('credited');
        setVerifyMessage(`৳${rec.amount.toFixed(2)} সফলভাবে আপনার ওয়ালেটে যুক্ত হয়েছে!`);
        showToast(`৳${rec.amount} ডিপোজিট ভেরিফাই সম্পন্ন ও ব্যালেন্স যুক্ত হয়েছে!`, 'success');
        if (onSuccess) onSuccess();
      }
    });
    rechargeUnsubRef.current = unsub;

    return () => {
      unsub();
    };
  }, [activeRechargeId, verifyPhase, showToast, onSuccess]);

  if (!isOpen) return null;

  const rawPaymentNumbers = (settings?.paymentNumbers || {}) as Record<string, unknown>;
  const getMethodCfg = (key: 'bkash' | 'nagad' | 'rocket' | 'binance') => {
    const val = rawPaymentNumbers[key] as Record<string, unknown> | string | undefined;
    if (typeof val === 'object' && val !== null) {
      return {
        number: String(val.number || ''),
        accountType: String(val.accountType || 'Personal'),
        actionType: String(val.actionType || 'Send Money'),
        enabled: val.enabled !== false,
        logoUrl: String(val.logoUrl || ''),
      };
    }
    return {
      number: String(val || '01700000000'),
      accountType: 'Personal',
      actionType: 'Send Money',
      enabled: true,
      logoUrl: '',
    };
  };

  const knownAdminNumbers = (['bkash', 'nagad', 'rocket', 'binance'] as const)
    .map(k => getMethodCfg(k).number)
    .filter(Boolean);

  const activeMethodConfig = PAYMENT_METHODS.find(m => m.id === selectedMethod) || PAYMENT_METHODS[0];
  const activeCfg = getMethodCfg(activeMethodConfig.numberKey);
  const targetNumber = activeCfg.number || '01700000000';

  const handleConfirmAmountStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 50) {
      showToast('সর্বনিম্ন ডিপোজিট পরিমাণ ৳৫০', 'error');
      return;
    }
    if (numAmount > 50000) {
      showToast('একবারে সর্বোচ্চ ডিপোজিট পরিমাণ ৳৫০,০০০', 'error');
      return;
    }

    setVerifyPhase('idle');
    setVerifyMessage('');
    setStep('checkout');
  };

  const handleCopyNumber = async () => {
    try {
      await navigator.clipboard.writeText(targetNumber);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
      showToast(`${activeMethodConfig.name} নাম্বার কপি হয়েছে!`, 'success');
    } catch {
      showToast('নম্বর কপি করা যায়নি', 'error');
    }
  };

  const handleQuickPasteSms = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        showToast('অনুগ্রহ করে হাতে TrxID ঘরে পেস্ট করুন।', 'info');
        return;
      }
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        showToast('ক্লিপবোর্ডে কোনো SMS পাওয়া যায়নি।', 'info');
        return;
      }
      const parsed = parseDepositSmsText(clipText, { knownAdminNumbers });
      setParsedResult(parsed);
      if (parsed.trxId) setTrxId(parsed.trxId);
      if (parsed.senderNumber) setSenderNumber(parsed.senderNumber);

      if (parsed.trxId) {
        showToast(`অটো-ফিল: TrxID ${parsed.trxId}`, 'success');
      } else {
        const cleanRaw = clipText.trim().toUpperCase();
        if (/^[A-Z0-9]{5,64}$/.test(cleanRaw)) {
          setTrxId(cleanRaw);
          showToast(`TrxID বসানো হয়েছে: ${cleanRaw}`, 'success');
        } else {
          showToast('SMS থেকে TrxID পাওয়া যায়নি—অনুগ্রহ করে সরাসরি TrxID লিখুন।', 'info');
        }
      }
    } catch {
      showToast('ক্লিপবোর্ড অনুমতি মেলেনি—সরাসরি TrxID পেস্ট করুন।', 'info');
    }
  };

  const handleVerifyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    const cleanTrx = trxId.trim().toUpperCase();
    const numAmount = Number(amount);

    if (cleanTrx.length < 4) {
      showToast('সঠিক ট্রানজেকশন আইডি (TrxID) লিখুন', 'error');
      return;
    }

    setVerifyPhase('checking');
    setVerifyMessage('আমাদের পেমেন্ট সার্ভারের সাথে ২–৩ সেকেন্ড যাচাই করা হচ্ছে...');

    try {
      // Run real server SMS verification + minimum 2.3s verification cadence
      const [verifyRes] = await Promise.all([
        verifyDepositPaymentWithServer({
          amount: numAmount,
          method: selectedMethod,
          senderNumber: senderNumber.trim(),
          trxId: cleanTrx,
        }),
        new Promise(resolve => setTimeout(resolve, 2300)),
      ]);

      if (!verifyRes.verified) {
        setVerifyPhase('failed');
        setVerifyMessage(
          verifyRes.reason ||
            'আমাদের সার্ভারে এই TrxID ও পরিমাণের কোনো পেমেন্ট এখনো আসেনি। ভেরিফাই ব্যর্থ হয়েছে (Failed)।'
        );
        return;
      }

      const finalSender =
        verifyRes.senderNumber ||
        senderNumber.trim() ||
        'SMS-Verified';

      if (savedSenderStorageKey && finalSender !== 'SMS-Verified') {
        try {
          localStorage.setItem(savedSenderStorageKey, finalSender);
        } catch {
          // ignore
        }
      }

      const depositRes = await submitDepositTransaction({
        uid: user.id,
        amount: numAmount,
        senderNumber: finalSender,
        trxId: cleanTrx,
        method: selectedMethod,
      });

      await registerVerifiedDepositWithServer({
        rechargeId: depositRes.recharge.id,
        trxId: cleanTrx,
      });

      setActiveRechargeId(depositRes.recharge.id);
      applyUser(depositRes.user);

      // If admin is testing right here, credit immediately without waiting for background timer
      if (isAdmin) {
        try {
          await processRechargeTransaction({
            rechargeId: depositRes.recharge.id,
            action: 'approve',
            adminNote: `SMS Gateway ২-সেকেন্ড অটো-ভেরিফাইড (${cleanTrx})`,
            actorEmail: user.email,
          });
          await markDepositAutoApproved(depositRes.recharge.id).catch(() => {});
          setVerifyPhase('credited');
          setVerifyMessage(`৳${numAmount.toFixed(2)} ভেরিফাই সফল ও আপনার ব্যালেন্সে যুক্ত হয়েছে!`);
          showToast(`৳${numAmount} ডিপোজিট ভেরিফাই সফল ও ব্যালেন্সে যুক্ত হয়েছে!`, 'success');
          if (onSuccess) onSuccess();
          return;
        } catch {
          // Fall through to real-time doc sync watcher
        }
      }

      setVerifyPhase('verified_pending_sync');
      setVerifyMessage('সার্ভারে পেমেন্ট ভেরিফাই সম্পন্ন ✓! ব্যালেন্স যুক্ত হচ্ছে...');
    } catch (err) {
      setVerifyPhase('failed');
      setVerifyMessage(
        err instanceof Error ? err.message : 'ভেরিফিকেশন সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-0 right-0 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-pink-900/40">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {step === 'amount' ? 'ডিপোজিট অ্যামাউন্ট দিন' : 'পেমেন্ট ও ভেরিফাই করুন'}
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {step === 'amount' ? 'ধাপ ১ / ২' : 'ধাপ ২ / ২'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {step === 'amount'
                  ? 'প্রথমে পেমেন্ট মাধ্যম ও টাকার পরিমাণ নির্বাচন করুন'
                  : 'নম্বর কপি করে টাকা পাঠান এবং TrxID দিয়ে ইনস্ট্যান্ট ভেরিফাই করুন'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: SELECT METHOD & CONFIRM AMOUNT FIRST */}
        {step === 'amount' && (
          <form onSubmit={handleConfirmAmountStep} className="p-5 sm:p-6 space-y-5 max-h-[80vh] overflow-y-auto relative z-10">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                ১. পেমেন্ট মাধ্যম নির্বাচন করুন
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {PAYMENT_METHODS.map(method => {
                  const isSelected = selectedMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSelectedMethod(method.id)}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                        isSelected
                          ? `${method.colorBg} ${method.colorBorder} ring-2 ring-pink-500/50 shadow-lg`
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <BrandLogo
                          src={getMethodCfg(method.numberKey).logoUrl}
                          alt={method.name}
                          className="w-8 h-8 rounded-xl"
                          fallback={
                            <div className={`w-8 h-8 rounded-xl ${method.logoBg} flex items-center justify-center font-bold text-xs shadow`}>
                              {method.id.slice(0, 2).toUpperCase()}
                            </div>
                          }
                        />
                        {isSelected && <Check className="w-4 h-4 text-pink-400" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white leading-snug">{method.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{getMethodCfg(method.numberKey).accountType}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                ২. ডিপোজিটের পরিমাণ লিখুন (৳৫০ – ৳৫০,০০০)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">৳</span>
                <input
                  type="number"
                  min="50"
                  max="50000"
                  step="any"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="যেমন: 500"
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-3.5 bg-slate-950 border border-slate-800 focus:border-pink-500 rounded-2xl text-white font-mono font-bold text-lg focus:outline-none transition"
                />
              </div>

              <div className="grid grid-cols-4 gap-2 pt-1">
                {[100, 500, 1000, 5000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(String(val))}
                    className={`py-2 rounded-xl border text-xs font-bold font-mono transition cursor-pointer ${
                      Number(amount) === val
                        ? 'bg-pink-600 border-pink-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    ৳{val}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-pink-600 via-rose-600 to-pink-500 hover:from-pink-500 hover:to-rose-400 text-white font-bold text-sm shadow-xl shadow-pink-950/50 flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>অ্যামাউন্ট কনফার্ম করুন ও পরবর্তী পেজে যান</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* STEP 2: DEDICATED PAYMENT NUMBER COPY + TRXID SUBMIT + 2-3s VERIFY */}
        {step === 'checkout' && (
          <form onSubmit={handleVerifyPayment} className="p-5 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto relative z-10">
            {/* Confirmed Amount Summary Strip */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <BrandLogo
                  src={activeCfg.logoUrl}
                  alt={activeMethodConfig.name}
                  className="w-8 h-8 rounded-lg"
                  imgClassName="w-full h-full object-contain"
                  fallback={<Smartphone className="w-5 h-5 text-pink-400" />}
                />
                <div>
                  <div className="text-[11px] text-slate-400">{activeMethodConfig.name}</div>
                  <div className="text-base font-bold font-mono text-emerald-400">
                    পাঠাতে হবে: ৳{Number(amount || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              {verifyPhase !== 'checking' && verifyPhase !== 'credited' && (
                <button
                  type="button"
                  onClick={() => {
                    setVerifyPhase('idle');
                    setVerifyMessage('');
                    setStep('amount');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>পরিবর্তন</span>
                </button>
              )}
            </div>

            {/* Official Payment Number Box with Copy */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 to-emerald-950/25 border border-emerald-500/35 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">
                  আমাদের {activeMethodConfig.name} নম্বর
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30">
                  {activeCfg.accountType} • {activeCfg.actionType}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="font-mono font-bold text-xl text-emerald-400 tracking-wider select-all">
                  {targetNumber}
                </div>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>কপি হয়েছে!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>নম্বর কপি করুন</span>
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {activeMethodConfig.instructions}
              </p>
            </div>

            {/* Transaction ID Submission */}
            {verifyPhase !== 'credited' && verifyPhase !== 'verified_pending_sync' && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      ট্রানজেকশন আইডি (TrxID) লিখুন বা পেস্ট করুন
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickPasteSms}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                    >
                      <ClipboardPaste className="w-3 h-3" />
                      <span>SMS পেস্ট</span>
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                      <Hash className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      value={trxId}
                      onChange={e => {
                        setTrxId(e.target.value.toUpperCase());
                        if (verifyPhase === 'failed') setVerifyPhase('idle');
                      }}
                      placeholder="যেমন: 9J7K3X2L8P"
                      required
                      disabled={verifyPhase === 'checking'}
                      className="w-full pl-11 pr-4 py-3.5 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl text-white font-mono font-bold uppercase tracking-wider text-sm focus:outline-none transition disabled:opacity-60"
                    />
                  </div>
                  {parsedResult?.trxId && (
                    <p className="text-[11px] text-emerald-400">
                      ✓ SMS থেকে অটো-ফিল হয়েছে: {parsedResult.trxId}
                    </p>
                  )}
                </div>

                {/* Compact Optional Sender Number */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">
                    আপনার যে নম্বর থেকে পাঠিয়েছেন (ঐচ্ছিক — সার্ভার অটো শনাক্ত করবে)
                  </label>
                  <input
                    type="text"
                    value={senderNumber}
                    onChange={e => setSenderNumber(e.target.value)}
                    placeholder="যেমন: 017XXXXXXXX (ফাঁকা রাখলেও চলবে)"
                    disabled={verifyPhase === 'checking'}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-pink-500 rounded-xl text-white font-mono text-xs focus:outline-none transition disabled:opacity-60"
                  />
                </div>
              </>
            )}

            {/* Live Verification Status Panel */}
            {verifyPhase === 'checking' && (
              <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/35 flex items-center gap-3">
                <Loader2 className="w-6 h-6 text-sky-400 animate-spin shrink-0" />
                <div>
                  <div className="text-xs font-bold text-sky-200">পেমেন্ট ভেরিফাই হচ্ছে...</div>
                  <div className="text-[11px] text-slate-300 mt-0.5">{verifyMessage}</div>
                </div>
              </div>
            )}

            {verifyPhase === 'failed' && (
              <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 space-y-2">
                <div className="flex items-start gap-2.5">
                  <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-rose-200">ভেরিফাই ব্যর্থ হয়েছে (Failed)</div>
                    <div className="text-[11px] text-rose-100/90 mt-1 leading-relaxed">{verifyMessage}</div>
                  </div>
                </div>
              </div>
            )}

            {verifyPhase === 'verified_pending_sync' && (
              <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 space-y-2">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-emerald-200">
                      সার্ভারে পেমেন্ট ভেরিফাই হয়েছে ✓
                    </div>
                    <div className="text-[11px] text-slate-200 mt-1 leading-relaxed">
                      আপনার ডিপোজিট ({activeRechargeId}) সফলভাবে যাচাই সম্পন্ন হয়েছে। অটো-সিঙ্ক হওয়া মাত্রই ব্যালেন্স যুক্ত হয়ে যাবে।
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  ঠিক আছে, সম্পন্ন
                </button>
              </div>
            )}

            {verifyPhase === 'credited' && (
              <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 space-y-3 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <div>
                  <div className="text-sm font-bold text-white">পেমেন্ট ভেরিফাই সফল ও ব্যালেন্স যুক্ত ✓</div>
                  <div className="text-xs text-emerald-200 mt-1">{verifyMessage}</div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  ওয়ালেটে ফিরে যান
                </button>
              </div>
            )}

            {/* Primary Verify Button */}
            {verifyPhase !== 'credited' && verifyPhase !== 'verified_pending_sync' && (
              <button
                type="submit"
                disabled={verifyPhase === 'checking'}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-sm shadow-xl shadow-emerald-950/50 flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:opacity-60"
              >
                {verifyPhase === 'checking' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>২–৩ সেকেন্ডের মধ্যে ভেরিফাই হচ্ছে...</span>
                  </>
                ) : verifyPhase === 'failed' ? (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>পুনরায় ভেরিফাই করুন</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>ভেরিফাই করুন</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}

            <div className="flex items-start gap-1.5 text-[10px] text-slate-400 bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                টাকা পাঠানোর ২–৩ সেকেন্ডের মধ্যেই আমাদের অটোমেটেড SMS সার্ভার আপনার TrxID ও পরিমাণ মিলিয়ে সাথে সাথে ভেরিফাই করে দেবে।
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
