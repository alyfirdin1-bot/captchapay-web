import type { WithdrawalScheduleConfig } from '../types';

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

export const DAY_NAMES_BN = [
  'রবিবার',
  'সোমবার',
  'মঙ্গলবার',
  'বুধবার',
  'বৃহস্পতিবার',
  'শুক্রবার',
  'শনিবার',
];

export const SHORT_DAY_NAMES_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

function parseTimeToMinutes(hhmm: string | undefined, fallbackMinutes: number): number {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return fallbackMinutes;
  const [hh, mm] = hhmm.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallbackMinutes;
  return Math.min(23 * 60 + 59, Math.max(0, hh * 60 + mm));
}

export function formatTimeBn(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? (h >= 18 ? 'রাত' : 'দুপুর/বিকাল') : h >= 5 ? 'সকাল' : 'রাত';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${String(m).padStart(2, '0')}`;
}

export function formatCountdownBn(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days} দিন ${pad(hours)} ঘঃ ${pad(mins)} মিঃ ${pad(secs)} সেঃ`;
  }
  return `${pad(hours)} ঘঃ ${pad(mins)} মিঃ ${pad(secs)} সেঃ`;
}

export interface WithdrawalWindowStatus {
  isOpen: boolean;
  reason: 'open' | 'holiday' | 'closed_day' | 'outside_hours';
  headline: string;
  detail: string;
  nextOpenAtMs: number | null;
  countdownText: string;
}

export function evaluateWithdrawalWindow(
  schedule?: WithdrawalScheduleConfig,
  nowMs: number = Date.now()
): WithdrawalWindowStatus {
  if (!schedule || (!schedule.enabled && !schedule.holidayMode)) {
    return {
      isOpen: true,
      reason: 'open',
      headline: 'উইথড্র সিস্টেম ২৪/৭ চালু আছে',
      detail: 'যেকোনো সময় টাকা উত্তোলনের রিকোয়েস্ট পাঠাতে পারবেন।',
      nextOpenAtMs: null,
      countdownText: '',
    };
  }

  if (schedule.holidayMode) {
    return {
      isOpen: false,
      reason: 'holiday',
      headline: 'হলিডে মোড — উইথড্র সাময়িকভাবে বন্ধ',
      detail:
        schedule.holidayMessage?.trim() ||
        'সরকারি ছুটি বা বিশেষ রক্ষণাবেক্ষণের কারণে টাকা উত্তোলন সাময়িকভাবে বন্ধ রয়েছে।',
      nextOpenAtMs: null,
      countdownText: '',
    };
  }

  const startMinutes = parseTimeToMinutes(schedule.startTime, 9 * 60);
  const endMinutes = parseTimeToMinutes(schedule.endTime, 22 * 60);
  const closedDays = Array.isArray(schedule.closedDays) ? schedule.closedDays : [];

  // Calculate current Bangladesh (UTC+6) date & time components
  const bdNow = new Date(nowMs + BD_OFFSET_MS);
  const currentDay = bdNow.getUTCDay();
  const currentMinutes = bdNow.getUTCHours() * 60 + bdNow.getUTCMinutes();

  const isClosedDay = closedDays.includes(currentDay);
  const withinHours =
    startMinutes <= endMinutes
      ? currentMinutes >= startMinutes && currentMinutes <= endMinutes
      : currentMinutes >= startMinutes || currentMinutes <= endMinutes;

  if (!isClosedDay && withinHours) {
    return {
      isOpen: true,
      reason: 'open',
      headline: 'উইথড্র উইন্ডো এখন খোলা আছে',
      detail: `সময়সূচি (বাংলাদেশ সময়): ${formatTimeBn(schedule.startTime)} – ${formatTimeBn(schedule.endTime)}`,
      nextOpenAtMs: null,
      countdownText: '',
    };
  }

  // Find next opening timestamp in BD time (scan up to 8 days ahead)
  let nextOpenAtMs: number | null = null;
  const startOfTodayBdUtcMs =
    Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth(), bdNow.getUTCDate(), 0, 0, 0) - BD_OFFSET_MS;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateDay = (currentDay + dayOffset) % 7;
    if (closedDays.includes(candidateDay)) continue;

    const candidateOpenMs = startOfTodayBdUtcMs + dayOffset * 86400_000 + startMinutes * 60_000;
    if (candidateOpenMs > nowMs) {
      nextOpenAtMs = candidateOpenMs;
      break;
    }
  }

  const countdownText = nextOpenAtMs ? formatCountdownBn(nextOpenAtMs - nowMs) : '';

  if (isClosedDay) {
    return {
      isOpen: false,
      reason: 'closed_day',
      headline: `আজ ${DAY_NAMES_BN[currentDay]} — সাপ্তাহিক ছুটিতে উইথড্র বন্ধ`,
      detail:
        schedule.holidayMessage?.trim() ||
        `সাপ্তাহিক ছুটির দিন (${DAY_NAMES_BN[currentDay]}) উইথড্র কার্যক্রম বন্ধ থাকে।`,
      nextOpenAtMs,
      countdownText,
    };
  }

  return {
    isOpen: false,
    reason: 'outside_hours',
    headline: 'নির্ধারিত পেমেন্ট সময়সূচির বাইরে',
    detail: `প্রতিদিন ${formatTimeBn(schedule.startTime)} থেকে ${formatTimeBn(schedule.endTime)} (বাংলাদেশ সময়) পর্যন্ত উইথড্র খোলা থাকে।`,
    nextOpenAtMs,
    countdownText,
  };
}
