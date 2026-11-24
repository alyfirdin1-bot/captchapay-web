import type { PaymentMethod } from '../types';

export interface ParsedDepositSms {
  detectedMethod?: PaymentMethod;
  amount?: number;
  senderNumber?: string;
  trxId?: string;
  matchedReceiverOnly?: boolean;
  confidence: 'high' | 'partial' | 'none';
  matchedFields: Array<'method' | 'amount' | 'senderNumber' | 'trxId'>;
}

const BENGALI_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function normalizeSmsDigits(input: string): string {
  return input.replace(/[০-৯]/g, ch => BENGALI_DIGITS[ch] ?? ch);
}

function normalizePhone(raw: string): string {
  const digits = normalizeSmsDigits(raw).replace(/\D/g, '');
  if (digits.startsWith('8801') && (digits.length === 13 || digits.length === 14)) {
    return digits.slice(2);
  }
  return digits;
}

function isSameBdNumber(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Rocket 12-digit A/C number shares the first 11 digits with the 11-digit phone number
  if (na.length >= 11 && nb.length >= 11 && na.slice(0, 11) === nb.slice(0, 11)) {
    return true;
  }
  return false;
}

function detectPaymentMethod(text: string): PaymentMethod | undefined {
  const lower = text.toLowerCase();

  if (lower.includes('bkash') || text.includes('বিকাশ') || lower.includes('*247#')) {
    return 'bKash';
  }
  if (lower.includes('nagad') || text.includes('নগদ') || lower.includes('*167#')) {
    return 'Nagad';
  }
  if (
    lower.includes('rocket') ||
    text.includes('রকেট') ||
    lower.includes('dbbl') ||
    lower.includes('*322#') ||
    /\btrxn\s*id\b/i.test(text)
  ) {
    return 'Rocket';
  }
  if (
    lower.includes('binance') ||
    lower.includes('usdt') ||
    lower.includes('trc20') ||
    lower.includes('bep20')
  ) {
    return 'Binance USDT';
  }

  // Heuristic by keyword style when brand name isn't pasted
  if (/\btxnid\b/i.test(text)) {
    if (/\ba\/c\b/i.test(text) || /tk\d+/i.test(text)) {
      return 'Rocket';
    }
    return 'Nagad';
  }
  if (/\btrxid\b/i.test(text)) {
    return 'bKash';
  }

  return undefined;
}

function extractTrxId(rawText: string, normalizedText: string): string | undefined {
  const explicitRegex =
    /(?:trx\s*id|txn\s*id|trxn\s*id|tx\s*id|transaction\s*id|ট্রানজেকশন\s*আইডি)(?:\s*(?:is|no|number|:|#|-|হলো|হল))*\s*([A-Za-z0-9]{6,64})/i;
  const rawMatch = rawText.match(explicitRegex);
  if (rawMatch?.[1]) {
    return rawMatch[1].trim().toUpperCase();
  }

  const normMatch = normalizedText.match(explicitRegex);
  if (normMatch?.[1]) {
    return normMatch[1].trim().toUpperCase();
  }

  // Binance / Crypto 64-hex hash fallback
  const hexHashMatch = rawText.match(/\b(0x[a-fA-F0-9]{16,64}|[a-fA-F0-9]{32,64})\b/);
  if (hexHashMatch?.[1]) {
    return hexHashMatch[1].trim();
  }

  // Fallback for Ref / ID label
  const refMatch = normalizedText.match(
    /(?:ref(?:\s*id|\s*no)?|reference)\s*[:#\-]?\s*([A-Za-z0-9]{6,24})/i
  );
  if (refMatch?.[1] && /[A-Za-z]/.test(refMatch[1]) && /\d/.test(refMatch[1])) {
    return refMatch[1].trim().toUpperCase();
  }

  return undefined;
}

function extractAmount(normalizedText: string): number | undefined {
  // 1. High-confidence explicit transaction amount labels
  const primaryPatterns = [
    /(?:amount|amt|পরিমাণ|টাকার পরিমাণ)\s*(?:is|:|-|হলো)?\s*(?:tk\.?|bdt|৳|টাকা)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:send money|sent|payment(?:\s*of)?|cash[\s-]*in|cash[\s-]*out|received|deposit(?:ed)?)\s*(?:of|:|-)?\s*(?:tk\.?|bdt|৳|টাকা)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:টাকা|tk\.?|bdt)\s*(?:সফলভাবে\s*)?(?:পাঠিয়েছেন|পাঠানো হয়েছে|ক্যাশ[\s-]*ইন|ক্যাশ[\s-]*আউট|পেমেন্ট|ডিপোজিট|সেন্ড\s*মানি|send\s*money|cash[\s-]*out)/i,
    /([0-9,]+(?:\.[0-9]{1,4})?)\s*usdt\b/i,
  ];

  for (const regex of primaryPatterns) {
    const match = normalizedText.match(regex);
    if (match?.[1]) {
      const val = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val >= 1 && val <= 1000000) {
        return Math.round(val * 100) / 100;
      }
    }
  }

  // 2. Scan currency tokens while skipping Fee / Charge / Balance / Commission values
  const currencyRegex =
    /(?:(?:tk\.?|bdt|৳)\s*([0-9,]+(?:\.[0-9]{1,2})?)|([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:tk\.?|bdt|৳|টাকা))/gi;
  const ignorePrefixRegex =
    /(?:fee|charge|cost|comm(?:ission)?|bal(?:ance)?|new bal|ফি|চার্জ|খরচ|ব্যালেন্স|কমিশন)\s*(?:is|:|-)?\s*$/i;

  let m: RegExpExecArray | null;
  while ((m = currencyRegex.exec(normalizedText)) !== null) {
    const rawNum = m[1] || m[2];
    if (!rawNum) continue;
    const prefixWindow = normalizedText.slice(Math.max(0, m.index - 28), m.index);
    if (ignorePrefixRegex.test(prefixWindow)) {
      continue;
    }
    const val = Number(rawNum.replace(/,/g, ''));
    if (Number.isFinite(val) && val >= 1 && val <= 1000000) {
      return Math.round(val * 100) / 100;
    }
  }

  return undefined;
}

function extractSenderNumber(
  normalizedText: string,
  knownAdminNumbers: string[]
): { senderNumber?: string; matchedReceiverOnly: boolean } {
  const isAdminReceiver = (num: string) =>
    knownAdminNumbers.some(adminNum => isSameBdNumber(num, adminNum));

  // 1. Explicit sender label ("from 017...", "sender: 018...", "প্রেরক: 019...")
  const explicitSenderMatch = normalizedText.match(
    /(?:from|sender|payer|প্রেরক|নম্বর থেকে)\s*[:#\-]?\s*(?:\+?88)?(01[3-9]\d{8,9})(?!\d)/i
  );
  if (explicitSenderMatch?.[1] && !isAdminReceiver(explicitSenderMatch[1])) {
    return { senderNumber: explicitSenderMatch[1], matchedReceiverOnly: false };
  }

  // 2. Gather all BD mobile / Rocket A/C numbers in the text
  const allMatches: Array<{ num: string; isReceiverContext: boolean }> = [];
  const phoneRegex = /(?<!\d)(?:\+?88)?(01[3-9]\d{8,9})(?!\d)/g;
  const receiverPrefixRegex = /(?:to|receiver|recipient|a\/c|অ্যাকাউন্টে)\s*[:#\-]?\s*$/i;
  const receiverSuffixRegex = /^\s*(?:-?এ|নম্বরে|নাম্বারে|অ্যাকাউন্টে)/i;

  let pm: RegExpExecArray | null;
  while ((pm = phoneRegex.exec(normalizedText)) !== null) {
    const num = pm[1];
    const prefix = normalizedText.slice(Math.max(0, pm.index - 20), pm.index);
    const suffix = normalizedText.slice(pm.index + pm[0].length, pm.index + pm[0].length + 18);
    allMatches.push({
      num,
      isReceiverContext:
        receiverPrefixRegex.test(prefix) ||
        receiverSuffixRegex.test(suffix) ||
        isAdminReceiver(num),
    });
  }

  if (allMatches.length === 0) {
    return { matchedReceiverOnly: false };
  }

  const nonAdminCandidate = allMatches.find(
    item => !isAdminReceiver(item.num) && !item.isReceiverContext
  );
  if (nonAdminCandidate) {
    return { senderNumber: nonAdminCandidate.num, matchedReceiverOnly: false };
  }

  if (allMatches.every(item => item.isReceiverContext)) {
    return { matchedReceiverOnly: true };
  }

  const anyNonAdmin = allMatches.find(item => !isAdminReceiver(item.num));
  if (anyNonAdmin) {
    return { senderNumber: anyNonAdmin.num, matchedReceiverOnly: false };
  }

  return { matchedReceiverOnly: true };
}

export function parseDepositSmsText(
  rawSms: string,
  options?: { knownAdminNumbers?: string[] }
): ParsedDepositSms {
  const trimmed = (rawSms || '').trim();
  if (!trimmed) {
    return { confidence: 'none', matchedFields: [] };
  }

  const normalized = normalizeSmsDigits(trimmed);
  const knownAdminNumbers = (options?.knownAdminNumbers || []).filter(Boolean);

  const detectedMethod = detectPaymentMethod(normalized);
  const trxId = extractTrxId(trimmed, normalized);
  const amount = extractAmount(normalized);
  const { senderNumber, matchedReceiverOnly } = extractSenderNumber(normalized, knownAdminNumbers);

  const matchedFields: ParsedDepositSms['matchedFields'] = [];
  if (detectedMethod) matchedFields.push('method');
  if (typeof amount === 'number') matchedFields.push('amount');
  if (senderNumber) matchedFields.push('senderNumber');
  if (trxId) matchedFields.push('trxId');

  const coreCount = [amount, senderNumber, trxId].filter(v => v !== undefined).length;
  const confidence: ParsedDepositSms['confidence'] =
    coreCount >= 2 ? 'high' : matchedFields.length >= 1 ? 'partial' : 'none';

  return {
    detectedMethod,
    amount,
    senderNumber,
    trxId,
    matchedReceiverOnly,
    confidence,
    matchedFields,
  };
}
