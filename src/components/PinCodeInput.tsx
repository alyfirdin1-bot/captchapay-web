import React, { useRef, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

interface PinCodeInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: string;
  hint?: string;
  accent?: 'cyan' | 'emerald' | 'amber';
}

export const PinCodeInput: React.FC<PinCodeInputProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  error,
  hint,
  accent = 'cyan',
}) => {
  const [showDigits, setShowDigits] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 4);
    onChange(digitsOnly);
  };

  const accentBorder =
    accent === 'emerald'
      ? 'border-emerald-500 ring-2 ring-emerald-500/30'
      : accent === 'amber'
      ? 'border-amber-500 ring-2 ring-amber-500/30'
      : 'border-cyan-500 ring-2 ring-cyan-500/30';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>{label}</span>
        </label>
        <button
          type="button"
          onClick={() => setShowDigits(prev => !prev)}
          className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          tabIndex={-1}
        >
          {showDigits ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{showDigits ? 'লুকান' : 'দেখুন'}</span>
        </button>
      </div>

      <div
        onClick={() => !disabled && inputRef.current?.focus()}
        className={`relative grid grid-cols-4 gap-2.5 p-2 rounded-2xl bg-slate-950 border transition-all cursor-text ${
          error
            ? 'border-rose-500/80 ring-2 ring-rose-500/20'
            : focused
            ? accentBorder
            : 'border-slate-800 hover:border-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={4}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={handleTextChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={label}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text disabled:cursor-not-allowed z-10"
        />

        {[0, 1, 2, 3].map(idx => {
          const digit = value[idx];
          const isCurrentSlot = focused && Math.min(value.length, 3) === idx && value.length < 4;
          return (
            <div
              key={idx}
              className={`h-11 rounded-xl flex items-center justify-center font-mono text-lg font-extrabold border transition-all ${
                digit
                  ? 'bg-slate-900 border-slate-700 text-white'
                  : isCurrentSlot
                  ? 'bg-slate-900/70 border-cyan-500/60 text-slate-500'
                  : 'bg-slate-900/40 border-slate-800/80 text-slate-600'
              }`}
            >
              {digit ? (showDigits ? digit : '●') : isCurrentSlot ? '|' : '–'}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="text-[11px] font-medium text-rose-400">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
};
