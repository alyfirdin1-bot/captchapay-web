import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { setOrUpdateWithdrawPinInFirestore } from '../lib/dbService';
import { isValidFourDigitPin } from '../lib/pinSecurity';
import { PinCodeInput } from './PinCodeInput';
import { ShieldCheck, Lock, X, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SecurityPinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecurityPinModal: React.FC<SecurityPinModalProps> = ({ isOpen, onClose }) => {
  const { user, applyUser, showToast } = useAuth();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setErrorMsg('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  if (!isOpen || !user) return null;

  const hasExistingPin = Boolean(user.hasWithdrawPin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (lockSeconds > 0) {
      setErrorMsg(`অতিরিক্ত ভুল পিনের কারণে ${lockSeconds} সেকেন্ড অপেক্ষা করুন।`);
      return;
    }

    if (hasExistingPin && !isValidFourDigitPin(currentPin)) {
      setErrorMsg('অনুগ্রহ করে আপনার বর্তমান ৪-ডিজিট পিন দিন।');
      return;
    }

    if (!isValidFourDigitPin(newPin)) {
      setErrorMsg('নতুন পিন অবশ্যই ৪টি সংখ্যা (০-৯) হতে হবে।');
      return;
    }

    if (newPin !== confirmPin) {
      setErrorMsg('নতুন পিন এবং কনফার্ম পিন মেলেনি!');
      return;
    }

    if (hasExistingPin && currentPin === newPin) {
      setErrorMsg('নতুন পিনটি বর্তমান পিন থেকে ভিন্ন হতে হবে।');
      return;
    }

    setIsSaving(true);
    try {
      const res = await setOrUpdateWithdrawPinInFirestore({
        uid: user.id,
        newPin,
        currentPin: hasExistingPin ? currentPin : undefined,
      });
      applyUser(res.user);
      setFailedAttempts(0);
      showToast(res.message, 'success');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'পিন সেভ করতে সমস্যা হয়েছে';
      setErrorMsg(msg);
      if (hasExistingPin && msg.includes('সঠিক নয়')) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setLockSeconds(30);
          setFailedAttempts(0);
          setErrorMsg('৫ বার ভুল পিন দেওয়ায় নিরাপত্তার জন্য ৩০ সেকেন্ড লক করা হয়েছে।');
        }
      }
      showToast(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {hasExistingPin ? 'সিকিউরিটি পিন পরিবর্তন' : '৪-ডিজিট সিকিউরিটি পিন সেট করুন'}
              </h2>
              <p className="text-[11px] text-slate-400">
                উইথড্র ও ব্যালেন্স সুরক্ষার জন্য ব্যক্তিগত পিন লক
              </p>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {hasExistingPin ? (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>আপনার একাউন্টে ৪-ডিজিট উইথড্র পিন লক সক্রিয় আছে।</span>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200 leading-relaxed">
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                আপনার ব্যালেন্স সুরক্ষিত রাখতে টাকা উইথড্র বা রিচার্জ করার আগে একটি ৪ সংখ্যার গোপন পিন সেট করে নিন।
              </span>
            </div>
          )}

          {hasExistingPin && (
            <PinCodeInput
              label="বর্তমান ৪-ডিজিট পিন"
              value={currentPin}
              onChange={setCurrentPin}
              disabled={isSaving || lockSeconds > 0}
              autoFocus
              accent="amber"
            />
          )}

          <PinCodeInput
            label={hasExistingPin ? 'নতুন ৪-ডিজিট পিন' : 'নতুন ৪-ডিজিট পিন লিখুন'}
            value={newPin}
            onChange={setNewPin}
            disabled={isSaving || lockSeconds > 0}
            autoFocus={!hasExistingPin}
            accent="emerald"
            hint="শুধুমাত্র ৪টি সংখ্যা (যেমন: 4829) ব্যবহার করুন"
          />

          <PinCodeInput
            label="নতুন পিন নিশ্চিত করুন (Confirm PIN)"
            value={confirmPin}
            onChange={setConfirmPin}
            disabled={isSaving || lockSeconds > 0}
            accent="cyan"
            error={confirmPin.length === 4 && newPin !== confirmPin ? 'পিন দুটি মেলেনি!' : undefined}
          />

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {hasExistingPin && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              বর্তমান পিন ভুলে গেলে অ্যাডমিনের সাথে যোগাযোগ করে আপনার একাউন্টের পিন রিসেট করিয়ে নিতে পারবেন।
            </p>
          )}

          <button
            type="submit"
            disabled={
              isSaving ||
              lockSeconds > 0 ||
              (hasExistingPin && currentPin.length !== 4) ||
              newPin.length !== 4 ||
              confirmPin.length !== 4 ||
              newPin !== confirmPin
            }
            className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm transition-all cursor-pointer shadow-lg shadow-emerald-950"
          >
            {isSaving
              ? 'সেভ হচ্ছে...'
              : lockSeconds > 0
              ? `অপেক্ষা করুন (${lockSeconds}s)`
              : hasExistingPin
              ? 'সিকিউরিটি পিন পরিবর্তন করুন'
              : '৪-ডিজিট সিকিউরিটি পিন সেভ করুন'}
          </button>
        </form>
      </div>
    </div>
  );
};
