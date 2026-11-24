import type {
  AdSectionConfig,
  CaptchaType,
  CaptchaTypeConfig,
  EarningPlan,
  P2PConfig,
  PlanThemeColor,
  SystemSettings,
  VideoAdItem,
  WithdrawalScheduleConfig,
} from '../types';

// SHA-256 digest of the authorized administrator Google account email (never store plaintext admin email in client bundles)
const ADMIN_EMAIL_SHA256 = '57afcc0e54fca27f7781c7d88d15e55b0180465b4ca881c5110ae617c38c38e3';

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Int32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(v => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function isAuthorizedAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return sha256Hex(email.toLowerCase().trim()) === ADMIN_EMAIL_SHA256;
}

export function numOr(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function getDefaultCaptchaConfigs(
  settings?: Partial<SystemSettings>
): Record<CaptchaType, CaptchaTypeConfig> {
  return {
    text: {
      enabled: true,
      reward: numOr(settings?.rewardPerText, 2.5),
      dailyLimit: numOr(settings?.dailyFreeLimit, 25),
      timeLimitSeconds: 35,
      cooldownSeconds: 0,
    },
    math: {
      enabled: true,
      reward: numOr(settings?.rewardPerMath, 3.0),
      dailyLimit: 20,
      timeLimitSeconds: 30,
      cooldownSeconds: 0,
    },
    image_grid: {
      enabled: true,
      reward: numOr(settings?.rewardPerGrid, 4.0),
      dailyLimit: 15,
      timeLimitSeconds: 40,
      cooldownSeconds: 0,
    },
    slider: {
      enabled: true,
      reward: numOr(settings?.rewardPerSlider, 5.0),
      dailyLimit: 15,
      timeLimitSeconds: 25,
      cooldownSeconds: 0,
    },
  };
}

export function getDefaultAdConfig(): AdSectionConfig {
  return {
    enabled: true,
    reward: 5.0,
    minWatchSeconds: 10,
    dailyLimit: 15,
    cooldownSeconds: 5,
  };
}

export function getDefaultVideoAds(): VideoAdItem[] {
  return [];
}

export function getDhakaDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getDefaultEarningPlans(): EarningPlan[] {
  return [
    {
      id: 'plan-500',
      name: 'স্টার্টার প্ল্যান (৳৫০০)',
      price: 500,
      dailyIncome: 35,
      durationDays: 30,
      badge: 'শুরু করুন',
      description: 'নতুনদের জন্য সেরা ডেইলি ইনকাম প্যাকেজ। প্রতিদিন ক্লেইম করে নিশ্চিত আয় করুন।',
      color: 'emerald',
      enabled: true,
      sortOrder: 1,
    },
    {
      id: 'plan-1000',
      name: 'প্রিমিয়াম প্ল্যান (৳১,০০০)',
      price: 1000,
      dailyIncome: 75,
      durationDays: 30,
      badge: 'সবচেয়ে জনপ্রিয়',
      description: 'সর্বাধিক জনপ্রিয় ডেইলি আর্নিং প্ল্যান। বেশি দৈনিক রিটার্ন ও দ্রুত লাভ।',
      color: 'amber',
      enabled: true,
      sortOrder: 2,
    },
    {
      id: 'plan-1500',
      name: 'ভিআইপি গোল্ড প্ল্যান (৳১,৫০০)',
      price: 1500,
      dailyIncome: 120,
      durationDays: 30,
      badge: 'সর্বোচ্চ আয়',
      description: 'সর্বোচ্চ দৈনিক মুনাফার ভিআইপি প্ল্যান। প্রতিদিন ইনস্ট্যান্ট ব্যালেন্সে যোগ হবে।',
      color: 'purple',
      enabled: true,
      sortOrder: 3,
    },
  ];
}

export function getDefaultP2PConfig(): P2PConfig {
  return {
    enabled: true,
    minAmount: 20,
    maxAmount: 10000,
    feePercent: 2,
  };
}

export function getDefaultWithdrawalSchedule(): WithdrawalScheduleConfig {
  return {
    enabled: false,
    startTime: '09:00',
    endTime: '22:00',
    closedDays: [5], // Friday default when enabled
    holidayMode: false,
    holidayMessage: 'শুক্রবার সাপ্তাহিক ছুটি ও নির্ধারিত সময়ের বাইরে উইথড্র বন্ধ থাকে।',
  };
}

export function getDefaultSettings(): SystemSettings {
  return {
    adminEmail: '',
    minWithdrawal: 100,
    rewardPerText: 2.5,
    rewardPerMath: 3.0,
    rewardPerGrid: 4.0,
    rewardPerSlider: 5.0,
    dailyFreeLimit: 25,
    dailySilverLimit: 60,
    dailyGoldLimit: 150,
    dailyDiamondLimit: 9999,
    useVipMultiplier: false,
    captchaConfigs: getDefaultCaptchaConfigs(),
    adConfig: getDefaultAdConfig(),
    videoAds: getDefaultVideoAds(),
    earningPlans: getDefaultEarningPlans(),
    p2pConfig: getDefaultP2PConfig(),
    withdrawalSchedule: getDefaultWithdrawalSchedule(),
    paymentNumbers: {
      bkash: { number: '01712-345678', accountType: 'Merchant', actionType: 'Send Money', enabled: true, logoUrl: '' },
      nagad: { number: '01898-765432', accountType: 'Agent', actionType: 'Cash In', enabled: true, logoUrl: '' },
      rocket: { number: '01911-223344', accountType: 'Personal', actionType: 'Send Money', enabled: true, logoUrl: '' },
      binance: { number: 'captchapay-usdt', accountType: 'Merchant', actionType: 'Deposit', enabled: true, logoUrl: '' },
      bankName: 'Islami Bank Bangladesh Ltd',
      bankAccount: '2050 1234 5678 9001 (Branch: Motijheel)',
    },
    operatorLogos: {
      Grameenphone: '',
      Banglalink: '',
      Robi: '',
      Airtel: '',
      Teletalk: '',
    },
    notice:
      'স্বাগতম! প্রতি ক্যাপচা পূরণ করে টাকা আয় করুন। বিকাশ, নগদ ও রকেটে দ্রুত পেমেন্ট দেওয়া হয়। সাপোর্ট ২৪/৭ চালু আছে।',
    isMaintenance: false,
  };
}

export function normalizeSettings(raw?: Partial<SystemSettings> | null): SystemSettings {
  const defaults = getDefaultSettings();
  const saved = raw || {};
  const defaultConfigs = getDefaultCaptchaConfigs(saved);
  const savedConfigs = saved.captchaConfigs || ({} as Partial<Record<CaptchaType, CaptchaTypeConfig>>);
  const defaultAdCfg = getDefaultAdConfig();
  const savedAdCfg = saved.adConfig || ({} as Partial<AdSectionConfig>);
  const rawSavedAds = Array.isArray(saved.videoAds) ? saved.videoAds : [];
  const seenAdIds = new Set<string>();
  const savedVideoAds = rawSavedAds.filter(v => {
    if (!v || !v.id || v.id === 'ad-default-1' || seenAdIds.has(v.id)) return false;
    seenAdIds.add(v.id);
    return true;
  });

  const defaultP2P = getDefaultP2PConfig();
  const savedP2P = saved.p2pConfig || ({} as Partial<P2PConfig>);
  const defaultSchedule = getDefaultWithdrawalSchedule();
  const savedSchedule = saved.withdrawalSchedule || ({} as Partial<WithdrawalScheduleConfig>);

  return {
    ...defaults,
    ...saved,
    adminEmail: '',
    minWithdrawal: numOr(saved.minWithdrawal, defaults.minWithdrawal),
    rewardPerText: numOr(saved.rewardPerText, defaults.rewardPerText),
    rewardPerMath: numOr(saved.rewardPerMath, defaults.rewardPerMath),
    rewardPerGrid: numOr(saved.rewardPerGrid, defaults.rewardPerGrid),
    rewardPerSlider: numOr(saved.rewardPerSlider, defaults.rewardPerSlider),
    dailyFreeLimit: numOr(saved.dailyFreeLimit, defaults.dailyFreeLimit),
    dailySilverLimit: numOr(saved.dailySilverLimit, defaults.dailySilverLimit ?? 60),
    dailyGoldLimit: numOr(saved.dailyGoldLimit, defaults.dailyGoldLimit ?? 150),
    dailyDiamondLimit: numOr(saved.dailyDiamondLimit, defaults.dailyDiamondLimit ?? 9999),
    useVipMultiplier: Boolean(saved.useVipMultiplier),
    captchaConfigs: {
      text: { ...defaultConfigs.text, ...(savedConfigs.text || {}) },
      math: { ...defaultConfigs.math, ...(savedConfigs.math || {}) },
      image_grid: { ...defaultConfigs.image_grid, ...(savedConfigs.image_grid || {}) },
      slider: { ...defaultConfigs.slider, ...(savedConfigs.slider || {}) },
    },
    adConfig: {
      enabled: savedAdCfg.enabled ?? defaultAdCfg.enabled,
      reward: Math.max(0, numOr(savedAdCfg.reward, defaultAdCfg.reward)),
      minWatchSeconds: Math.max(3, numOr(savedAdCfg.minWatchSeconds, defaultAdCfg.minWatchSeconds)),
      dailyLimit: Math.max(0, numOr(savedAdCfg.dailyLimit, defaultAdCfg.dailyLimit)),
      cooldownSeconds: Math.max(0, numOr(savedAdCfg.cooldownSeconds, defaultAdCfg.cooldownSeconds)),
    },
    videoAds: savedVideoAds,
    earningPlans: Array.isArray(saved.earningPlans)
      ? saved.earningPlans
          .filter(p => p && typeof p === 'object' && String(p.id || '').trim() !== '')
          .slice(0, 50)
          .map((p, idx) => {
            const validColors: PlanThemeColor[] = ['emerald', 'amber', 'rose', 'cyan', 'purple'];
            const color = validColors.includes(p.color as PlanThemeColor)
              ? (p.color as PlanThemeColor)
              : 'emerald';
            return {
              id: String(p.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `plan-${idx + 1}`,
              name: String(p.name || 'ইনকাম প্ল্যান').slice(0, 120),
              price: Math.max(10, Math.min(1000000, numOr(p.price, 500))),
              dailyIncome: Math.max(1, Math.min(50000, numOr(p.dailyIncome, 35))),
              durationDays: Math.max(1, Math.min(3650, Math.floor(numOr(p.durationDays, 30)))),
              badge: typeof p.badge === 'string' ? p.badge.slice(0, 40) : '',
              description: typeof p.description === 'string' ? p.description.slice(0, 300) : '',
              color,
              enabled: p.enabled !== false,
              sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : idx + 1,
              createdAt: typeof p.createdAt === 'string' ? p.createdAt.slice(0, 64) : undefined,
            };
          })
      : getDefaultEarningPlans(),
    p2pConfig: {
      enabled: savedP2P.enabled ?? defaultP2P.enabled,
      minAmount: Math.max(10, numOr(savedP2P.minAmount, defaultP2P.minAmount)),
      maxAmount: Math.min(50000, Math.max(10, numOr(savedP2P.maxAmount, defaultP2P.maxAmount))),
      feePercent: Math.min(25, Math.max(0, numOr(savedP2P.feePercent, defaultP2P.feePercent))),
    },
    withdrawalSchedule: {
      enabled: Boolean(savedSchedule.enabled),
      startTime:
        typeof savedSchedule.startTime === 'string' && /^\d{2}:\d{2}$/.test(savedSchedule.startTime)
          ? savedSchedule.startTime
          : defaultSchedule.startTime,
      endTime:
        typeof savedSchedule.endTime === 'string' && /^\d{2}:\d{2}$/.test(savedSchedule.endTime)
          ? savedSchedule.endTime
          : defaultSchedule.endTime,
      closedDays: Array.isArray(savedSchedule.closedDays)
        ? savedSchedule.closedDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
        : defaultSchedule.closedDays,
      holidayMode: Boolean(savedSchedule.holidayMode),
      holidayMessage:
        typeof savedSchedule.holidayMessage === 'string'
          ? savedSchedule.holidayMessage.slice(0, 300)
          : defaultSchedule.holidayMessage,
    },
    paymentNumbers: {
      bkash: typeof (saved.paymentNumbers as any)?.bkash === 'string'
        ? { number: (saved.paymentNumbers as any).bkash, accountType: 'Merchant', actionType: 'Send Money', enabled: true, logoUrl: '' }
        : { ...(defaults.paymentNumbers.bkash as any), ...((saved.paymentNumbers as any)?.bkash || {}) },
      nagad: typeof (saved.paymentNumbers as any)?.nagad === 'string'
        ? { number: (saved.paymentNumbers as any).nagad, accountType: 'Agent', actionType: 'Cash In', enabled: true, logoUrl: '' }
        : { ...(defaults.paymentNumbers.nagad as any), ...((saved.paymentNumbers as any)?.nagad || {}) },
      rocket: typeof (saved.paymentNumbers as any)?.rocket === 'string'
        ? { number: (saved.paymentNumbers as any).rocket, accountType: 'Personal', actionType: 'Send Money', enabled: true, logoUrl: '' }
        : { ...(defaults.paymentNumbers.rocket as any), ...((saved.paymentNumbers as any)?.rocket || {}) },
      binance: typeof (saved.paymentNumbers as any)?.binance === 'string'
        ? { number: (saved.paymentNumbers as any).binance, accountType: 'Merchant', actionType: 'Deposit', enabled: true, logoUrl: '' }
        : { ...(defaults.paymentNumbers.binance as any), ...((saved.paymentNumbers as any)?.binance || {}) },
      bankName: typeof (saved.paymentNumbers as any)?.bankName === 'string' ? (saved.paymentNumbers as any).bankName : (defaults.paymentNumbers as any).bankName,
      bankAccount: typeof (saved.paymentNumbers as any)?.bankAccount === 'string' ? (saved.paymentNumbers as any).bankAccount : (defaults.paymentNumbers as any).bankAccount,
    },
    operatorLogos: {
      Grameenphone: typeof saved.operatorLogos?.Grameenphone === 'string' ? saved.operatorLogos.Grameenphone : '',
      Banglalink: typeof saved.operatorLogos?.Banglalink === 'string' ? saved.operatorLogos.Banglalink : '',
      Robi: typeof saved.operatorLogos?.Robi === 'string' ? saved.operatorLogos.Robi : '',
      Airtel: typeof saved.operatorLogos?.Airtel === 'string' ? saved.operatorLogos.Airtel : '',
      Teletalk: typeof saved.operatorLogos?.Teletalk === 'string' ? saved.operatorLogos.Teletalk : '',
      ...(saved.operatorLogos || {}),
    },
    notice: typeof saved.notice === 'string' ? saved.notice : defaults.notice,
    isMaintenance: Boolean(saved.isMaintenance),
    announcements: Array.isArray(saved.announcements) ? saved.announcements.map((a: any) => ({
      id: String(a?.id || 'ann-' + Math.random()),
      title: String(a?.title || '').slice(0, 200),
      body: String(a?.body || '').slice(0, 1000),
      createdAt: String(a?.createdAt || new Date().toLocaleString('bn-BD')).slice(0, 64),
    })) : [],
  };
}
