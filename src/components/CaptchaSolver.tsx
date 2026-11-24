import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { solveCaptchaTransaction } from '../lib/dbService';
import { getDefaultSettings } from '../lib/defaults';
import { 
  getRandomCaptcha, 
  generateTextCaptcha, 
  generateMathCaptcha, 
  generateGridCaptcha, 
  generateSliderCaptcha,
  GridTile
} from '../data/captchaGenerators';
import type { CaptchaChallenge, CaptchaType, VipTier } from '../types';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Sparkles, 
  Crown, 
  Coins, 
  ShieldCheck,
  Car,
  Trees,
  Bus,
  Laptop,
  Truck,
  Flower2,
  Bike,
  Utensils,
  Smartphone,
  Mountain
} from 'lucide-react';

interface CaptchaSolverProps {
  onOpenRecharge: () => void;
  onOpenWithdraw: () => void;
}

export const CaptchaSolver: React.FC<CaptchaSolverProps> = ({
  onOpenRecharge,
  onOpenWithdraw
}) => {
  const { user, settings, refreshUser, applyUser, showToast, setIsLoginModalOpen } = useAuth();
  const [activeType, setActiveType] = useState<CaptchaType>('text');
  const [challenge, setChallenge] = useState<any>(() => generateTextCaptcha());
  const [userInput, setUserInput] = useState('');
  const [selectedGridIndices, setSelectedGridIndices] = useState<number[]>([]);
  const [sliderPosition, setSliderPosition] = useState(0);
  const [timeLeft, setTimeLeft] = useState(35);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [rewardBanner, setRewardBanner] = useState<number | null>(null);
  const [streakCount, setStreakCount] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Play pleasant chime on correct captcha
  const playRewardAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Audio not permitted or supported
    }
  };

  // Safe numeric parser
  const safeNum = (val: unknown, fallback: number): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };

  // Helper to get per-type config with fallbacks
  const getTypeConfig = (type: CaptchaType) => {
    const configs = settings?.captchaConfigs;
    if (configs && configs[type]) {
      return {
        ...configs[type],
        cooldownSeconds: safeNum(configs[type].cooldownSeconds, 0)
      };
    }
    if (type === 'text') {
      return { enabled: true, reward: safeNum(settings?.rewardPerText, 2.5), dailyLimit: safeNum(settings?.dailyFreeLimit, 25), timeLimitSeconds: 35, cooldownSeconds: 0 };
    }
    if (type === 'math') {
      return { enabled: true, reward: safeNum(settings?.rewardPerMath, 3.0), dailyLimit: 20, timeLimitSeconds: 30, cooldownSeconds: 0 };
    }
    if (type === 'image_grid') {
      return { enabled: true, reward: safeNum(settings?.rewardPerGrid, 4.0), dailyLimit: 15, timeLimitSeconds: 40, cooldownSeconds: 0 };
    }
    return { enabled: true, reward: safeNum(settings?.rewardPerSlider, 5.0), dailyLimit: 15, timeLimitSeconds: 25, cooldownSeconds: 0 };
  };

  const allTypes: CaptchaType[] = ['text', 'math', 'image_grid', 'slider'];
  const enabledTypes = allTypes.filter(t => getTypeConfig(t).enabled !== false);

  // Generate new challenge
  const loadNewChallenge = (type: CaptchaType = activeType) => {
    setUserInput('');
    setSelectedGridIndices([]);
    setSliderPosition(0);
    setRewardBanner(null);

    let newChall: any;
    if (type === 'text') newChall = generateTextCaptcha();
    else if (type === 'math') newChall = generateMathCaptcha();
    else if (type === 'image_grid') newChall = generateGridCaptcha();
    else newChall = generateSliderCaptcha();

    const cfg = getTypeConfig(type);
    const configuredSeconds = safeNum(cfg?.timeLimitSeconds, newChall.timeLimitSeconds || 30);
    setChallenge(newChall);
    setTimeLeft(configuredSeconds);
  };

  // Auto-switch if activeType gets turned off in real time by admin
  useEffect(() => {
    if (enabledTypes.length > 0 && !enabledTypes.includes(activeType)) {
      const nextType = enabledTypes[0];
      setActiveType(nextType);
      setTimeout(() => {
        loadNewChallenge(nextType);
      }, 0);
    }
  }, [settings, activeType]);

  // Compute remaining cooldown whenever user, activeType, or settings change
  useEffect(() => {
    const cfg = getTypeConfig(activeType);
    const cooldownSec = Math.max(0, safeNum(cfg.cooldownSeconds, 0));
    const lastSolvedMs = user?.lastSolvedAtByType?.[activeType] || 0;

    if (cooldownSec <= 0 || lastSolvedMs <= 0) {
      setCooldownLeft(0);
      return;
    }

    const calcRemaining = () => {
      const elapsed = (Date.now() - lastSolvedMs) / 1000;
      const rem = Math.ceil(cooldownSec - elapsed);
      return rem > 0 ? rem : 0;
    };

    const initialRem = calcRemaining();
    setCooldownLeft(initialRem);
    if (initialRem <= 0) return;

    const interval = setInterval(() => {
      const rem = calcRemaining();
      setCooldownLeft(rem);
      if (rem <= 0) {
        clearInterval(interval);
        loadNewChallenge(activeType);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [activeType, user?.lastSolvedAtByType?.[activeType], settings]);

  // Switch type handler
  const handleTypeChange = (type: CaptchaType) => {
    if (getTypeConfig(type).enabled === false) return;
    setActiveType(type);
    loadNewChallenge(type);
  };

  // Timer countdown (paused when disabled, no enabled types, or waiting in cooldown)
  useEffect(() => {
    if (enabledTypes.length === 0 || getTypeConfig(activeType).enabled === false || cooldownLeft > 0) {
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setTimeout(() => {
            loadNewChallenge();
            showToast('সময় শেষ! নতুন ক্যাপচা লোড করা হয়েছে।', 'info');
          }, 0);
          return safeNum(getTypeConfig(activeType).timeLimitSeconds, 30);
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [challenge.id, activeType, settings, cooldownLeft, enabledTypes.length]);

  // Draw heavily blurred, warped, high-interference text or math captcha on canvas
  useEffect(() => {
    if ((challenge.type !== 'text' && challenge.type !== 'math') || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const text = challenge.type === 'math' ? (challenge.expression || '') : challenge.solution;

    ctx.clearRect(0, 0, w, h);

    // 1. Dark murky smoky background gradient
    const bgGradient = ctx.createLinearGradient(0, 0, w, h);
    bgGradient.addColorStop(0, '#090d16');
    bgGradient.addColorStop(0.5, '#171f2e');
    bgGradient.addColorStop(1, '#0b1220');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, w, h);

    // 2. Soft foggy blotches (partial haze)
    for (let i = 0; i < 14; i++) {
      const bx = Math.random() * w;
      const by = Math.random() * h;
      const br = Math.random() * 40 + 16;
      const rg = ctx.createRadialGradient(bx, by, 2, bx, by, br);
      const tone = Math.floor(Math.random() * 75 + 75);
      rg.addColorStop(0, `rgba(${tone}, ${tone + 15}, ${tone + 35}, 0.16)`);
      rg.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    // 3. Subtle faint decoy ghost characters in background
    const decoyChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789+-×';
    for (let i = 0; i < 7; i++) {
      ctx.save();
      ctx.translate(Math.random() * w, Math.random() * h);
      ctx.rotate((Math.random() - 0.5) * 1.1);
      ctx.font = `${Math.floor(Math.random() * 10 + 14)}px monospace`;
      ctx.fillStyle = `rgba(148, 163, 184, ${Math.random() * 0.08 + 0.05})`;
      ctx.fillText(decoyChars[Math.floor(Math.random() * decoyChars.length)], 0, 0);
      ctx.restore();
    }

    // 4. Offscreen canvas: ~80% hazy halo + ~20% readable core strokes
    const offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    const offCtx = offCanvas.getContext('2d');

    if (offCtx && text.length > 0) {
      const fonts = [
        'bold 36px "JetBrains Mono", monospace',
        'bold 37px Georgia, serif',
        'bold 35px "Courier New", monospace',
        'bold 36px "Trebuchet MS", sans-serif',
      ];
      const colors = ['#cbd5e1', '#6ee7b7', '#7dd3fc', '#fde68a', '#f9a8d4', '#c4b5fd'];

      const paddingX = 28;
      const charSpacing = (w - paddingX * 2) / Math.max(text.length, 1);

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const x = paddingX + i * charSpacing + (Math.random() * 6 - 3);
        const y = h / 2 + (Math.random() * 10 - 5);
        const angle = (Math.random() - 0.5) * 0.44;
        const skewX = (Math.random() - 0.5) * 0.24;
        const skewY = (Math.random() - 0.5) * 0.14;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const font = fonts[Math.floor(Math.random() * fonts.length)];

        offCtx.save();
        offCtx.translate(x, y);
        offCtx.rotate(angle);
        offCtx.transform(1, skewY, skewX, 1, 0, 0);
        offCtx.font = font;

        // Pass 1: Heavy outer blur/haze (~80% blurry aura)
        offCtx.filter = 'blur(1.4px)';
        offCtx.globalAlpha = 0.72;
        offCtx.fillStyle = color;
        offCtx.shadowColor = 'rgba(226, 232, 240, 0.35)';
        offCtx.shadowBlur = 7;
        offCtx.fillText(char, -2, 11);

        // Pass 2: Subtle ~20% discernible inner core so careful human eyes can recognize each character
        offCtx.filter = 'blur(0.25px)';
        offCtx.globalAlpha = 0.62;
        offCtx.shadowBlur = 0;
        offCtx.fillText(char, -2, 11);
        offCtx.restore();
      }

      // 5. Gentle sinusoidal wave warp (keeps shapes identifiable while breaking straight bot lines)
      const srcData = offCtx.getImageData(0, 0, w, h);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        const dstData = tempCtx.createImageData(w, h);
        const phase1 = Math.random() * Math.PI * 2;
        const phase2 = Math.random() * Math.PI * 2;
        const ampX = 2.2 + Math.random() * 1.1;
        const ampY = 1.8 + Math.random() * 0.9;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const srcX = Math.round(x + Math.sin(y * 0.11 + phase1) * ampX);
            const srcY = Math.round(y + Math.cos(x * 0.07 + phase2) * ampY);
            if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
              const sIdx = (srcY * w + srcX) * 4;
              const dIdx = (y * w + x) * 4;
              dstData.data[dIdx] = srcData.data[sIdx];
              dstData.data[dIdx + 1] = srcData.data[sIdx + 1];
              dstData.data[dIdx + 2] = srcData.data[sIdx + 2];
              dstData.data[dIdx + 3] = srcData.data[sIdx + 3];
            }
          }
        }
        tempCtx.putImageData(dstData, 0, 0);

        ctx.save();
        ctx.filter = 'blur(0.35px)';
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
      }
    }

    // 6. Balanced crossing interference curves over the text
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(${Math.floor(Math.random() * 110 + 115)}, ${Math.floor(
        Math.random() * 110 + 125
      )}, ${Math.floor(Math.random() * 120 + 130)}, ${Math.random() * 0.22 + 0.18})`;
      ctx.lineWidth = Math.random() * 1.1 + 0.7;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w * 0.2, Math.random() * h);
      ctx.bezierCurveTo(
        Math.random() * w,
        Math.random() * h,
        Math.random() * w,
        Math.random() * h,
        w * (0.8 + Math.random() * 0.2),
        Math.random() * h
      );
      ctx.stroke();
    }

    // 7. Moderate salt-and-pepper static noise over the image
    for (let i = 0; i < 115; i++) {
      const bright = Math.random() > 0.55;
      ctx.fillStyle = bright
        ? `rgba(226, 232, 240, ${Math.random() * 0.26 + 0.08})`
        : `rgba(15, 23, 42, ${Math.random() * 0.42 + 0.15})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 1.4 + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [challenge, cooldownLeft, activeType]);

  // Submit and verify solution
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    if (cooldownLeft > 0) {
      showToast(`নতুন ক্যাপচা আসতে আরও ${cooldownLeft} সেকেন্ড অপেক্ষা করুন`, 'info');
      return;
    }

    let isCorrect = false;

    if (challenge.type === 'text') {
      isCorrect = userInput.trim().toLowerCase() === challenge.solution.toLowerCase();
    } else if (challenge.type === 'math') {
      isCorrect = userInput.trim() === challenge.solution.trim();
    } else if (challenge.type === 'image_grid') {
      const correctIndices: number[] = challenge.correctIndices || [];
      const sortedSelected = [...selectedGridIndices].sort();
      const sortedCorrect = [...correctIndices].sort();
      isCorrect =
        sortedSelected.length === sortedCorrect.length &&
        sortedSelected.every((val, index) => val === sortedCorrect[index]);
    } else if (challenge.type === 'slider') {
      const target = Number(challenge.solution);
      // Tolerance ±3%
      isCorrect = Math.abs(sliderPosition - target) <= 3;
    }

    if (!isCorrect) {
      showToast('ভুল সমাধান! দয়া করে আবার চেষ্টা করুন।', 'error');
      setStreakCount(0);
      loadNewChallenge();
      return;
    }

    const tierMultipliers: Record<VipTier, number> = {
      free: 1.0,
      silver: 1.4,
      gold: 2.0,
      diamond: 3.2
    };
    const applyMultiplier = Boolean(settings?.useVipMultiplier);
    const multiplier = applyMultiplier ? (tierMultipliers[user.vipTier] || 1.0) : 1.0;
    const baseReward = Math.max(0, safeNum(getTypeConfig(challenge.type).reward, 2.5));
    const earnedAmount = Math.round(baseReward * multiplier * 100) / 100;

    setIsVerifying(true);
    try {
      const data = await solveCaptchaTransaction({
        uid: user.id,
        captchaType: challenge.type,
        settings: settings || getDefaultSettings(),
      });

      playRewardAudio();
      const actualEarned = typeof data.earned === 'number' ? data.earned : earnedAmount;
      setRewardBanner(actualEarned);
      setStreakCount(prev => prev + 1);
      showToast(`সঠিক সমাধান! +৳${actualEarned.toFixed(2)} আয় যোগ হয়েছে!`, 'success');
      applyUser(data.user);

      const configuredCooldown = Math.max(0, safeNum(data.cooldownSeconds ?? getTypeConfig(challenge.type).cooldownSeconds, 0));
      if (configuredCooldown > 0) {
        setCooldownLeft(configuredCooldown);
        setIsVerifying(false);
      } else {
        setTimeout(() => {
          loadNewChallenge();
          setIsVerifying(false);
        }, 800);
      }
    } catch (err: unknown) {
      const typedErr = err as Error & { cooldownRemaining?: number };
      if (typeof typedErr?.cooldownRemaining === 'number' && typedErr.cooldownRemaining > 0) {
        setCooldownLeft(typedErr.cooldownRemaining);
      }
      showToast(typedErr?.message || 'ক্যাপচা ভেরিফিকেশন ব্যর্থ হয়েছে', 'error');
      setIsVerifying(false);
    }
  };

  // Render tile icon (subtle murky colors for blurry challenge)
  const renderTileIcon = (icon: string) => {
    switch (icon) {
      case 'car':
        return <Car className="w-10 h-10 text-slate-300" />;
      case 'tree':
        return <Trees className="w-10 h-10 text-slate-300" />;
      case 'bus':
        return <Bus className="w-10 h-10 text-slate-300" />;
      case 'laptop':
        return <Laptop className="w-10 h-10 text-slate-300" />;
      case 'truck':
        return <Truck className="w-10 h-10 text-slate-300" />;
      case 'flower':
        return <Flower2 className="w-10 h-10 text-slate-300" />;
      case 'bike':
        return <Bike className="w-10 h-10 text-slate-300" />;
      case 'burger':
        return <Utensils className="w-10 h-10 text-slate-300" />;
      case 'phone':
        return <Smartphone className="w-10 h-10 text-slate-300" />;
      case 'mountain':
        return <Mountain className="w-10 h-10 text-slate-300" />;
      default:
        return <Car className="w-10 h-10 text-slate-300" />;
    }
  };

  const activeTypeConfig = getTypeConfig(activeType);
  const typeLabels: Record<CaptchaType, string> = {
    text: 'টেক্সট ক্যাপচা',
    math: 'ম্যাথ ক্যাপচা',
    image_grid: 'গ্রিড নির্বাচন',
    slider: 'স্লাইডার পাজল'
  };

  const getActiveRate = (type: CaptchaType) => {
    return safeNum(getTypeConfig(type).reward, 2.5);
  };

  const currentTypeLimit = safeNum(activeTypeConfig.dailyLimit, 25);
  const cooldownSeconds = Math.max(0, safeNum(activeTypeConfig.cooldownSeconds, 0));
  const solvedForActiveType = user?.solvedTodayByType?.[activeType] ?? 0;
  const totalSolvedToday = user?.captchasSolvedToday || 0;
  const isTypeDisabled = activeTypeConfig.enabled === false;
  const isCustomLimitReached = Boolean(user && user.customDailyLimit !== undefined && user.customDailyLimit < 9999 && totalSolvedToday >= user.customDailyLimit);
  const isTypeLimitReached = Boolean(user && currentTypeLimit < 9999 && solvedForActiveType >= currentTypeLimit);
  const isLimitReached = isTypeDisabled || isTypeLimitReached || isCustomLimitReached;

  const activeRate = getActiveRate(activeType);
  const applyMultiplier = Boolean(settings?.useVipMultiplier);
  const activeMultiplier = applyMultiplier && user
    ? (user.vipTier === 'diamond' ? 3.2 : user.vipTier === 'gold' ? 2.0 : user.vipTier === 'silver' ? 1.4 : 1.0)
    : 1.0;
  const displayReward = Math.max(0, Math.round(activeRate * activeMultiplier * 100) / 100);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Live Real-Time User Account Summary Strip */}
      {user && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-emerald-500/25">
            <span className="text-[11px] text-slate-400 block mb-1">বর্তমান ব্যালেন্স</span>
            <span className="text-lg sm:text-xl font-extrabold font-mono text-emerald-400 tabular-nums">
              ৳{user.balance.toFixed(2)}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">মোট আয়</span>
            <span className="text-lg sm:text-xl font-extrabold font-mono text-white tabular-nums">
              ৳{user.totalEarned.toFixed(2)}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">{typeLabels[activeType]} লিমিট</span>
            <span className="text-lg sm:text-xl font-extrabold font-mono text-cyan-400 tabular-nums">
              {solvedForActiveType} / {currentTypeLimit >= 9999 ? 'আনলিমিটেড' : currentTypeLimit}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">প্রতি {typeLabels[activeType]}</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg sm:text-xl font-extrabold font-mono text-amber-400 tabular-nums">
                ৳{displayReward.toFixed(2)}
              </span>
              {activeMultiplier > 1 && (
                <span className="text-[10px] text-slate-400 font-mono">
                  (বেস ৳{activeRate.toFixed(2)} × {activeMultiplier}x)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Banner / Announcement */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-900 border border-emerald-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">প্রতি ক্যাপচায় নিশ্চিত আয়!</span>
              {user && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                  সক্রিয় মেম্বার
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              সঠিক ক্যাপচা সমাধান করলেই সরাসরি ব্যালেন্সে টাকা জমা হবে। সর্বনিম্ন ৳{safeNum(settings?.minWithdrawal, 100)} হলেই বিকাশ বা নগদে উইথড্র!
            </p>
          </div>
        </div>

      </div>

      {/* Main Captcha Workstation Card */}
      {enabledTypes.length === 0 ? (
        <div className="bg-slate-900/90 border border-rose-500/30 rounded-3xl p-8 text-center shadow-2xl space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-white">বর্তমানে সকল ক্যাপচা সেকশন বন্ধ রয়েছে</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            অ্যাডমিন প্যানেল থেকে টেক্সট, ম্যাথ, গ্রিড এবং স্লাইডার ক্যাপচা সাময়িকভাবে বন্ধ রাখা হয়েছে। অ্যাডমিন চালু করলেই রিয়েল-টাইমে এখানে অপশনগুলো প্রদর্শিত হবে।
          </p>
        </div>
      ) : (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          {/* Glow accent */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Captcha Type Segmented Selector (ONLY shows enabled sections!) */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
              {enabledTypes.map(type => {
                const cfg = getTypeConfig(type);
                const tSolved = user?.solvedTodayByType?.[type] ?? 0;
                const tLimit = safeNum(cfg.dailyLimit, 25);
                const tReward = Math.max(0, Math.round(safeNum(cfg.reward, 2.5) * activeMultiplier * 100) / 100);
                return (
                  <button
                    key={type}
                    onClick={() => handleTypeChange(type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeType === type
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>{typeLabels[type]}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                      activeType === type ? 'bg-slate-950/30 text-emerald-100' : 'bg-slate-900 text-emerald-400'
                    }`}>
                      ৳{tReward.toFixed(2)}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                      activeType === type ? 'bg-slate-950/30 text-emerald-100' : 'bg-slate-900 text-slate-400'
                    }`}>
                      {tLimit >= 9999 ? `${tSolved}/∞` : `${tSolved}/${tLimit}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Timer & Streak indicator */}
            <div className="flex items-center gap-3">
              {streakCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-amber-400 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{streakCount}x স্ট্রিক বোনাস!</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>{cooldownLeft > 0 ? `বিরতি: ${cooldownLeft}s` : `${timeLeft}s`}</span>
              </div>
            </div>
          </div>

          {/* Daily Quota Progress & Real-time Section Info */}
          <div className="pt-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-1.5">
              <span>
                আজকের {typeLabels[activeType]} পূরণ:{' '}
                <strong className="text-white font-mono tabular-nums">
                  {user ? solvedForActiveType : 0} / {currentTypeLimit >= 9999 ? 'আনলিমিটেড' : currentTypeLimit}
                </strong>
                {user?.customDailyLimit !== undefined && (
                  <span className="ml-2 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                    মোট কাস্টম সীমা: {totalSolvedToday}/{user.customDailyLimit}
                  </span>
                )}
              </span>
              <span className="text-emerald-400 font-medium">
                প্রতি ক্যাপচা: ৳{displayReward.toFixed(2)} · বিরতি: {cooldownSeconds === 0 ? 'তাৎক্ষণিক' : `${cooldownSeconds}s পরপর`} · সময়: {activeTypeConfig.timeLimitSeconds}s
              </span>
            </div>
            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${currentTypeLimit >= 9999 ? Math.min(100, solvedForActiveType) : currentTypeLimit <= 0 ? 100 : Math.min(100, (solvedForActiveType / currentTypeLimit) * 100)}%`
                }}
              />
            </div>
          </div>

          {/* Limit Warning if reached */}
          {isLimitReached && (
            <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <span>
                {isCustomLimitReached
                  ? `আপনার ব্যক্তিগত মোট দৈনিক লিমিট (${user?.customDailyLimit} টি) পূর্ণ হয়েছে!`
                  : `আপনার আজকের ${typeLabels[activeType]} লিমিট (${currentTypeLimit} টি) পূর্ণ হয়েছে! অন্য ক্যাপচা টাইপ সমাধান করুন।`}
              </span>
            </div>
          )}

          {/* Cooldown Wait Screen OR Active Captcha Challenge */}
          {cooldownLeft > 0 ? (
            <div className="my-8 p-8 rounded-2xl bg-slate-950 border border-cyan-500/30 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
                <Clock className="w-6 h-6 animate-spin" />
              </div>
              <h3 className="text-base font-bold text-white">
                পরবর্তী নতুন {typeLabels[activeType]} আসছে...
              </h3>
              <div className="text-3xl font-extrabold font-mono text-cyan-400 tabular-nums">
                {cooldownLeft} সেকেন্ড
              </div>
              <p className="text-xs text-slate-400">
                অ্যাডমিন নির্ধারিত বিরতি ({cooldownSeconds} সেকেন্ড) শেষে স্বয়ংক্রিয়ভাবে নতুন ক্যাপচা চলে আসবে।
              </p>
            </div>
          ) : (
            <>
              {/* Question Title */}
              <div className="mt-6 mb-4">
                <h3 className="text-base font-semibold text-white tracking-tight">{challenge.question}</h3>
                {challenge.hint && (
                  <p className="text-xs text-slate-400 mt-1">{challenge.hint}</p>
                )}
              </div>

              {/* Active Challenge Canvas / Interactive Component */}
              <div className="my-6">
                {/* 1. Text Captcha Display */}
                {challenge.type === 'text' && (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 shadow-inner select-none">
                      <canvas
                        ref={canvasRef}
                        width={340}
                        height={120}
                        className="block w-full max-w-[340px] h-[120px]"
                      />
                    </div>

                    <div className="flex sm:flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => loadNewChallenge('text')}
                        className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700 flex items-center gap-1.5 text-xs"
                        title="নতুন ক্যাপচা কোড"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span className="sm:hidden">বদলান</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. Math Challenge Display (Rendered on Blurry Distorted Canvas) */}
                {challenge.type === 'math' && (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 shadow-inner select-none">
                      <canvas
                        ref={canvasRef}
                        width={340}
                        height={120}
                        className="block w-full max-w-[340px] h-[120px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => loadNewChallenge('math')}
                      className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700 flex items-center gap-1.5 text-xs"
                      title="নতুন ম্যাথ"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span className="sm:hidden">বদলান</span>
                    </button>
                  </div>
                )}

                {/* 3. Image Grid Selection Display (Hazy Icons without Text Labels) */}
                {challenge.type === 'image_grid' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
                      {challenge.tiles.map((tile: GridTile, idx: number) => {
                        const isSelected = selectedGridIndices.includes(idx);
                        const rotDeg = ((tile.id * 29 + idx * 41) % 28) - 14;
                        return (
                          <button
                            key={tile.id + '-' + idx}
                            type="button"
                            onClick={() => {
                              setSelectedGridIndices(prev =>
                                prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
                              );
                            }}
                            className={`relative aspect-square rounded-2xl border flex flex-col items-center justify-center p-2 overflow-hidden transition-all cursor-pointer select-none ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-950/40 ring-2 ring-emerald-500/50 scale-95'
                                : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900'
                            }`}
                          >
                            <div
                              className="blur-[1.1px] opacity-80 contrast-90"
                              style={{ transform: `rotate(${rotDeg}deg) scale(1.02)` }}
                            >
                              {renderTileIcon(tile.icon)}
                            </div>

                            {/* Interference SVG Scratch Lines & Fog Overlay */}
                            <svg
                              viewBox="0 0 100 100"
                              className="absolute inset-0 w-full h-full pointer-events-none opacity-45"
                              aria-hidden="true"
                            >
                              <line x1="0" y1="20" x2="100" y2="85" stroke="#64748b" strokeWidth="1.8" />
                              <line x1="100" y1="15" x2="0" y2="78" stroke="#475569" strokeWidth="1.5" />
                              <circle cx="30" cy="35" r="12" fill="#1e293b" fillOpacity="0.25" />
                              <circle cx="70" cy="68" r="14" fill="#0f172a" fillOpacity="0.3" />
                            </svg>

                            {isSelected && (
                              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-md z-10">
                                <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. Interactive Slider Puzzle (Blurred & Foggy Track) */}
                {challenge.type === 'slider' && (
                  <div className="space-y-6 max-w-md mx-auto p-4 rounded-2xl bg-slate-950 border border-slate-800">
                    {/* Visual Track with Faint Blurred Target Slot */}
                    <div className="relative h-28 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden select-none">
                      <div 
                        className="absolute inset-0 bg-cover bg-center opacity-25 blur-[2px]" 
                        style={{ backgroundImage: `url('/src/assets/images/captcha_hero_banner_1794912114794.jpg')` }}
                      />

                      {/* Interference pattern over slider track */}
                      <svg viewBox="0 0 300 100" className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                        <line x1="0" y1="25" x2="300" y2="75" stroke="#475569" strokeWidth="1.5" />
                        <line x1="0" y1="80" x2="300" y2="20" stroke="#64748b" strokeWidth="1.5" />
                      </svg>

                      {/* Target Slot Silhouette (Blurred yet visible enough to align) */}
                      <div
                        className="absolute top-3 w-14 h-20 rounded-lg border border-dashed border-amber-300/45 bg-slate-950/65 blur-[1px] flex items-center justify-center"
                        style={{ left: `${challenge.targetPositionPercent}%`, transform: 'translateX(-50%)' }}
                      />

                      {/* Draggable Puzzle Piece Preview */}
                      <div
                        className="absolute top-3 w-14 h-20 rounded-lg bg-emerald-500/70 border border-emerald-300/75 shadow-xl flex items-center justify-center backdrop-blur-sm blur-[0.4px] transition-transform"
                        style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
                      >
                        <ShieldCheck className="w-6 h-6 text-slate-950/85" />
                      </div>
                    </div>

                    {/* Slider Input */}
                    <div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sliderPosition}
                        onChange={e => setSliderPosition(Number(e.target.value))}
                        className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                      <div className="flex justify-between text-xs text-slate-500 mt-2">
                        <span>বাম</span>
                        <span className="text-slate-400 font-medium">ঝাপসা খালি বক্সের সাথে মেলান</span>
                        <span>ডান</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input & Submit Form (For text and math) */}
              {(challenge.type === 'text' || challenge.type === 'math') && (
                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    autoFocus
                    disabled={isVerifying || isLimitReached}
                    placeholder={challenge.type === 'text' ? 'এখানে কোডটি লিখুন...' : 'ফলাফল লিখুন...'}
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-base placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isVerifying || !userInput.trim() || isLimitReached}
                    className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <span>{isVerifying ? 'যাচাই হচ্ছে...' : 'জমা দিন ও আয় করুন'}</span>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                  </button>
                </form>
              )}

              {/* Grid and Slider Submit Buttons */}
              {(challenge.type === 'image_grid' || challenge.type === 'slider') && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSubmit()}
                    disabled={isVerifying || isLimitReached}
                    className="w-full sm:w-auto px-8 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>{isVerifying ? 'যাচাই হচ্ছে...' : 'ভেরিফাই ও আয় গ্রহণ করুন'}</span>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                  </button>
                </div>
              )}
            </>
          )}

          {/* Instant Reward Banner Animation */}
          {rewardBanner !== null && (
            <div className="mt-4 p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center gap-2 animate-bounce">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              <span className="font-bold text-sm">
                অভিনন্দন! আপনার ব্যালেন্সে ৳{rewardBanner.toFixed(2)} যোগ করা হয়েছে!
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
