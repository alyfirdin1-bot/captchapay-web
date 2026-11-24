import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { sendTransactionEmailNotice } from './emailService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'telegram-bot-state.json');
const FIREBASE_CONFIG_FILE = path.join(ROOT_DIR, 'firebase-applet-config.json');

const ADMIN_EMAIL_SHA256 = '57afcc0e54fca27f7781c7d88d15e55b0180465b4ca881c5110ae617c38c38e3';
const TELEGRAM_BOT_TOKEN_REGEX = /^\d{6,15}:[A-Za-z0-9_-]{20,80}$/;
const CHAT_ID_REGEX = /^-?\d{5,20}$/;
const CHANNEL_CHAT_ID_REGEX = /^(?:-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;

export interface TelegramAlertPrefs {
  p2pReceived: boolean;
  p2pSent: boolean;
  withdrawals: boolean;
  recharges: boolean;
  adjustments: boolean;
  announcements: boolean;
  dailyDigest?: boolean;
  minAlertAmount?: number;
  mutedUntil?: string;
}

export interface WalletHistoryMiniItem {
  id: string;
  label: string;
  amount: number;
  status: string;
  time: string;
}

export interface UserWalletSnapshot {
  balance: number;
  totalEarned: number;
  totalWithdrawn: number;
  totalRecharged: number;
  vipTier: string;
  captchasSolvedToday: number;
  totalCaptchasSolved: number;
  videosWatchedToday: number;
  totalAdEarned: number;
  referralCode?: string;
  recentTx?: WalletHistoryMiniItem[];
  syncedAt: string;
}

export interface TelegramUserBinding {
  uid: string;
  chatId: string;
  username: string;
  name: string;
  email: string;
  prefs: TelegramAlertPrefs;
  snapshot?: UserWalletSnapshot;
  lastDigestDate?: string;
  linkedAt: string;
  updatedAt: string;
}

export interface TelegramDeliveryLog {
  id: string;
  timestamp: string;
  eventType: string;
  recipientUid: string;
  recipientLabel: string;
  status: 'sent' | 'failed' | 'skipped';
  summary: string;
  error?: string;
}

interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

interface PersistedTelegramState {
  botToken: string;
  botInfo: TelegramBotInfo | null;
  channelBotToken: string;
  channelBotInfo: TelegramBotInfo | null;
  channelChatId: string;
  channelTitle: string;
  channelUsername?: string;
  channelEnabled: boolean;
  vaultSynced?: boolean;
  vaultUpdatedAt?: string;
  lastUpdateId: number;
  webhookSecret: string;
  adminRadarEnabled: boolean;
  commandsRegisteredForUsername: string;
  bindings: Record<string, TelegramUserBinding>;
  logs: TelegramDeliveryLog[];
  dispatchedKeys: string[];
}

interface PendingLinkToken {
  code: string;
  uid: string;
  email: string;
  name: string;
  expiresAt: number;
}

interface PendingOtpEntry {
  code: string;
  expiresAt: number;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  idToken: string;
}

interface FirebaseConfigJson {
  apiKey: string;
  projectId: string;
  appId?: string;
  firestoreDatabaseId?: string;
}

export const TELEGRAM_BOT_COMMANDS = [
  { command: 'start', description: 'বট চালু ও মূল মেনু খুলুন' },
  { command: 'menu', description: 'ইন্টারঅ্যাক্টিভ বাটন ড্যাশবোর্ড' },
  { command: 'balance', description: 'লাইভ ব্যালেন্স ও VIP স্ট্যাটাস' },
  { command: 'history', description: 'সর্বশেষ লেনদেনের মিনি স্টেটমেন্ট' },
  { command: 'stats', description: 'আজকের ক্যাপচা ও ভিডিও অ্যাড আয়' },
  { command: 'digest', description: 'আজকের সম্পূর্ণ আয়ের রিপোর্ট কার্ড' },
  { command: 'otp', description: '৬ সংখ্যার সিকিউরিটি OTP কোড পান' },
  { command: 'mute', description: 'নীরব মোড / ডু নট ডিস্টার্ব সেটিংস' },
  { command: 'support', description: 'সরাসরি অ্যাডমিন সাপোর্টে মেসেজ' },
  { command: 'status', description: 'সংযোগ ও অ্যালার্ট ফিল্টার দেখুন' },
  { command: 'unlink', description: 'টেলিগ্রাম অ্যাকাউন্ট সংযোগ বিচ্ছিন্ন করুন' },
  { command: 'myid', description: 'আপনার টেলিগ্রাম Chat ID দেখুন' },
  { command: 'help', description: 'সকল কমান্ডের তালিকা ও নিয়ম' },
];

const DEFAULT_PREFS: TelegramAlertPrefs = {
  p2pReceived: true,
  p2pSent: true,
  withdrawals: true,
  recharges: true,
  adjustments: true,
  announcements: true,
  dailyDigest: true,
  minAlertAmount: 0,
  mutedUntil: '',
};

function sanitizePrefs(raw?: Partial<TelegramAlertPrefs> | Record<string, unknown> | null): TelegramAlertPrefs {
  const obj = (raw || {}) as Record<string, unknown>;
  const minAmt = Number(obj.minAlertAmount);
  const mutedUntil = typeof obj.mutedUntil === 'string' ? obj.mutedUntil.slice(0, 64) : '';
  return {
    p2pReceived: obj.p2pReceived !== false,
    p2pSent: obj.p2pSent !== false,
    withdrawals: obj.withdrawals !== false,
    recharges: obj.recharges !== false,
    adjustments: obj.adjustments !== false,
    announcements: obj.announcements !== false,
    dailyDigest: obj.dailyDigest !== false,
    minAlertAmount: Number.isFinite(minAmt) && minAmt >= 0 && minAmt <= 50000 ? Math.round(minAmt) : 0,
    mutedUntil,
  };
}

function sanitizeSnapshot(
  raw: unknown,
  existing?: UserWalletSnapshot
): UserWalletSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return existing;
  const s = raw as Record<string, unknown>;
  const cleanNum = (v: unknown, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fb;
  };
  const recentTx: WalletHistoryMiniItem[] = Array.isArray(s.recentTx)
    ? s.recentTx.slice(0, 8).map((item, idx) => {
        const it = (item || {}) as Record<string, unknown>;
        return {
          id: String(it.id || idx).slice(0, 64),
          label: String(it.label || 'লেনদেন').slice(0, 80),
          amount: Number.isFinite(Number(it.amount)) ? Math.round(Number(it.amount) * 100) / 100 : 0,
          status: String(it.status || '').slice(0, 32),
          time: String(it.time || '').slice(0, 64),
        };
      })
    : existing?.recentTx || [];

  return {
    balance: cleanNum(s.balance, existing?.balance ?? 0),
    totalEarned: cleanNum(s.totalEarned, existing?.totalEarned ?? 0),
    totalWithdrawn: cleanNum(s.totalWithdrawn, existing?.totalWithdrawn ?? 0),
    totalRecharged: cleanNum(s.totalRecharged, existing?.totalRecharged ?? 0),
    vipTier: typeof s.vipTier === 'string' ? s.vipTier.slice(0, 20) : existing?.vipTier || 'free',
    captchasSolvedToday: Math.max(0, Math.floor(Number(s.captchasSolvedToday) || 0)),
    totalCaptchasSolved: Math.max(0, Math.floor(Number(s.totalCaptchasSolved) || 0)),
    videosWatchedToday: Math.max(0, Math.floor(Number(s.videosWatchedToday) || 0)),
    totalAdEarned: cleanNum(s.totalAdEarned, existing?.totalAdEarned ?? 0),
    referralCode:
      typeof s.referralCode === 'string' ? s.referralCode.slice(0, 40) : existing?.referralCode,
    recentTx,
    syncedAt: new Date().toISOString(),
  };
}

function getFirebaseConfig(): FirebaseConfigJson {
  const raw = fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8');
  return JSON.parse(raw) as FirebaseConfigJson;
}

function loadState(): PersistedTelegramState {
  const emptyState: PersistedTelegramState = {
    botToken: '',
    botInfo: null,
    channelBotToken: '',
    channelBotInfo: null,
    channelChatId: '',
    channelTitle: '',
    channelUsername: '',
    channelEnabled: true,
    vaultSynced: false,
    vaultUpdatedAt: '',
    lastUpdateId: 0,
    webhookSecret: crypto.randomBytes(24).toString('hex'),
    adminRadarEnabled: true,
    commandsRegisteredForUsername: '',
    bindings: {},
    logs: [],
    dispatchedKeys: [],
  };

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let rawData = '';
    const bakFile = `${STATE_FILE}.bak`;

    if (fs.existsSync(STATE_FILE)) {
      try {
        rawData = fs.readFileSync(STATE_FILE, 'utf8');
      } catch (readErr) {
        console.error('Error reading telegram-bot-state.json, trying backup:', readErr);
      }
    }

    if (!rawData.trim() && fs.existsSync(bakFile)) {
      try {
        rawData = fs.readFileSync(bakFile, 'utf8');
      } catch (bakErr) {
        console.error('Error reading telegram-bot-state.json.bak:', bakErr);
      }
    }

    if (!rawData.trim()) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(emptyState, null, 2), 'utf8');
      return emptyState;
    }

    const parsed = JSON.parse(rawData) as Partial<PersistedTelegramState>;
    return {
      botToken: typeof parsed.botToken === 'string' ? parsed.botToken : '',
      botInfo: parsed.botInfo || null,
      channelBotToken: typeof parsed.channelBotToken === 'string' ? parsed.channelBotToken : '',
      channelBotInfo: parsed.channelBotInfo || null,
      channelChatId: typeof parsed.channelChatId === 'string' ? parsed.channelChatId : '',
      channelTitle: typeof parsed.channelTitle === 'string' ? parsed.channelTitle : '',
      channelUsername: typeof parsed.channelUsername === 'string' ? parsed.channelUsername : '',
      channelEnabled: parsed.channelEnabled !== false,
      vaultSynced: Boolean(parsed.vaultSynced),
      vaultUpdatedAt: typeof parsed.vaultUpdatedAt === 'string' ? parsed.vaultUpdatedAt : '',
      lastUpdateId: typeof parsed.lastUpdateId === 'number' ? parsed.lastUpdateId : 0,
      webhookSecret:
        typeof parsed.webhookSecret === 'string' && parsed.webhookSecret.length >= 16
          ? parsed.webhookSecret
          : crypto.randomBytes(24).toString('hex'),
      adminRadarEnabled: parsed.adminRadarEnabled !== false,
      commandsRegisteredForUsername:
        typeof parsed.commandsRegisteredForUsername === 'string'
          ? parsed.commandsRegisteredForUsername
          : '',
      bindings: parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {},
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, 100) : [],
      dispatchedKeys: Array.isArray(parsed.dispatchedKeys) ? parsed.dispatchedKeys.slice(-500) : [],
    };
  } catch (err) {
    console.error('Failed to load Telegram bot state:', err);
    return emptyState;
  }
}

let state: PersistedTelegramState = loadState();
const pendingLinks = new Map<string, PendingLinkToken>();
const pendingOtps = new Map<string, PendingOtpEntry>();
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let isPollingActive = false;
let isPollingLoopRunning = false;
let isPollInFlight = false;

function saveState(options?: { skipBindingsMerge?: boolean }): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Defensive protection: if existing file has channelChatId/channelBotToken/botToken and current state is accidentally empty, preserve them
    if (fs.existsSync(STATE_FILE)) {
      try {
        const existingRaw = fs.readFileSync(STATE_FILE, 'utf8');
        const existingParsed = JSON.parse(existingRaw) as Partial<PersistedTelegramState>;
        if (existingParsed.channelChatId && !state.channelChatId) {
          state.channelChatId = existingParsed.channelChatId;
        }
        if (existingParsed.channelBotToken && !state.channelBotToken) {
          state.channelBotToken = existingParsed.channelBotToken;
        }
        if (existingParsed.channelBotInfo && !state.channelBotInfo) {
          state.channelBotInfo = existingParsed.channelBotInfo;
        }
        if (existingParsed.channelTitle && !state.channelTitle) {
          state.channelTitle = existingParsed.channelTitle;
        }
        if (existingParsed.botToken && !state.botToken) {
          state.botToken = existingParsed.botToken;
        }
        if (existingParsed.botInfo && !state.botInfo) {
          state.botInfo = existingParsed.botInfo;
        }
        // Only merge bindings from disk if not an explicit unlink and current state was unexpectedly empty
        if (!options?.skipBindingsMerge && existingParsed.bindings && typeof existingParsed.bindings === 'object') {
          if (Object.keys(state.bindings).length === 0 && Object.keys(existingParsed.bindings).length > 0) {
            state.bindings = existingParsed.bindings;
          }
        }
      } catch {
        // Ignore read/merge failure during save
      }
    }

    const tmpFile = `${STATE_FILE}.tmp`;
    const bakFile = `${STATE_FILE}.bak`;
    const jsonStr = JSON.stringify(state, null, 2);

    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
    fs.writeFileSync(bakFile, jsonStr, 'utf8');
  } catch (err) {
    console.error('Failed to persist Telegram bot state:', err);
  }
}

function getActiveBotToken(): string {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (envToken && TELEGRAM_BOT_TOKEN_REGEX.test(envToken)) {
    return envToken;
  }
  return (state.botToken || '').trim();
}

function isEnvManagedToken(): boolean {
  const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  return Boolean(envToken && TELEGRAM_BOT_TOKEN_REGEX.test(envToken));
}

function getActiveChannelBotToken(): string {
  const envToken = (process.env.TELEGRAM_CHANNEL_BOT_TOKEN || '').trim();
  if (envToken && TELEGRAM_BOT_TOKEN_REGEX.test(envToken)) {
    return envToken;
  }
  return (state.channelBotToken || '').trim();
}

function isEnvManagedChannelToken(): boolean {
  const envToken = (process.env.TELEGRAM_CHANNEL_BOT_TOKEN || '').trim();
  return Boolean(envToken && TELEGRAM_BOT_TOKEN_REGEX.test(envToken));
}

function getActiveChannelChatId(): string {
  const envChatId = (process.env.TELEGRAM_CHANNEL_CHAT_ID || '').trim();
  if (envChatId && CHANNEL_CHAT_ID_REGEX.test(envChatId)) {
    return envChatId;
  }
  return (state.channelChatId || '').trim();
}

function isEnvManagedChannelChatId(): boolean {
  const envChatId = (process.env.TELEGRAM_CHANNEL_CHAT_ID || '').trim();
  return Boolean(envChatId && CHANNEL_CHAT_ID_REGEX.test(envChatId));
}

function getActiveChannelTitle(): string {
  return state.channelTitle || (process.env.TELEGRAM_CHANNEL_TITLE || '').trim() || getActiveChannelChatId();
}

function isChannelConfigured(): boolean {
  const chId = getActiveChannelChatId();
  return Boolean(
    getActiveChannelBotToken() &&
      chId &&
      CHANNEL_CHAT_ID_REGEX.test(chId)
  );
}

function maskToken(token: string): string {
  if (!token) return '';
  const parts = token.split(':');
  if (parts.length !== 2) return '****';
  const secret = parts[1];
  const tail = secret.length > 6 ? secret.slice(-5) : '***';
  return `${parts[0]}:••••••••••${tail}`;
}

function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDhakaTime(iso?: string): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleString('bn-BD', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return new Date().toISOString();
  }
}

function getDhakaDateParts(): { dateStr: string; hour: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) || 0,
  };
}

function formatMoney(n: unknown): string {
  const num = Number(n);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function sha256Hex(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

function isAdminEmailMatch(email?: string): boolean {
  if (!email) return false;
  return sha256Hex(email.toLowerCase().trim()) === ADMIN_EMAIL_SHA256;
}

function isVerifiedAdmin(user: VerifiedFirebaseUser): boolean {
  return user.emailVerified && isAdminEmailMatch(user.email);
}

function getAdminBinding(): TelegramUserBinding | null {
  return Object.values(state.bindings).find(b => b.chatId && isAdminEmailMatch(b.email)) || null;
}

function shouldDeliverAlert(binding: TelegramUserBinding, amount = 0): boolean {
  if (!binding.chatId) return false;
  if (binding.prefs.mutedUntil) {
    const untilMs = new Date(binding.prefs.mutedUntil).getTime();
    if (Number.isFinite(untilMs) && untilMs > Date.now()) {
      return false;
    }
  }
  const threshold = Number(binding.prefs.minAlertAmount) || 0;
  if (threshold > 0 && amount > 0 && amount < threshold) {
    return false;
  }
  return true;
}

function appendLog(entry: Omit<TelegramDeliveryLog, 'id' | 'timestamp'>): void {
  const full: TelegramDeliveryLog = {
    id: `tlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  state.logs = [full, ...state.logs].slice(0, 100);
  saveState();
}

function markDispatched(key: string): boolean {
  if (state.dispatchedKeys.includes(key)) {
    return false;
  }
  state.dispatchedKeys = [...state.dispatchedKeys.slice(-499), key];
  saveState();
  return true;
}

async function verifyFirebaseBearer(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length < 20) return null;

  const cfg = getFirebaseConfig();
  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(lookupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (res.status >= 500 && attempt === 0) {
        continue;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
        }>;
      };
      const u = data.users?.[0];
      if (!u?.localId || !u.email || u.emailVerified !== true) {
        return null;
      }
      return {
        uid: u.localId,
        email: u.email,
        emailVerified: true,
        name: u.displayName || u.email.split('@')[0] || 'User',
        idToken,
      };
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

function decodeFirestoreValue(val: unknown): unknown {
  if (!val || typeof val !== 'object') return undefined;
  const v = val as Record<string, unknown>;
  if ('stringValue' in v) return String(v.stringValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('mapValue' in v && v.mapValue && typeof v.mapValue === 'object') {
    const fields = (v.mapValue as { fields?: Record<string, unknown> }).fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, fv] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(fv);
    }
    return out;
  }
  if ('arrayValue' in v && v.arrayValue && typeof v.arrayValue === 'object') {
    const values = (v.arrayValue as { values?: unknown[] }).values || [];
    return values.map(decodeFirestoreValue);
  }
  return undefined;
}

async function fetchFirestoreDocument(
  collectionName: string,
  docId: string,
  idToken: string
): Promise<Record<string, unknown> | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(docId)) return null;
  try {
    const cfg = getFirebaseConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(
      collectionName
    )}/${encodeURIComponent(docId)}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { fields?: Record<string, unknown> };
    if (!raw.fields) return null;
    const decoded: Record<string, unknown> = {};
    for (const [k, fv] of Object.entries(raw.fields)) {
      decoded[k] = decodeFirestoreValue(fv);
    }
    return decoded;
  } catch {
    return null;
  }
}

function encodeFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(encodeFirestoreValue),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function getVaultCipherKey(): Buffer {
  const cfg = getFirebaseConfig();
  const customSecret = (process.env.TELEGRAM_VAULT_SECRET || '').trim();
  const seed =
    customSecret ||
    `${cfg.projectId}:${cfg.firestoreDatabaseId || '(default)'}:${cfg.appId || ''}:captchapay-tg-vault-v1`;
  return crypto.scryptSync(seed, 'captchapay-telegram-vault-salt-2026', 32);
}

function encryptVaultSecret(plain: string): string {
  const clean = (plain || '').trim();
  if (!clean || !TELEGRAM_BOT_TOKEN_REGEX.test(clean)) return '';
  const key = getVaultCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptVaultSecret(cipherText: unknown): string {
  if (typeof cipherText !== 'string' || !cipherText.startsWith('v1:')) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 4) return '';
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const data = Buffer.from(parts[3], 'hex');
    const key = getVaultCipherKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8').trim();
    return TELEGRAM_BOT_TOKEN_REGEX.test(plain) ? plain : '';
  } catch {
    return '';
  }
}

async function persistTelegramVaultToFirestore(
  idToken: string,
  adminEmail: string
): Promise<boolean> {
  if (!idToken || !isAdminEmailMatch(adminEmail)) return false;
  try {
    const cfg = getFirebaseConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents:commit`;
    const docName = `projects/${cfg.projectId}/databases/${dbId}/documents/telegramVault/config`;

    const fields: Record<string, unknown> = {
      id: encodeFirestoreValue('config'),
      channelEnabled: encodeFirestoreValue(Boolean(state.channelEnabled)),
      adminRadarEnabled: encodeFirestoreValue(Boolean(state.adminRadarEnabled)),
      updatedBy: encodeFirestoreValue(adminEmail.slice(0, 200)),
    };

    const botTokenToPersist = (state.botToken || '').trim();
    const botEnc = encryptVaultSecret(botTokenToPersist);
    if (botEnc) {
      fields.botTokenEnc = encodeFirestoreValue(botEnc);
    }
    if (state.botInfo) {
      fields.botInfo = encodeFirestoreValue({
        id: state.botInfo.id,
        username: String(state.botInfo.username || '').slice(0, 80),
        firstName: String(state.botInfo.firstName || '').slice(0, 120),
      });
    }

    const chTokenToPersist = (state.channelBotToken || '').trim();
    const chEnc = encryptVaultSecret(chTokenToPersist);
    if (chEnc) {
      fields.channelBotTokenEnc = encodeFirestoreValue(chEnc);
    }
    if (state.channelBotInfo) {
      fields.channelBotInfo = encodeFirestoreValue({
        id: state.channelBotInfo.id,
        username: String(state.channelBotInfo.username || '').slice(0, 80),
        firstName: String(state.channelBotInfo.firstName || '').slice(0, 120),
      });
    }

    const chId = (state.channelChatId || '').trim();
    if (chId) {
      fields.channelChatId = encodeFirestoreValue(chId.slice(0, 128));
    }
    const chTitle = (state.channelTitle || '').trim();
    if (chTitle) {
      fields.channelTitle = encodeFirestoreValue(chTitle.slice(0, 200));
    }

    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName,
              fields,
            },
            updateTransforms: [
              {
                fieldPath: 'updatedAt',
                setToServerValue: 'REQUEST_TIME',
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      console.warn('[TelegramVault] Cloud backup write failed:', res.status, errTxt.slice(0, 200));
      return false;
    }

    state.vaultSynced = true;
    state.vaultUpdatedAt = new Date().toISOString();
    saveState();
    return true;
  } catch (err) {
    console.warn('[TelegramVault] Cloud backup error:', err);
    return false;
  }
}

async function hydrateTelegramFromFirestore(
  idToken: string,
  adminEmail?: string
): Promise<{ restoredChannel: boolean; restoredBot: boolean; vaultSynced: boolean }> {
  let restoredChannel = false;
  let restoredBot = false;

  if (!idToken) {
    return { restoredChannel, restoredBot, vaultSynced: Boolean(state.vaultSynced) };
  }

  const vaultDoc = await fetchFirestoreDocument('telegramVault', 'config', idToken);

  if (vaultDoc) {
    const chToken = decryptVaultSecret(vaultDoc.channelBotTokenEnc);
    const chId = typeof vaultDoc.channelChatId === 'string' ? vaultDoc.channelChatId.trim() : '';
    const chTitle = typeof vaultDoc.channelTitle === 'string' ? vaultDoc.channelTitle.trim() : '';

    if (!state.channelBotToken && chToken) {
      state.channelBotToken = chToken;
      restoredChannel = true;
    }
    if (!state.channelChatId && chId && CHANNEL_CHAT_ID_REGEX.test(chId)) {
      state.channelChatId = chId;
      restoredChannel = true;
    }
    if (!state.channelTitle && chTitle) {
      state.channelTitle = chTitle;
    }
    if (!state.channelBotInfo && vaultDoc.channelBotInfo && typeof vaultDoc.channelBotInfo === 'object') {
      const bi = vaultDoc.channelBotInfo as Record<string, unknown>;
      if (typeof bi.id === 'number' || typeof bi.username === 'string') {
        state.channelBotInfo = {
          id: Number(bi.id) || 0,
          username: String(bi.username || ''),
          firstName: String(bi.firstName || 'CaptchaPay Channel Bot'),
        };
      }
    }
    if (restoredChannel && typeof vaultDoc.channelEnabled === 'boolean') {
      state.channelEnabled = vaultDoc.channelEnabled;
    }

    const botToken = decryptVaultSecret(vaultDoc.botTokenEnc);
    if (!state.botToken && botToken) {
      state.botToken = botToken;
      restoredBot = true;
    }
    if (!state.botInfo && vaultDoc.botInfo && typeof vaultDoc.botInfo === 'object') {
      const bi = vaultDoc.botInfo as Record<string, unknown>;
      if (typeof bi.id === 'number' || typeof bi.username === 'string') {
        state.botInfo = {
          id: Number(bi.id) || 0,
          username: String(bi.username || ''),
          firstName: String(bi.firstName || 'CaptchaPay Bot'),
        };
      }
    }
    if (restoredBot && typeof vaultDoc.adminRadarEnabled === 'boolean') {
      state.adminRadarEnabled = vaultDoc.adminRadarEnabled;
    }

    state.vaultSynced = true;
    if (typeof vaultDoc.updatedAt === 'string' && vaultDoc.updatedAt) {
      state.vaultUpdatedAt = vaultDoc.updatedAt;
    }

    if (restoredChannel || restoredBot) {
      saveState();
      if (restoredBot && getActiveBotToken()) {
        startTelegramPolling();
      }
    }

    // Backfill cloud vault if local server had newer tokens/chatId not yet backed up
    const needsBackfill =
      Boolean(adminEmail) &&
      ((state.channelBotToken && !chToken) ||
        (state.channelChatId && !chId) ||
        (state.botToken && !botToken));
    if (needsBackfill && adminEmail) {
      await persistTelegramVaultToFirestore(idToken, adminEmail);
    }

    return { restoredChannel, restoredBot, vaultSynced: true };
  }

  // First-time migration: push existing local config up to Cloud Vault
  if (
    adminEmail &&
    (state.channelBotToken || state.channelChatId || state.botToken)
  ) {
    const synced = await persistTelegramVaultToFirestore(idToken, adminEmail);
    return { restoredChannel, restoredBot, vaultSynced: synced };
  }

  return { restoredChannel, restoredBot, vaultSynced: Boolean(state.vaultSynced) };
}

async function callTelegramApi<T = unknown>(
  token: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  if (!TELEGRAM_BOT_TOKEN_REGEX.test(token)) {
    return { ok: false, description: 'Invalid bot token format' };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  return data;
}

async function registerBotSlashCommands(token: string, username: string): Promise<void> {
  try {
    const resp = await callTelegramApi(token, 'setMyCommands', {
      commands: TELEGRAM_BOT_COMMANDS,
    });
    if (resp.ok) {
      state.commandsRegisteredForUsername = username || 'configured';
      saveState();
    }
  } catch {
    // Non-critical
  }
}

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

async function sendTelegramMessage(
  chatId: string,
  htmlText: string,
  inlineKeyboard?: InlineButton[][]
): Promise<{ ok: boolean; error?: string }> {
  const token = getActiveBotToken();
  if (!token) {
    return { ok: false, error: 'টেলিগ্রাম বট টোকেন সেট করা নেই' };
  }
  if (!CHAT_ID_REGEX.test(chatId)) {
    return { ok: false, error: 'অবৈধ Chat ID' };
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (inlineKeyboard && inlineKeyboard.length > 0) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    const resp = await callTelegramApi(token, 'sendMessage', payload);
    if (!resp.ok) {
      return { ok: false, error: resp.description || 'Telegram API error' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function dispatchAdminErrorAlert(
  title: string,
  details: {
    message: string;
    source: string;
    url?: string;
    user?: string;
    stack?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const token = getActiveBotToken();
  if (!token) {
    return { ok: false, error: 'বট টোকেন কনফিগার করা নেই' };
  }
  const adminBinding = getAdminBinding();
  const activeChannelId = getActiveChannelChatId();
  const targetChatId = adminBinding?.chatId || (activeChannelId ? activeChannelId : null);
  if (!targetChatId) {
    return { ok: false, error: 'কোনো অ্যাডমিন টেলিগ্রাম অ্যাকাউন্ট বা চ্যানেল লিংক করা নেই' };
  }

  const stackShort = details.stack ? details.stack.slice(0, 350) : '';
  const msg =
    `🚨 <b>[CaptchaPay এরর অ্যালার্ট]</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ <b>সমস্যা:</b> ${escapeHtml(details.message)}\n` +
    `📍 <b>উৎস:</b> ${escapeHtml(details.source)}\n` +
    (details.url ? `🌐 <b>ইউআরএল:</b> <code>${escapeHtml(details.url)}</code>\n` : '') +
    (details.user ? `👤 <b>ইউজার:</b> <code>${escapeHtml(details.user)}</code>\n` : '') +
    `⏰ <b>সময়:</b> ${escapeHtml(formatDhakaTime())}\n` +
    (stackShort ? `━━━━━━━━━━━━━━━━━━\n🔍 <b>স্ট্যাক ট্রেস:</b>\n<code>${escapeHtml(stackShort)}</code>\n` : '') +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>🛡️ সেলফ-হিলিং গার্ড স্বয়ংক্রিয়ভাবে ওয়েবসাইট সচল রেখেছে।</i>`;

  const res = await sendTelegramMessage(targetChatId, msg);
  appendLog({
    eventType: 'admin_error_alert',
    recipientUid: adminBinding?.uid || 'admin_channel',
    recipientLabel: `Admin Alert (${targetChatId})`,
    status: res.ok ? 'sent' : 'failed',
    summary: `${title}: ${details.message.slice(0, 50)}`,
    error: res.error,
  });
  return res;
}

async function editOrSendTelegramMessage(
  chatId: string,
  messageId: number | undefined,
  htmlText: string,
  inlineKeyboard?: InlineButton[][]
): Promise<void> {
  const token = getActiveBotToken();
  if (!token || !messageId) {
    await sendTelegramMessage(chatId, htmlText, inlineKeyboard);
    return;
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (inlineKeyboard && inlineKeyboard.length > 0) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    const resp = await callTelegramApi(token, 'editMessageText', payload);
    if (!resp.ok && !resp.description?.toLowerCase().includes('message is not modified')) {
      await sendTelegramMessage(chatId, htmlText, inlineKeyboard);
    }
  } catch {
    await sendTelegramMessage(chatId, htmlText, inlineKeyboard);
  }
}

function getAppPublicUrl(): string {
  const raw = (process.env.APP_URL || '').trim();
  if (raw && raw !== 'MY_APP_URL' && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  return '';
}

function buildFooterLine(): string {
  const appUrl = getAppPublicUrl();
  if (appUrl) {
    return `\n🌐 <a href="${escapeHtml(appUrl)}">CaptchaPay ড্যাশবোর্ড খুলুন</a>`;
  }
  return '';
}

function maskEmailPrefixToUsername(rawEmailOrId: string): string {
  const base = (rawEmailOrId.split('@')[0] || 'user').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!base) return '@user***';
  if (base.length <= 4) return `@${base.slice(0, 2)}***`;
  return `@${base.slice(0, 3)}***${base.slice(-2)}`;
}

async function resolveSafeChannelUsername(
  uid: string,
  fallbackEmail?: string,
  idToken?: string
): Promise<string> {
  const b = uid ? state.bindings[uid] : undefined;
  if (b?.username) {
    return `@${b.username.replace(/^@+/, '')}`;
  }
  let emailToUse = b?.email || fallbackEmail || '';
  if (idToken && uid && /^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    const userDoc = await fetchFirestoreDocument('users', uid, idToken);
    if (userDoc) {
      const tgUser =
        typeof userDoc.telegramUsername === 'string' ? userDoc.telegramUsername.trim() : '';
      if (tgUser) {
        return `@${tgUser.replace(/^@+/, '')}`;
      }
      if (!emailToUse && typeof userDoc.email === 'string') {
        emailToUse = userDoc.email;
      }
    }
  }
  return maskEmailPrefixToUsername(emailToUse || uid || 'user');
}

// Broadcast-only helper: uses the dedicated channel bot token and ONLY posts to the configured channel.
// That channel bot never polls DMs or answers private messages/commands from users.
async function sendChannelMessage(
  htmlText: string,
  eventType = 'channel_broadcast',
  summary = 'চ্যানেল নোটিফিকেশন'
): Promise<{ ok: boolean; error?: string }> {
  if (!state.channelEnabled) {
    return { ok: false, error: 'চ্যানেল নোটিফিকেশন বন্ধ রাখা হয়েছে' };
  }
  const token = getActiveChannelBotToken();
  const chatId = getActiveChannelChatId();
  const channelLabel = getActiveChannelTitle();
  if (!token || !chatId || !CHANNEL_CHAT_ID_REGEX.test(chatId)) {
    return { ok: false, error: 'চ্যানেল বট কনফিগার করা নেই' };
  }

  try {
    const resp = await callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    appendLog({
      eventType,
      recipientUid: 'channel',
      recipientLabel: channelLabel && channelLabel !== chatId ? `${channelLabel} (${chatId})` : chatId,
      status: resp.ok ? 'sent' : 'failed',
      summary,
      error: resp.ok ? undefined : resp.description || 'Channel API error',
    });
    if (!resp.ok) {
      return { ok: false, error: resp.description || 'Channel send failed' };
    }
    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    appendLog({
      eventType,
      recipientUid: 'channel',
      recipientLabel: chatId,
      status: 'failed',
      summary,
      error: errMsg,
    });
    return { ok: false, error: errMsg };
  }
}

function buildMainMenuKeyboard(): InlineButton[][] {
  const rows: InlineButton[][] = [
    [
      { text: '💳 লাইভ ব্যালেন্স', callback_data: 'menu:balance' },
      { text: '📜 লেনদেন হিস্ট্রি', callback_data: 'menu:history' },
    ],
    [
      { text: '📊 আজকের আয় ও কাজ', callback_data: 'menu:stats' },
      { text: '📈 ডেইলি রিপোর্ট', callback_data: 'menu:digest' },
    ],
    [
      { text: '⚙️ অ্যালার্ট সেটিংস', callback_data: 'menu:prefs' },
      { text: '🔐 2FA OTP কোড', callback_data: 'menu:otp' },
    ],
    [
      { text: '🔕 সাইলেন্ট মোড', callback_data: 'menu:mute_menu' },
      { text: '📋 কমান্ড তালিকা', callback_data: 'menu:help' },
    ],
  ];
  const appUrl = getAppPublicUrl();
  if (appUrl) {
    rows.push([{ text: '🌐 CaptchaPay ওয়েব অ্যাপ খুলুন', url: appUrl }]);
  }
  return rows;
}

function buildHomeCardText(binding: TelegramUserBinding | null, chatId: string): string {
  if (!binding) {
    return (
      `ℹ️ এই টেলিগ্রাম আইডিটি (<code>${escapeHtml(chatId)}</code>) এখনো কোনো CaptchaPay অ্যাকাউন্টের সাথে যুক্ত নয়।\n\n` +
      `অ্যাপের <b>"টেলিগ্রাম রিসিট"</b> বাটনে গিয়ে <code>${escapeHtml(chatId)}</code> বসিয়ে ভেরিফাই করুন। একবার যুক্ত করলে এই মেসেজটি আর আসবে না।`
    );
  }

  const snap = binding.snapshot;
  const mutedActive =
    binding.prefs.mutedUntil && new Date(binding.prefs.mutedUntil).getTime() > Date.now();
  return (
    `✅ <b>আপনার বটটি সফলভাবে সংযোগ হয়েছে!</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 অ্যাকাউন্ট: <b>${escapeHtml(binding.name)}</b>\n` +
    `📧 ইমেইল: <code>${escapeHtml(binding.email)}</code>\n` +
    `💰 বর্তমান ব্যালেন্স: <b>৳${escapeHtml(formatMoney(snap?.balance ?? 0))}</b>\n` +
    `👑 VIP টায়ার: <b>${escapeHtml((snap?.vipTier || 'free').toUpperCase())}</b>\n` +
    `🔔 স্ট্যাটাস: ${
      mutedActive ? '🔕 নীরব মোড চালু' : '🟢 লাইভ রিসিট ও নোটিফিকেশন সক্রিয়'
    }\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `নিচের যেকোনো বাটনে ট্যাপ করে তথ্য দেখুন:`
  );
}

function buildBalanceCard(binding: TelegramUserBinding): string {
  const s = binding.snapshot;
  if (!s) {
    return (
      `💳 <b>লাইভ ওয়ালেট ব্যালেন্স</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 অ্যাকাউন্ট: <b>${escapeHtml(binding.name)}</b>\n` +
      `ℹ️ সর্বশেষ ব্যালেন্স সিঙ্ক করতে একবার CaptchaPay অ্যাপ খুলুন।`
    );
  }
  return (
    `💳 <b>CaptchaPay লাইভ ওয়ালেট সামারি</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 বর্তমান ব্যালেন্স: <b>৳${escapeHtml(formatMoney(s.balance))}</b>\n` +
    `📈 মোট অর্জিত আয়: <b>৳${escapeHtml(formatMoney(s.totalEarned))}</b>\n` +
    `💸 মোট উইথড্র: <b>৳${escapeHtml(formatMoney(s.totalWithdrawn))}</b>\n` +
    `📱 মোট রিচার্জ: <b>৳${escapeHtml(formatMoney(s.totalRecharged))}</b>\n` +
    `👑 VIP টায়ার: <b>${escapeHtml(s.vipTier.toUpperCase())}</b>\n` +
    (s.referralCode ? `🎁 রেফারেল কোড: <code>${escapeHtml(s.referralCode)}</code>\n` : '') +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🕒 সর্বশেষ সিঙ্ক: ${escapeHtml(formatDhakaTime(s.syncedAt))}`
  );
}

function buildHistoryCard(binding: TelegramUserBinding): string {
  const txs = binding.snapshot?.recentTx || [];
  if (txs.length === 0) {
    return (
      `📜 <b>সাম্প্রতিক লেনদেন স্টেটমেন্ট</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `এখনো কোনো সাম্প্রতিক লেনদেন পাওয়া যায়নি। নতুন P2P, উইথড্র বা রিচার্জ হলেই এখানে তালিকা আপডেট হবে।`
    );
  }

  const lines = txs.map((tx, idx) => {
    const sign = tx.amount >= 0 ? '+' : '-';
    return `${idx + 1}. <b>${escapeHtml(tx.label)}</b> — <code>${sign}৳${escapeHtml(
      formatMoney(Math.abs(tx.amount))
    )}</code> (${escapeHtml(tx.status)})`;
  });

  return (
    `📜 <b>সর্বশেষ ${txs.length}টি লেনদেনের মিনি-স্টেটমেন্ট</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${lines.join('\n')}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💳 বর্তমান ব্যালেন্স: <b>৳${escapeHtml(formatMoney(binding.snapshot?.balance ?? 0))}</b>`
  );
}

function buildStatsCard(binding: TelegramUserBinding): string {
  const s = binding.snapshot;
  return (
    `📊 <b>আজকের কাজ ও আয়ের পরিসংখ্যান</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🧩 আজকের ক্যাপচা সমাধান: <b>${escapeHtml(s?.captchasSolvedToday ?? 0)} টি</b>\n` +
    `🏆 সর্বমোট ক্যাপচা: <b>${escapeHtml(s?.totalCaptchasSolved ?? 0)} টি</b>\n` +
    `🎬 আজকের ভিডিও অ্যাড: <b>${escapeHtml(s?.videosWatchedToday ?? 0)} টি</b>\n` +
    `💵 মোট অ্যাড থেকে আয়: <b>৳${escapeHtml(formatMoney(s?.totalAdEarned ?? 0))}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🕒 আপডেট: ${escapeHtml(formatDhakaTime(s?.syncedAt))}`
  );
}

function buildDigestCard(binding: TelegramUserBinding): string {
  const s = binding.snapshot;
  return (
    `📈 <b>CaptchaPay ডেইলি পারফরম্যান্স রিপোর্ট</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${escapeHtml(binding.name)}</b>\n` +
    `📅 তারিখ: ${escapeHtml(getDhakaDateParts().dateStr)}\n\n` +
    `🧩 আজকের ক্যাপচা: <b>${escapeHtml(s?.captchasSolvedToday ?? 0)} টি</b>\n` +
    `🎬 আজকের অ্যাড দেখা: <b>${escapeHtml(s?.videosWatchedToday ?? 0)} টি</b>\n` +
    `💰 বর্তমান ব্যালেন্স: <b>৳${escapeHtml(formatMoney(s?.balance ?? 0))}</b>\n` +
    `📈 সর্বমোট আয়: <b>৳${escapeHtml(formatMoney(s?.totalEarned ?? 0))}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✨ প্রতিদিন রাত ৯টায় এই রিপোর্ট অটো পেতে অ্যালার্ট সেটিংসে "ডেইলি রিপোর্ট" চালু রাখুন।`
  );
}

function buildPrefsCardAndKeyboard(binding: TelegramUserBinding): {
  text: string;
  keyboard: InlineButton[][];
} {
  const p = binding.prefs;
  const mutedActive = p.mutedUntil && new Date(p.mutedUntil).getTime() > Date.now();
  const text =
    `⚙️ <b>টেলিগ্রাম রিসিট অ্যালার্ট কন্ট্রোল</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `যেকোনো বাটনে ট্যাপ করে রিসিট চালু বা বন্ধ করুন:\n` +
    `🔕 নীরব মোড: ${
      mutedActive ? `চালু (${escapeHtml(formatDhakaTime(p.mutedUntil))})` : 'বন্ধ'
    }\n` +
    `🎯 মিনিমাম অ্যামাউন্ট ফিল্টার: ৳${escapeHtml(p.minAlertAmount || 0)}`;

  const mark = (v: boolean) => (v ? '✅' : '❌');
  const keyboard: InlineButton[][] = [
    [
      { text: `${mark(p.p2pReceived)} P2P প্রাপ্তি`, callback_data: 'toggle:p2pReceived' },
      { text: `${mark(p.p2pSent)} P2P সেন্ড`, callback_data: 'toggle:p2pSent' },
    ],
    [
      { text: `${mark(p.withdrawals)} উইথড্র`, callback_data: 'toggle:withdrawals' },
      { text: `${mark(p.recharges)} রিচার্জ`, callback_data: 'toggle:recharges' },
    ],
    [
      { text: `${mark(p.adjustments)} ব্যালেন্স/বোনাস`, callback_data: 'toggle:adjustments' },
      { text: `${mark(p.announcements)} ঘোষণা`, callback_data: 'toggle:announcements' },
    ],
    [
      { text: `${mark(p.dailyDigest !== false)} রাতের ডেইলি রিপোর্ট`, callback_data: 'toggle:dailyDigest' },
    ],
    [{ text: '🔌 এই অ্যাকাউন্ট সংযোগ বিচ্ছিন্ন করুন', callback_data: 'menu:unlink' }],
    [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
  ];

  return { text, keyboard };
}

function buildHelpText(): string {
  return (
    `📋 <b>CaptchaPay টেলিগ্রাম বট — সম্পূর্ণ কমান্ড তালিকা</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `• <code>/start</code> — বট চালু ও মূল ড্যাশবোর্ড\n` +
    `• <code>/menu</code> — ইন্টারেক্টিভ বাটন মেনু\n` +
    `• <code>/balance</code> — লাইভ ব্যালেন্স, মোট আয় ও VIP\n` +
    `• <code>/history</code> — সর্বশেষ ৮টি লেনদেনের স্টেটমেন্ট\n` +
    `• <code>/stats</code> — আজকের ক্যাপচা ও অ্যাড আয়\n` +
    `• <code>/digest</code> — আজকের সম্পূর্ণ ডেইলি রিপোর্ট\n` +
    `• <code>/otp</code> — ৬ সংখ্যার ভেরিফিকেশন OTP কোড\n` +
    `• <code>/mute 1h</code> বা <code>/mute 8h</code> — সাময়িক নীরব মোড\n` +
    `• <code>/unmute</code> — নীরব মোড বন্ধ করুন\n` +
    `• <code>/support বার্তা</code> — সরাসরি সাপোর্টে বার্তা পাঠান\n` +
    `• <code>/status</code> — সংযোগ ও অ্যালার্ট ফিল্টার স্ট্যাটাস\n` +
    `• <code>/myid</code> — আপনার টেলিগ্রাম Chat ID\n` +
    `• <code>/help</code> — এই কমান্ড গাইড\n` +
    `━━━━━━━━━━━━━━━━━━`
  );
}

function pushMiniTx(uid: string, item: WalletHistoryMiniItem, nextBalance?: number): void {
  const b = state.bindings[uid];
  if (!b) return;
  const currentSnap: UserWalletSnapshot = b.snapshot || {
    balance: nextBalance ?? 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    totalRecharged: 0,
    vipTier: 'free',
    captchasSolvedToday: 0,
    totalCaptchasSolved: 0,
    videosWatchedToday: 0,
    totalAdEarned: 0,
    recentTx: [],
    syncedAt: new Date().toISOString(),
  };
  if (typeof nextBalance === 'number' && Number.isFinite(nextBalance)) {
    currentSnap.balance = Math.round(nextBalance * 100) / 100;
  }
  const existingList = (currentSnap.recentTx || []).filter(t => t.id !== item.id);
  currentSnap.recentTx = [item, ...existingList].slice(0, 8);
  currentSnap.syncedAt = new Date().toISOString();
  b.snapshot = currentSnap;
  state.bindings[uid] = b;
  saveState();
}

async function resolveBindingWithFirestoreFallback(
  uid: string,
  adminIdToken?: string
): Promise<TelegramUserBinding | null> {
  if (state.bindings[uid]?.chatId) {
    return state.bindings[uid];
  }
  if (!adminIdToken) return null;

  const userDoc = await fetchFirestoreDocument('users', uid, adminIdToken);
  if (!userDoc) return null;
  const chatId = typeof userDoc.telegramChatId === 'string' ? userDoc.telegramChatId.trim() : '';
  if (!CHAT_ID_REGEX.test(chatId)) return null;

  const hydrated: TelegramUserBinding = {
    uid,
    chatId,
    username: typeof userDoc.telegramUsername === 'string' ? userDoc.telegramUsername : '',
    name: typeof userDoc.name === 'string' ? userDoc.name : 'User',
    email: typeof userDoc.email === 'string' ? userDoc.email : '',
    prefs: sanitizePrefs(userDoc.telegramAlertPrefs as Partial<TelegramAlertPrefs>),
    snapshot: sanitizeSnapshot({
      balance: userDoc.balance,
      totalEarned: userDoc.totalEarned,
      totalWithdrawn: userDoc.totalWithdrawn,
      totalRecharged: userDoc.totalRecharged,
      vipTier: userDoc.vipTier,
      captchasSolvedToday: userDoc.captchasSolvedToday,
      totalCaptchasSolved: userDoc.totalCaptchasSolved,
      videosWatchedToday: userDoc.videosWatchedToday,
      totalAdEarned: userDoc.totalAdEarned,
    }),
    linkedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.bindings[uid] = hydrated;
  saveState();
  return hydrated;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number | string; username?: string; first_name?: string; type?: string };
    from?: { id: number | string; username?: string; first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number | string; username?: string; first_name?: string };
    message?: {
      message_id: number;
      chat?: { id: number | string };
    };
  };
}

function findBindingByChatId(chatId: string): TelegramUserBinding | null {
  const needle = String(chatId || '').trim();
  if (!needle) return null;
  return (
    Object.values(state.bindings).find(
      b => String(b.chatId || '').trim() === needle
    ) || null
  );
}

function generateAndStoreOtp(uid: string): string {
  const code = String(crypto.randomInt(100000, 999999));
  pendingOtps.set(uid, {
    code,
    expiresAt: Date.now() + 3 * 60 * 1000,
  });
  return code;
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
  const token = getActiveBotToken();
  const chatId = cb.message?.chat?.id ? String(cb.message.chat.id) : '';
  const messageId = cb.message?.message_id;
  const data = String(cb.data || '');

  if (token) {
    void callTelegramApi(token, 'answerCallbackQuery', { callback_query_id: cb.id });
  }
  if (!chatId) return;

  const binding = findBindingByChatId(chatId);

  if (data === 'menu:home') {
    await editOrSendTelegramMessage(
      chatId,
      messageId,
      buildHomeCardText(binding, chatId),
      binding ? buildMainMenuKeyboard() : undefined
    );
    return;
  }

  if (data === 'menu:help') {
    await editOrSendTelegramMessage(chatId, messageId, buildHelpText(), [
      [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (!binding) {
    await editOrSendTelegramMessage(
      chatId,
      messageId,
      `⚠️ প্রথমে CaptchaPay অ্যাপে আপনার Chat ID (<code>${escapeHtml(chatId)}</code>) যুক্ত করুন।`
    );
    return;
  }

  if (data === 'menu:balance') {
    await editOrSendTelegramMessage(chatId, messageId, buildBalanceCard(binding), [
      [
        { text: '🔄 রিফ্রেশ', callback_data: 'menu:balance' },
        { text: '📜 লেনদেন হিস্ট্রি', callback_data: 'menu:history' },
      ],
      [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (data === 'menu:history') {
    await editOrSendTelegramMessage(chatId, messageId, buildHistoryCard(binding), [
      [
        { text: '🔄 রিফ্রেশ', callback_data: 'menu:history' },
        { text: '💳 ব্যালেন্স দেখুন', callback_data: 'menu:balance' },
      ],
      [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (data === 'menu:stats') {
    await editOrSendTelegramMessage(chatId, messageId, buildStatsCard(binding), [
      [
        { text: '📈 ডেইলি রিপোর্ট', callback_data: 'menu:digest' },
        { text: '⬅️ মূল মেনু', callback_data: 'menu:home' },
      ],
    ]);
    return;
  }

  if (data === 'menu:digest') {
    await editOrSendTelegramMessage(chatId, messageId, buildDigestCard(binding), [
      [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (data === 'menu:prefs') {
    const { text, keyboard } = buildPrefsCardAndKeyboard(binding);
    await editOrSendTelegramMessage(chatId, messageId, text, keyboard);
    return;
  }

  if (data === 'menu:unlink') {
    const targetUid = binding.uid;
    const targetChatId = binding.chatId;
    delete state.bindings[targetUid];
    pendingOtps.delete(targetUid);
    saveState({ skipBindingsMerge: true });

    appendLog({
      eventType: 'account_unlinked_via_bot',
      recipientUid: targetUid,
      recipientLabel: `${binding.name} (${targetChatId})`,
      status: 'sent',
      summary: 'টেলিগ্রাম বাটন থেকে অ্যাকাউন্ট সংযোগ বিচ্ছিন্ন করা হয়েছে',
    });

    await editOrSendTelegramMessage(
      chatId,
      messageId,
      `🔌 <b>আপনার CaptchaPay অ্যাকাউন্ট সফলভাবে সংযোগ বিচ্ছিন্ন করা হয়েছে!</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `এখন থেকে এই টেলিগ্রাম আইডিতে আর কোনো রিসিট বা অ্যালার্ট আসবে না।\n\n` +
        `পুনরায় সংযোগ করতে চাইলে ওয়েবসাইট থেকে আপনার Chat ID (<code>${escapeHtml(chatId)}</code>) বসিয়ে ভেরিফাই করুন।`
    );
    return;
  }

  if (data.startsWith('toggle:')) {
    const key = data.slice(7) as keyof TelegramAlertPrefs;
    const toggleable: Array<keyof TelegramAlertPrefs> = [
      'p2pReceived',
      'p2pSent',
      'withdrawals',
      'recharges',
      'adjustments',
      'announcements',
      'dailyDigest',
    ];
    if (toggleable.includes(key)) {
      binding.prefs = {
        ...binding.prefs,
        [key]: key === 'dailyDigest' ? binding.prefs.dailyDigest === false : !binding.prefs[key],
      };
      binding.updatedAt = new Date().toISOString();
      state.bindings[binding.uid] = binding;
      saveState();
      const { text, keyboard } = buildPrefsCardAndKeyboard(binding);
      await editOrSendTelegramMessage(chatId, messageId, text, keyboard);
    }
    return;
  }

  if (data === 'menu:mute_menu') {
    const mutedActive = binding.prefs.mutedUntil && new Date(binding.prefs.mutedUntil).getTime() > Date.now();
    await editOrSendTelegramMessage(
      chatId,
      messageId,
      `🔕 <b>নীরব মোড (Do Not Disturb)</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `বর্তমান অবস্থা: ${
          mutedActive
            ? `🔕 সাইলেন্ট আছে (${escapeHtml(formatDhakaTime(binding.prefs.mutedUntil))} পর্যন্ত)`
            : '🔔 সব রিসিট চালু আছে'
        }\n\nপ্রয়োজন অনুযায়ী সাময়িকভাবে রিসিট সাউন্ড/নোটিফিকেশন বিরতি দিতে পারেন:`,
      [
        [
          { text: '🔕 ১ ঘণ্টা সাইলেন্ট', callback_data: 'mute:1h' },
          { text: '🌙 ৮ ঘণ্টা সাইলেন্ট', callback_data: 'mute:8h' },
        ],
        [{ text: '🔔 নীরব মোড বন্ধ (Unmute)', callback_data: 'mute:off' }],
        [{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }],
      ]
    );
    return;
  }

  if (data === 'mute:1h' || data === 'mute:8h' || data === 'mute:off') {
    const hours = data === 'mute:1h' ? 1 : data === 'mute:8h' ? 8 : 0;
    binding.prefs.mutedUntil =
      hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : '';
    binding.updatedAt = new Date().toISOString();
    state.bindings[binding.uid] = binding;
    saveState();
    await editOrSendTelegramMessage(
      chatId,
      messageId,
      hours > 0
        ? `🔕 <b>নীরব মোড চালু হয়েছে (${hours} ঘণ্টা)</b>\n${escapeHtml(
            formatDhakaTime(binding.prefs.mutedUntil)
          )} পর্যন্ত প্যাসিভ অ্যালার্ট বন্ধ থাকবে।`
        : `🔔 <b>নীরব মোড বন্ধ করা হয়েছে!</b>\nএখন থেকে সব লাইভ রিসিট নিয়মিত পাবেন।`,
      [[{ text: '⬅️ মূল মেনুতে ফিরুন', callback_data: 'menu:home' }]]
    );
    return;
  }

  if (data === 'menu:otp') {
    const otp = generateAndStoreOtp(binding.uid);
    await sendTelegramMessage(
      chatId,
      `🔐 <b>CaptchaPay সিকিউরিটি OTP কোড</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `আপনার ওয়ান-টাইম কোড: <code>${otp}</code>\n` +
        `⏳ মেয়াদ: ৩ মিনিট\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ এই কোডটি কখনোই অন্য কারো সাথে শেয়ার করবেন না।`
    );
    return;
  }
}

async function handleIncomingTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg?.chat?.id || !msg.text) return;

  const chatId = String(msg.chat.id);
  const username = msg.from?.username || msg.chat?.username || '';
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = (parts[1] || '').trim();

    if (code) {
      const pending = pendingLinks.get(code);
      if (!pending || pending.expiresAt < Date.now()) {
        pendingLinks.delete(code);
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>লিঙ্ক কোডটির মেয়াদ শেষ বা সঠিক নয়।</b>\n\nঅনুগ্রহ করে CaptchaPay অ্যাপের <i>"টেলিগ্রাম লাইভ রিসিট"</i> মেনু থেকে নতুন কানেক্ট বাটনে ক্লিক করুন।\n\nআপনার Chat ID: <code>${escapeHtml(chatId)}</code>`
        );
        return;
      }

      pendingLinks.delete(code);
      const existing = state.bindings[pending.uid];
      const nowIso = new Date().toISOString();
      const newBinding: TelegramUserBinding = {
        uid: pending.uid,
        chatId,
        username,
        name: pending.name,
        email: pending.email,
        prefs: existing?.prefs || { ...DEFAULT_PREFS },
        snapshot: existing?.snapshot,
        linkedAt: existing?.linkedAt || nowIso,
        updatedAt: nowIso,
      };
      state.bindings[pending.uid] = newBinding;
      saveState();

      appendLog({
        eventType: 'account_linked',
        recipientUid: pending.uid,
        recipientLabel: `${pending.name} (@${username || chatId})`,
        status: 'sent',
        summary: '১-ক্লিক টেলিগ্রাম বট কানেকশন সফল',
      });

      await sendTelegramMessage(
        chatId,
        `✅ <b>CaptchaPay লাইভ রিসিট ও স্মার্ট কন্ট্রোল যুক্ত হয়েছে!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 নাম: <b>${escapeHtml(pending.name)}</b>\n` +
          `📧 ইমেইল: <code>${escapeHtml(pending.email)}</code>\n` +
          `🆔 Chat ID: <code>${escapeHtml(chatId)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✨ এখন অ্যাপ বন্ধ থাকলেও রিসিট পাবেন এবং নিচের মেনু বাটন ব্যবহার করে ব্যালেন্স, হিস্ট্রি, OTP ও সাপোর্ট চালাতে পারবেন!` +
          buildFooterLine(),
        buildMainMenuKeyboard()
      );
      return;
    }

    const matched = findBindingByChatId(chatId);
    await sendTelegramMessage(
      chatId,
      buildHomeCardText(matched, chatId),
      matched ? buildMainMenuKeyboard() : undefined
    );
    return;
  }

  if (text === '/myid' || text.startsWith('/myid@')) {
    await sendTelegramMessage(
      chatId,
      `🆔 আপনার টেলিগ্রাম Chat ID হলো:\n<code>${escapeHtml(chatId)}</code>\n\nএই নম্বরটি CaptchaPay অ্যাপের <b>"টেলিগ্রাম রিসিট"</b> সেটিংসে বসিয়ে ভেরিফাই করতে পারবেন।`
    );
    return;
  }

  const binding = findBindingByChatId(chatId);

  if (text === '/help' || text.startsWith('/help@')) {
    await sendTelegramMessage(chatId, buildHelpText());
    return;
  }

  if (!binding) {
    await sendTelegramMessage(
      chatId,
      `ℹ️ এই টেলিগ্রাম আইডিটি (<code>${escapeHtml(chatId)}</code>) এখনো কোনো CaptchaPay অ্যাকাউন্টের সাথে যুক্ত নয়।\n\nঅ্যাপের <b>"টেলিগ্রাম রিসিট"</b> বাটনে গিয়ে <code>${escapeHtml(chatId)}</code> বসিয়ে ভেরিফাই করুন।`
    );
    return;
  }

  if (text === '/menu' || text.startsWith('/menu@')) {
    await sendTelegramMessage(
      chatId,
      buildHomeCardText(binding, chatId),
      buildMainMenuKeyboard()
    );
    return;
  }

  if (text === '/balance' || text.startsWith('/balance@')) {
    await sendTelegramMessage(chatId, buildBalanceCard(binding), [
      [
        { text: '📜 লেনদেন হিস্ট্রি', callback_data: 'menu:history' },
        { text: '📊 আজকের কাজ', callback_data: 'menu:stats' },
      ],
      [{ text: '🏠 মূল মেনু', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (text === '/history' || text.startsWith('/history@')) {
    await sendTelegramMessage(chatId, buildHistoryCard(binding), [
      [
        { text: '💳 ব্যালেন্স দেখুন', callback_data: 'menu:balance' },
        { text: '🏠 মূল মেনু', callback_data: 'menu:home' },
      ],
    ]);
    return;
  }

  if (text === '/stats' || text.startsWith('/stats@')) {
    await sendTelegramMessage(chatId, buildStatsCard(binding), [
      [
        { text: '📈 ডেইলি রিপোর্ট', callback_data: 'menu:digest' },
        { text: '🏠 মূল মেনু', callback_data: 'menu:home' },
      ],
    ]);
    return;
  }

  if (text === '/digest' || text.startsWith('/digest@')) {
    await sendTelegramMessage(chatId, buildDigestCard(binding), [
      [{ text: '🏠 মূল মেনু', callback_data: 'menu:home' }],
    ]);
    return;
  }

  if (text === '/otp' || text.startsWith('/otp@')) {
    const otp = generateAndStoreOtp(binding.uid);
    await sendTelegramMessage(
      chatId,
      `🔐 <b>CaptchaPay সিকিউরিটি OTP কোড</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `আপনার ওয়ান-টাইম কোড: <code>${otp}</code>\n` +
        `⏳ মেয়াদ: ৩ মিনিট\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ এই কোডটি অন্য কারো সাথে শেয়ার করবেন না।`
    );
    return;
  }

  if (text === '/status' || text.startsWith('/status@')) {
    const mutedActive = binding.prefs.mutedUntil && new Date(binding.prefs.mutedUntil).getTime() > Date.now();
    await sendTelegramMessage(
      chatId,
      `🟢 <b>CaptchaPay লাইভ রিসিট সক্রিয় আছে</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 অ্যাকাউন্ট: <b>${escapeHtml(binding.name)}</b>\n` +
        `📧 ইমেইল: <code>${escapeHtml(binding.email)}</code>\n` +
        `🔔 P2P প্রাপ্তি: ${binding.prefs.p2pReceived ? '✅ চালু' : '❌ বন্ধ'}\n` +
        `💸 উইথড্র রিসিট: ${binding.prefs.withdrawals ? '✅ চালু' : '❌ বন্ধ'}\n` +
        `📱 রিচার্জ রিসিট: ${binding.prefs.recharges ? '✅ চালু' : '❌ বন্ধ'}\n` +
        `🔕 নীরব মোড: ${mutedActive ? 'চালু' : 'বন্ধ'}\n` +
        `🎯 মিনিমাম ফিল্টার: ৳${escapeHtml(binding.prefs.minAlertAmount || 0)}`,
      [[{ text: '⚙️ অ্যালার্ট সেটিংস বদলান', callback_data: 'menu:prefs' }]]
    );
    return;
  }

  if (text === '/unlink' || text.startsWith('/unlink@')) {
    const targetUid = binding.uid;
    const targetChatId = binding.chatId;
    delete state.bindings[targetUid];
    pendingOtps.delete(targetUid);
    saveState({ skipBindingsMerge: true });

    appendLog({
      eventType: 'account_unlinked_via_bot',
      recipientUid: targetUid,
      recipientLabel: `${binding.name} (${targetChatId})`,
      status: 'sent',
      summary: 'টেলিগ্রাম বট কমান্ড থেকে সংযোগ বিচ্ছিন্ন করা হয়েছে',
    });

    await sendTelegramMessage(
      chatId,
      `🔌 <b>আপনার CaptchaPay অ্যাকাউন্ট সফলভাবে সংযোগ বিচ্ছিন্ন করা হয়েছে!</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `এখন থেকে এই টেলিগ্রাম আইডিতে আর কোনো রিসিট বা নোটিফিকেশন আসবে না।\n\n` +
        `পুনরায় যুক্ত করতে চাইলে CaptchaPay অ্যাপের <b>"টেলিগ্রাম রিসিট"</b> মেনু থেকে <code>${escapeHtml(chatId)}</code> বসিয়ে আবার সংযোগ করুন।`
    );
    return;
  }

  if (text.startsWith('/mute') || text === '/unmute' || text.startsWith('/unmute@')) {
    if (text.startsWith('/unmute')) {
      binding.prefs.mutedUntil = '';
      binding.updatedAt = new Date().toISOString();
      state.bindings[binding.uid] = binding;
      saveState();
      await sendTelegramMessage(
        chatId,
        `🔔 <b>নীরব মোড বন্ধ করা হয়েছে!</b> এখন থেকে সব লাইভ রিসিট পাবেন।`
      );
      return;
    }

    const arg = text.split(/\s+/)[1]?.toLowerCase() || '';
    if (arg === '1h' || arg === '8h' || arg === '24h') {
      const hours = arg === '1h' ? 1 : arg === '8h' ? 8 : 24;
      binding.prefs.mutedUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      binding.updatedAt = new Date().toISOString();
      state.bindings[binding.uid] = binding;
      saveState();
      await sendTelegramMessage(
        chatId,
        `🔕 <b>${hours} ঘণ্টার জন্য নীরব মোড চালু করা হয়েছে।</b>\nবন্ধ করতে লিখুন: <code>/unmute</code>`
      );
      return;
    }

    await sendTelegramMessage(
      chatId,
      `🔕 নিচের বাটনে ট্যাপ করুন অথবা লিখুন <code>/mute 1h</code>, <code>/mute 8h</code> বা <code>/unmute</code>:`,
      [
        [
          { text: '🔕 ১ ঘণ্টা সাইলেন্ট', callback_data: 'mute:1h' },
          { text: '🌙 ৮ ঘণ্টা সাইলেন্ট', callback_data: 'mute:8h' },
        ],
        [{ text: '🔔 নীরব মোড বন্ধ', callback_data: 'mute:off' }],
      ]
    );
    return;
  }

  if (text.startsWith('/support')) {
    const supportBody = text.replace(/^\/support(@\S+)?\s*/i, '').trim();
    if (!supportBody) {
      await sendTelegramMessage(
        chatId,
        `🆘 <b>অ্যাডমিনকে সরাসরি মেসেজ পাঠাতে লিখুন:</b>\n<code>/support আপনার সমস্যার বিবরণ...</code>`
      );
      return;
    }

    const adminBinding = getAdminBinding();
    if (!adminBinding) {
      await sendTelegramMessage(
        chatId,
        `⚠️ অ্যাডমিন এখনো টেলিগ্রাম বট সাপোর্ট যুক্ত করেননি। অনুগ্রহ করে ওয়েব অ্যাপের সাপোর্ট অপশন ব্যবহার করুন।`
      );
      return;
    }

    const relayMsg =
      `🆘 <b>নতুন টেলিগ্রাম সাপোর্ট মেসেজ!</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 প্রেরক: <b>${escapeHtml(binding.name)}</b>\n` +
      `📧 ইমেইল: <code>${escapeHtml(binding.email)}</code>\n` +
      `🆔 UID: <code>${escapeHtml(binding.uid)}</code>\n` +
      `💬 বার্তা:\n<i>${escapeHtml(supportBody.slice(0, 800))}</i>\n` +
      `━━━━━━━━━━━━━━━━━━`;

    const relayRes = await sendTelegramMessage(adminBinding.chatId, relayMsg);
    appendLog({
      eventType: 'telegram_support_relay',
      recipientUid: binding.uid,
      recipientLabel: `${binding.name} → Admin`,
      status: relayRes.ok ? 'sent' : 'failed',
      summary: `সাপোর্ট মেসেজ: "${supportBody.slice(0, 60)}"`,
      error: relayRes.error,
    });

    const safeHandle = await resolveSafeChannelUsername(binding.uid, binding.email);
    void sendChannelMessage(
      `🆘 <b>নতুন সাপোর্ট রিকোয়েস্ট এসেছে</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
        `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত</i>\n` +
        `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
        `━━━━━━━━━━━━━━━━━━`,
      'channel_support_notice',
      `চ্যানেল: সাপোর্ট রিকোয়েস্ট (${safeHandle})`
    );

    await sendTelegramMessage(
      chatId,
      relayRes.ok
        ? `✅ আপনার সাপোর্ট বার্তাটি অ্যাডমিনের কাছে পাঠানো হয়েছে।`
        : `⚠️ বার্তা পাঠানো যায়নি, একটু পর আবার চেষ্টা করুন।`
    );
    return;
  }

  // If already linked, reply with connected greeting and main menu buttons
  await sendTelegramMessage(
    chatId,
    buildHomeCardText(binding, chatId),
    buildMainMenuKeyboard()
  );
  return;
}

async function runEveningDigestCheck(): Promise<void> {
  const token = getActiveBotToken();
  if (!token) return;
  const { dateStr, hour } = getDhakaDateParts();
  if (hour !== 21) return; // Send at 9 PM Asia/Dhaka

  for (const b of Object.values(state.bindings)) {
    if (!b.chatId || b.prefs.dailyDigest === false || b.lastDigestDate === dateStr) continue;
    if (!shouldDeliverAlert(b, 0)) continue;
    b.lastDigestDate = dateStr;
    state.bindings[b.uid] = b;
    saveState();

    const res = await sendTelegramMessage(b.chatId, buildDigestCard(b), [
      [{ text: '🏠 মূল মেনু খুলুন', callback_data: 'menu:home' }],
    ]);
    appendLog({
      eventType: 'daily_digest',
      recipientUid: b.uid,
      recipientLabel: `${b.name} (${b.chatId})`,
      status: res.ok ? 'sent' : 'failed',
      summary: `দৈনিক রাতের আয়ের রিপোর্ট (${dateStr})`,
      error: res.error,
    });
  }
}

async function pollTelegramOnce(): Promise<void> {
  if (isPollInFlight) return;
  const token = getActiveBotToken();
  if (!token) {
    isPollingActive = false;
    return;
  }

  isPollInFlight = true;
  try {
    const resp = await callTelegramApi<TelegramUpdate[]>(token, 'getUpdates', {
      offset: state.lastUpdateId ? state.lastUpdateId + 1 : 0,
      timeout: 0,
      allowed_updates: ['message', 'callback_query'],
    });
    if (resp.ok && Array.isArray(resp.result)) {
      isPollingActive = true;
      for (const upd of resp.result) {
        if (typeof upd.update_id !== 'number' || upd.update_id <= state.lastUpdateId) {
          continue;
        }
        state.lastUpdateId = upd.update_id;
        saveState();
        await handleIncomingTelegramUpdate(upd);
      }
    } else if (resp.description?.toLowerCase().includes('webhook')) {
      await callTelegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
    }
  } catch {
    // Transient network error; retry on next tick
  } finally {
    isPollInFlight = false;
  }
}

export function startTelegramPolling(): void {
  if (isPollingLoopRunning) return;
  isPollingLoopRunning = true;

  const tick = async () => {
    const token = getActiveBotToken();
    if (token) {
      if (!state.botInfo) {
        try {
          const me = await callTelegramApi<{ id: number; username?: string; first_name?: string }>(
            token,
            'getMe'
          );
          if (me.ok && me.result) {
            state.botInfo = {
              id: me.result.id,
              username: me.result.username || '',
              firstName: me.result.first_name || 'CaptchaPay Bot',
            };
            saveState();
          }
        } catch {
          // ignore
        }
      }
      if (state.botInfo && state.commandsRegisteredForUsername !== (state.botInfo.username || 'configured')) {
        await registerBotSlashCommands(token, state.botInfo.username || 'configured');
      }
      await pollTelegramOnce();
      await runEveningDigestCheck();
    } else {
      isPollingActive = false;
    }

    pollingTimer = setTimeout(() => {
      void tick();
    }, 3000);
  };

  void tick();
}

export function stopTelegramPolling(): void {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  isPollingLoopRunning = false;
  isPollingActive = false;
}

export function registerTelegramRoutes(app: express.Express): void {
  setInterval(() => {
    const now = Date.now();
    for (const [code, item] of pendingLinks.entries()) {
      if (item.expiresAt < now) {
        pendingLinks.delete(code);
      }
    }
    for (const [uid, otp] of pendingOtps.entries()) {
      if (otp.expiresAt < now) {
        pendingOtps.delete(uid);
      }
    }
  }, 5 * 60 * 1000);

  // Optional Webhook Endpoint
  app.post('/api/telegram/webhook/:secret', async (req: Request, res: Response) => {
    const secret = String(req.params.secret || '');
    if (!secret || secret !== state.webhookSecret) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    try {
      const update = req.body as TelegramUpdate;
      await handleIncomingTelegramUpdate(update);
      res.json({ ok: true });
    } catch {
      res.status(200).json({ ok: true });
    }
  });

  // 1. User Status
  app.get('/api/telegram/status', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'অনুগ্রহ করে প্রথমে গুগল দিয়ে সাইন ইন করুন।' });
      return;
    }

    const token = getActiveBotToken();
    const binding = state.bindings[authUser.uid];
    res.json({
      botConfigured: Boolean(token),
      envManaged: isEnvManagedToken(),
      botUsername: state.botInfo?.username || '',
      botName: state.botInfo?.firstName || 'CaptchaPay Bot',
      pollingActive: isPollingActive,
      linked: Boolean(binding?.chatId),
      chatId: binding?.chatId || '',
      username: binding?.username || '',
      prefs: binding?.prefs || DEFAULT_PREFS,
    });
  });

  // 2. Sync existing Firestore Telegram binding & live wallet snapshot into server cache
  app.post('/api/telegram/sync', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const existing = state.bindings[authUser.uid];
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : existing?.chatId || '';
    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 64) : '';
    const prefs = body.prefs ? sanitizePrefs(body.prefs as Partial<TelegramAlertPrefs>) : existing?.prefs || { ...DEFAULT_PREFS };
    const snapshot = sanitizeSnapshot(body.snapshot, existing?.snapshot);

    if (!chatId) {
      res.json({ synced: false, linked: false });
      return;
    }
    if (!CHAT_ID_REGEX.test(chatId)) {
      res.status(400).json({ error: 'অবৈধ Chat ID' });
      return;
    }

    const nowIso = new Date().toISOString();
    state.bindings[authUser.uid] = {
      uid: authUser.uid,
      chatId,
      username: username || existing?.username || '',
      name: authUser.name,
      email: authUser.email,
      prefs,
      snapshot,
      lastDigestDate: existing?.lastDigestDate,
      linkedAt: existing?.linkedAt || nowIso,
      updatedAt: nowIso,
    };
    saveState();

    res.json({
      synced: true,
      linked: true,
      binding: state.bindings[authUser.uid],
    });
  });

  // 3. Generate 1-Click Connect Deep Link Code
  app.post('/api/telegram/link-code', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'অনুগ্রহ করে প্রথমে লগইন করুন।' });
      return;
    }
    const token = getActiveBotToken();
    if (!token) {
      res.status(400).json({ error: 'অ্যাডমিন এখনো টেলিগ্রাম বট কনফিগার করেননি।' });
      return;
    }

    if (!state.botInfo?.username) {
      const me = await callTelegramApi<{ id: number; username?: string; first_name?: string }>(token, 'getMe');
      if (me.ok && me.result) {
        state.botInfo = {
          id: me.result.id,
          username: me.result.username || '',
          firstName: me.result.first_name || 'CaptchaPay Bot',
        };
        saveState();
      }
    }

    const code = `CP${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    pendingLinks.set(code, {
      code,
      uid: authUser.uid,
      email: authUser.email,
      name: authUser.name,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const botUsername = state.botInfo?.username || '';
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : '';
    res.json({
      code,
      botUsername,
      deepLink,
      expiresInMinutes: 15,
    });
  });

  // 4. Manual Chat ID Connect
  app.post('/api/telegram/connect-manual', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'অনুগ্রহ করে প্রথমে লগইন করুন।' });
      return;
    }
    if (!getActiveBotToken()) {
      res.status(400).json({ error: 'অ্যাডমিন এখনো টেলিগ্রাম বট চালু করেননি।' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
    if (!CHAT_ID_REGEX.test(chatId)) {
      res.status(400).json({ error: 'সঠিক সংখ্যার Telegram Chat ID লিখুন (যেমন: 123456789)।' });
      return;
    }

    const sendRes = await sendTelegramMessage(
      chatId,
      `✅ <b>CaptchaPay লাইভ রিসিট ভেরিফিকেশন সফল!</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 অ্যাকাউন্ট: <b>${escapeHtml(authUser.name)}</b>\n` +
        `📧 ইমেইল: <code>${escapeHtml(authUser.email)}</code>\n` +
        `🆔 Chat ID: <code>${escapeHtml(chatId)}</code>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `এখন থেকে অ্যাপ বন্ধ থাকলেও লাইভ রিসিট পাবেন এবং নিচের মেনু বা <code>/menu</code> দিয়ে ব্যালেন্স, হিস্ট্রি ও সব কমান্ড ব্যবহার করতে পারবেন।` +
        buildFooterLine(),
      buildMainMenuKeyboard()
    );

    if (!sendRes.ok) {
      res.status(400).json({
        error: `টেলিগ্রামে মেসেজ পাঠানো যায়নি (${sendRes.error || 'Chat not found'})। অনুগ্রহ করে বট ওপেন করে প্রথমে /start চাপুন এবং তারপর এই Chat ID দিন।`,
      });
      return;
    }

    const existing = state.bindings[authUser.uid];
    const nowIso = new Date().toISOString();
    state.bindings[authUser.uid] = {
      uid: authUser.uid,
      chatId,
      username: existing?.username || '',
      name: authUser.name,
      email: authUser.email,
      prefs: existing?.prefs || { ...DEFAULT_PREFS },
      snapshot: existing?.snapshot,
      lastDigestDate: existing?.lastDigestDate,
      linkedAt: existing?.linkedAt || nowIso,
      updatedAt: nowIso,
    };
    saveState();

    appendLog({
      eventType: 'account_linked_manual',
      recipientUid: authUser.uid,
      recipientLabel: `${authUser.name} (${chatId})`,
      status: 'sent',
      summary: 'ম্যানুয়াল Chat ID ভেরিফিকেশন সফল',
    });

    res.json({
      linked: true,
      chatId,
      username: state.bindings[authUser.uid].username,
      prefs: state.bindings[authUser.uid].prefs,
    });
  });

  // 5. Update Alert Preferences
  app.post('/api/telegram/preferences', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const binding = state.bindings[authUser.uid];
    if (!binding?.chatId) {
      res.status(400).json({ error: 'প্রথমে আপনার টেলিগ্রাম অ্যাকাউন্ট যুক্ত করুন।' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const prefs = sanitizePrefs(body.prefs as Partial<TelegramAlertPrefs>);
    binding.prefs = prefs;
    binding.updatedAt = new Date().toISOString();
    state.bindings[authUser.uid] = binding;
    saveState();

    res.json({ ok: true, prefs });
  });

  // 6. Unlink Telegram
  app.post('/api/telegram/unlink', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'সেশন মেয়াদোত্তীর্ণ হয়েছে। অনুগ্রহ করে আবার সাইন ইন করে চেষ্টা করুন।' });
      return;
    }
    const previousBinding = state.bindings[authUser.uid];
    const previousChatId = previousBinding?.chatId;

    delete state.bindings[authUser.uid];
    pendingOtps.delete(authUser.uid);
    for (const [code, entry] of pendingLinks.entries()) {
      if (entry.uid === authUser.uid) {
        pendingLinks.delete(code);
      }
    }
    saveState({ skipBindingsMerge: true });

    if (previousChatId) {
      try {
        await sendTelegramMessage(
          previousChatId,
          `🔌 <b>টেলিগ্রাম বট সফলভাবে সংযোগ বিচ্ছিন্ন করা হয়েছে!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 অ্যাকাউন্ট: <b>${escapeHtml(authUser.name)}</b>\n` +
            `🆔 Chat ID: <code>${escapeHtml(previousChatId)}</code>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `এখন থেকে এই টেলিগ্রাম আইডিতে আর কোনো রিসিট বা অ্যালার্ট আসবে না।\n` +
            `আপনি চাইলে যেকোনো সময় CaptchaPay ওয়েবসাইট থেকে পুনরায় সংযোগ করতে পারবেন।`
        );
      } catch {
        // ignore notification error on unlink
      }
    }

    appendLog({
      eventType: 'account_unlinked',
      recipientUid: authUser.uid,
      recipientLabel: `${authUser.name} (${previousChatId || 'No Chat ID'})`,
      status: 'sent',
      summary: 'টেলিগ্রাম অ্যাকাউন্ট সংযোগ বিচ্ছিন্ন করা হয়েছে',
    });

    res.json({ ok: true, linked: false });
  });

  // 7. Send Test Live Receipt
  app.post('/api/telegram/test', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!getActiveBotToken()) {
      res.status(400).json({ error: 'টেলিগ্রাম বট কনফিগার করা নেই।' });
      return;
    }
    const binding = state.bindings[authUser.uid];
    if (!binding?.chatId) {
      res.status(400).json({ error: 'প্রথমে আপনার টেলিগ্রাম অ্যাকাউন্ট কানেক্ট করুন।' });
      return;
    }

    const receipt =
      `🧪 <b>CaptchaPay টেস্ট লাইভ রিসিট</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 গ্রাহক: <b>${escapeHtml(authUser.name)}</b>\n` +
      `💰 নমুনা পরিমাণ: <b>+৳৫০০.০০</b>\n` +
      `📌 অবস্থা: ✅ সক্রিয় (অ্যাপ বন্ধ থাকলেও কাজ করবে)\n` +
      `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `টেলিগ্রামে <code>/menu</code> লিখে সব কমান্ড ব্যবহার করুন!` +
      buildFooterLine();

    const sendRes = await sendTelegramMessage(
      binding.chatId,
      receipt,
      buildMainMenuKeyboard()
    );
    appendLog({
      eventType: 'user_test',
      recipientUid: authUser.uid,
      recipientLabel: `${authUser.name} (${binding.chatId})`,
      status: sendRes.ok ? 'sent' : 'failed',
      summary: 'ইউজার টেস্ট লাইভ রিসিট',
      error: sendRes.error,
    });

    if (!sendRes.ok) {
      res.status(400).json({ error: `রিসিট পাঠানো ব্যর্থ হয়েছে: ${sendRes.error}` });
      return;
    }
    res.json({ ok: true });
  });

  // 7b. Telegram 2FA OTP Request & Verification
  app.post('/api/telegram/otp/request', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const binding = state.bindings[authUser.uid];
    if (!binding?.chatId) {
      res.status(400).json({ error: 'প্রথমে আপনার টেলিগ্রাম অ্যাকাউন্ট যুক্ত করুন।' });
      return;
    }

    const otp = generateAndStoreOtp(authUser.uid);
    const sendRes = await sendTelegramMessage(
      binding.chatId,
      `🔐 <b>CaptchaPay ওয়ান-টাইম ভেরিফিকেশন কোড</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `আপনার ৬ সংখ্যার OTP: <code>${otp}</code>\n` +
        `⏳ মেয়াদ: ৩ মিনিট\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ নিরাপত্তার স্বার্থে এই কোডটি কাউকে বলবেন না।`
    );
    if (!sendRes.ok) {
      res.status(400).json({ error: `টেলিগ্রামে OTP পাঠানো যায়নি: ${sendRes.error}` });
      return;
    }
    res.json({ ok: true, expiresInSeconds: 180 });
  });

  app.post('/api/telegram/otp/verify', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const entry = pendingOtps.get(authUser.uid);
    if (!entry || entry.expiresAt < Date.now() || entry.code !== code) {
      res.status(400).json({ error: 'OTP কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে।' });
      return;
    }
    pendingOtps.delete(authUser.uid);
    res.json({ ok: true, verified: true });
  });

  // 8. Authoritative Live Receipt & Channel Notification Dispatch Endpoint
  app.post('/api/telegram/dispatch', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (isVerifiedAdmin(authUser) && (!getActiveBotToken() || !isChannelConfigured())) {
      await hydrateTelegramFromFirestore(authUser.idToken, authUser.email);
    }
    if (!getActiveBotToken() && !isChannelConfigured()) {
      res.json({ ok: true, skipped: true, reason: 'bot_not_configured' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';

    // A) User-triggered P2P Transfer Receipt
    if (eventType === 'p2p_transfer') {
      const transferId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!transferId) {
        res.status(400).json({ error: 'Missing transferId' });
        return;
      }

      const transferDoc = await fetchFirestoreDocument('p2pTransfers', transferId, authUser.idToken);
      if (!transferDoc || transferDoc.senderId !== authUser.uid) {
        res.status(403).json({ error: 'Forbidden transfer receipt' });
        return;
      }

      const idempKey = `p2p:${transferId}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }

      const recipientUid = String(transferDoc.recipientId || transferDoc.receiverId || '');
      const senderName = String(transferDoc.senderName || authUser.name);
      const senderEmail = String(transferDoc.senderEmail || authUser.email);
      const recipientName = String(transferDoc.recipientName || 'প্রাপক');
      const recipientEmail = String(transferDoc.recipientEmail || '');
      const numAmount = Number(transferDoc.amount) || 0;
      const amount = formatMoney(numAmount);
      const fee = formatMoney(transferDoc.fee);
      const totalDeducted = formatMoney(transferDoc.totalDeducted);
      const note = typeof transferDoc.note === 'string' ? transferDoc.note.trim() : '';
      const timeLabel = formatDhakaTime(String(transferDoc.claimedAtIso || transferDoc.createdAtIso || ''));

      // Update server snapshot history for recipient & sender immediately
      const prevRecBal = state.bindings[recipientUid]?.snapshot?.balance;
      pushMiniTx(
        recipientUid,
        {
          id: transferId,
          label: `P2P প্রাপ্তি (${senderName})`,
          amount: numAmount,
          status: 'সম্পন্ন',
          time: timeLabel,
        },
        typeof prevRecBal === 'number' ? prevRecBal + numAmount : undefined
      );
      const prevSendBal = state.bindings[authUser.uid]?.snapshot?.balance;
      pushMiniTx(
        authUser.uid,
        {
          id: transferId,
          label: `P2P সেন্ড (${recipientName})`,
          amount: -(Number(transferDoc.totalDeducted) || numAmount),
          status: 'সম্পন্ন',
          time: timeLabel,
        },
        typeof prevSendBal === 'number'
          ? Math.max(0, prevSendBal - (Number(transferDoc.totalDeducted) || numAmount))
          : undefined
      );

      let recipientDelivered = false;
      const recipientBinding = state.bindings[recipientUid];
      if (
        getActiveBotToken() &&
        recipientBinding &&
        recipientBinding.prefs.p2pReceived !== false &&
        shouldDeliverAlert(recipientBinding, numAmount)
      ) {
        const msg =
          `💚 <b>CaptchaPay লাইভ রিসিট (টাকা প্রাপ্তি)</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `আপনার অ্যাকাউন্টে নতুন P2P ব্যালেন্স অটোমেটিক যোগ হয়েছে!\n\n` +
          `💰 প্রাপ্ত পরিমাণ: <b>+৳${escapeHtml(amount)}</b>\n` +
          `👤 প্রেরক: <b>${escapeHtml(senderName)}</b>\n` +
          `📧 প্রেরক ইমেইল: <code>${escapeHtml(senderEmail)}</code>\n` +
          (note ? `📝 নোট: <i>${escapeHtml(note)}</i>\n` : '') +
          `🆔 ট্রান্সফার আইডি: <code>${escapeHtml(transferId)}</code>\n` +
          `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✨ কোনো ক্লেইম ছাড়াই টাকা সরাসরি আপনার ব্যালেন্সে যোগ হয়েছে।` +
          buildFooterLine();

        const sendRes = await sendTelegramMessage(recipientBinding.chatId, msg, [
          [{ text: '💳 নতুন ব্যালেন্স দেখুন', callback_data: 'menu:balance' }],
        ]);
        recipientDelivered = sendRes.ok;
        appendLog({
          eventType: 'p2p_received',
          recipientUid,
          recipientLabel: `${recipientBinding.name} (${recipientBinding.chatId})`,
          status: sendRes.ok ? 'sent' : 'failed',
          summary: `P2P প্রাপ্তি ৳${amount} (${senderName} → ${recipientName})`,
          error: sendRes.error,
        });
        if (recipientEmail) {
          void sendTransactionEmailNotice({
            email: recipientEmail,
            name: recipientName,
            type: 'p2p_received',
            amount: numAmount,
            details: `প্রেরক: ${senderName} (${senderEmail})${note ? ` [নোট: ${note}]` : ''}`,
            trxId: transferId,
          });
        }
      }

      let senderDelivered = false;
      const senderBinding = state.bindings[authUser.uid];
      if (authUser.email) {
        void sendTransactionEmailNotice({
          email: authUser.email,
          name: authUser.name,
          type: 'p2p_sent',
          amount: numAmount,
          details: `প্রাপক: ${recipientName}`,
          trxId: transferId,
        });
      }
      if (
        getActiveBotToken() &&
        senderBinding &&
        senderBinding.prefs.p2pSent !== false &&
        shouldDeliverAlert(senderBinding, numAmount)
      ) {
        const senderMsg =
          `📤 <b>CaptchaPay P2P সেন্ড কনফার্মেশন রিসিট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💸 পাঠানো হয়েছে: <b>৳${escapeHtml(amount)}</b>\n` +
          `🏷️ চার্জ/ফি: ৳${escapeHtml(fee)} | মোট কাটা: <b>৳${escapeHtml(totalDeducted)}</b>\n` +
          `👤 প্রাপক: <b>${escapeHtml(recipientName)}</b>\n` +
          (note ? `📝 নোট: <i>${escapeHtml(note)}</i>\n` : '') +
          `🆔 ট্রান্সফার আইডি: <code>${escapeHtml(transferId)}</code>\n` +
          `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
          `━━━━━━━━━━━━━━━━━━` +
          buildFooterLine();

        const sendRes = await sendTelegramMessage(senderBinding.chatId, senderMsg);
        senderDelivered = sendRes.ok;
        appendLog({
          eventType: 'p2p_sent',
          recipientUid: authUser.uid,
          recipientLabel: `${authUser.name} (${senderBinding.chatId})`,
          status: sendRes.ok ? 'sent' : 'failed',
          summary: `P2P পাঠানো ৳${amount} → ${recipientName}`,
          error: sendRes.error,
        });
      }

      // Admin Master Live Radar Notification
      const adminBinding = getAdminBinding();
      if (
        getActiveBotToken() &&
        adminBinding &&
        state.adminRadarEnabled &&
        adminBinding.uid !== authUser.uid &&
        adminBinding.uid !== recipientUid
      ) {
        const radarMsg =
          `📡 <b>[Admin Radar] নতুন P2P ট্রান্সফার</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 প্রেরক: <b>${escapeHtml(senderName)}</b>\n` +
          `🎯 প্রাপক: <b>${escapeHtml(recipientName)}</b>\n` +
          `💰 পরিমাণ: <b>৳${escapeHtml(amount)}</b> (ফি: ৳${escapeHtml(fee)})\n` +
          `🆔 <code>${escapeHtml(transferId)}</code>`;
        void sendTelegramMessage(adminBinding.chatId, radarMsg);
      }

      // Dedicated Channel Post (Privacy Masked: hides real names & emails)
      const senderHandle = await resolveSafeChannelUsername(authUser.uid, senderEmail, authUser.idToken);
      const recipientHandle = await resolveSafeChannelUsername(recipientUid, recipientEmail);
      void sendChannelMessage(
        `💸 <b>নতুন P2P ব্যালেন্স ট্রান্সফার সম্পন্ন</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📤 প্রেরক ইউজারনেম: <b>${escapeHtml(senderHandle)}</b>\n` +
          `📥 প্রাপক ইউজারনেম: <b>${escapeHtml(recipientHandle)}</b>\n` +
          `💰 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
          `🔐 নাম ও ইমেইল: <i>নিরাপত্তার স্বার্থে গোপন রাখা হয়েছে</i>\n` +
          `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_p2p_transfer',
        `চ্যানেল: P2P ৳${amount} (${senderHandle} → ${recipientHandle})`
      );

      res.json({ ok: true, recipientDelivered, senderDelivered });
      return;
    }

    // A2) New User Withdrawal Request -> Admin Radar + Dedicated Channel (Masked PII)
    if (eventType === 'admin_new_withdrawal') {
      const withdrawalId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!withdrawalId) {
        res.status(400).json({ error: 'Missing withdrawalId' });
        return;
      }
      const wDoc = await fetchFirestoreDocument('withdrawals', withdrawalId, authUser.idToken);
      if (!wDoc || wDoc.userId !== authUser.uid || wDoc.status !== 'pending') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const idempKey = `radar_w:${withdrawalId}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }

      const amount = formatMoney(wDoc.amount);
      const adminBinding = getAdminBinding();
      if (getActiveBotToken() && adminBinding && state.adminRadarEnabled) {
        const msg =
          `📡 <b>[Admin Radar] নতুন উইথড্র রিকোয়েস্ট!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজার: <b>${escapeHtml(wDoc.userName || authUser.name)}</b>\n` +
          `📧 ইমেইল: <code>${escapeHtml(wDoc.userEmail || authUser.email)}</code>\n` +
          `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
          `🏦 মাধ্যম: <b>${escapeHtml(wDoc.method)}</b> (${escapeHtml(wDoc.accountType)})\n` +
          `📱 নম্বর: <code>${escapeHtml(wDoc.accountNumber)}</code>\n` +
          `🆔 <code>${escapeHtml(withdrawalId)}</code>\n` +
          `━━━━━━━━━━━━━━━━━━` +
          buildFooterLine();
        const sendRes = await sendTelegramMessage(adminBinding.chatId, msg);
        appendLog({
          eventType: 'admin_radar_withdrawal',
          recipientUid: adminBinding.uid,
          recipientLabel: `Admin Radar (${adminBinding.chatId})`,
          status: sendRes.ok ? 'sent' : 'failed',
          summary: `নতুন উইথড্র রিকোয়েস্ট ৳${amount} (${String(wDoc.method || '')})`,
          error: sendRes.error,
        });
      }

      // Dedicated Channel Post (Hides Name, Email, Phone/Account Number)
      const safeHandle = await resolveSafeChannelUsername(
        authUser.uid,
        String(wDoc.userEmail || authUser.email),
        authUser.idToken
      );
      void sendChannelMessage(
        `🏦 <b>নতুন উইথড্র রিকোয়েস্ট এসেছে!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
          `💳 মাধ্যম: <b>${escapeHtml(wDoc.method)}</b> (${escapeHtml(wDoc.accountType)})\n` +
          `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
          `⏳ স্ট্যাটাস: <b>অপেক্ষমান (Pending)</b>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_new_withdrawal',
        `চ্যানেল: নতুন উইথড্র রিকোয়েস্ট ৳${amount} (${safeHandle})`
      );

      const userEmailToNotify = String(wDoc.userEmail || authUser.email);
      const userNameToNotify = String(wDoc.userName || authUser.name);
      if (userEmailToNotify) {
        void sendTransactionEmailNotice({
          email: userEmailToNotify,
          name: userNameToNotify,
          type: 'withdrawal_request',
          amount: Number(wDoc.amount) || 0,
          details: `${wDoc.method} (${wDoc.accountType}) - ${wDoc.accountNumber}`,
          trxId: withdrawalId,
        });
      }

      res.json({ ok: true });
      return;
    }

    // A3) New User Recharge Request -> Admin Radar + Dedicated Channel (Masked PII)
    if (eventType === 'admin_new_recharge') {
      const rechargeId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!rechargeId) {
        res.status(400).json({ error: 'Missing rechargeId' });
        return;
      }
      const rDoc = await fetchFirestoreDocument('recharges', rechargeId, authUser.idToken);
      if (!rDoc || rDoc.userId !== authUser.uid || rDoc.status !== 'pending') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const idempKey = `radar_r:${rechargeId}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }

      const amount = formatMoney(rDoc.amount);
      const isDeposit = String(rDoc.method || '') !== 'Mobile Recharge';
      const methodLabel = String(rDoc.senderSim || rDoc.method || '');
      const trxId = String(rDoc.trxId || '');
      const adminBinding = getAdminBinding();
      if (getActiveBotToken() && adminBinding && state.adminRadarEnabled) {
        const msg = isDeposit
          ? `📡 <b>[Admin Radar] নতুন ডিপোজিট রিকোয়েস্ট!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 ইউজার: <b>${escapeHtml(rDoc.userName || authUser.name)}</b>\n` +
            `📧 ইমেইল: <code>${escapeHtml(rDoc.userEmail || authUser.email)}</code>\n` +
            `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
            `🏦 মাধ্যম: <b>${escapeHtml(methodLabel)}</b>\n` +
            `📞 সেন্ডার: <code>${escapeHtml(rDoc.senderNumber)}</code>\n` +
            (trxId ? `🔑 TrxID: <code>${escapeHtml(trxId)}</code>\n` : '') +
            `🆔 <code>${escapeHtml(rechargeId)}</code>\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine()
          : `📡 <b>[Admin Radar] নতুন মোবাইল রিচার্জ রিকোয়েস্ট!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 ইউজার: <b>${escapeHtml(rDoc.userName || authUser.name)}</b>\n` +
            `📧 ইমেইল: <code>${escapeHtml(rDoc.userEmail || authUser.email)}</code>\n` +
            `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
            `📞 নম্বর: <code>${escapeHtml(rDoc.senderNumber)}</code> (${escapeHtml(methodLabel)})\n` +
            `🆔 <code>${escapeHtml(rechargeId)}</code>\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine();
        const sendRes = await sendTelegramMessage(adminBinding.chatId, msg);
        appendLog({
          eventType: 'admin_radar_recharge',
          recipientUid: adminBinding.uid,
          recipientLabel: `Admin Radar (${adminBinding.chatId})`,
          status: sendRes.ok ? 'sent' : 'failed',
          summary: isDeposit
            ? `নতুন ডিপোজিট রিকোয়েস্ট ৳${amount} (${methodLabel})`
            : `নতুন রিচার্জ রিকোয়েস্ট ৳${amount} (${String(rDoc.senderNumber || '')})`,
          error: sendRes.error,
        });
      }

      // Dedicated Channel Post (Hides Name, Email, Mobile Number)
      const safeHandle = await resolveSafeChannelUsername(
        authUser.uid,
        String(rDoc.userEmail || authUser.email),
        authUser.idToken
      );
      void sendChannelMessage(
        isDeposit
          ? `💳 <b>নতুন ওয়ালেট ডিপোজিট রিকোয়েস্ট এসেছে!</b>\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
              `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
              `🏦 পেমেন্ট মাধ্যম: <b>${escapeHtml(methodLabel)}</b>\n` +
              `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
              `⏳ স্ট্যাটাস: <b>অপেক্ষমান (Pending)</b>\n` +
              `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
              `━━━━━━━━━━━━━━━━━━`
          : `📱 <b>নতুন মোবাইল রিচার্জ রিকোয়েস্ট এসেছে!</b>\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
              `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
              `📡 অপারেটর: <b>${escapeHtml(methodLabel)}</b>\n` +
              `🔐 নাম ও মোবাইল নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
              `⏳ স্ট্যাটাস: <b>অপেক্ষমান (Pending)</b>\n` +
              `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
              `━━━━━━━━━━━━━━━━━━`,
        'channel_new_recharge',
        isDeposit
          ? `চ্যানেল: নতুন ডিপোজিট রিকোয়েস্ট ৳${amount} (${safeHandle})`
          : `চ্যানেল: নতুন রিচার্জ রিকোয়েস্ট ৳${amount} (${safeHandle})`
      );

      const rechargeEmail = String(rDoc.userEmail || authUser.email);
      const rechargeName = String(rDoc.userName || authUser.name);
      if (rechargeEmail) {
        void sendTransactionEmailNotice({
          email: rechargeEmail,
          name: rechargeName,
          type: 'recharge_request',
          amount: Number(rDoc.amount) || 0,
          details: `${rDoc.method} - ${rDoc.senderNumber}`,
          trxId: rechargeId,
        });
      }

      res.json({ ok: true });
      return;
    }

    // A4) Daily Check-in Bonus Claim -> Channel Notification
    if (eventType === 'daily_checkin') {
      const userDoc = await fetchFirestoreDocument('users', authUser.uid, authUser.idToken);
      const todayStr = new Date().toISOString().slice(0, 10);
      if (!userDoc || String(userDoc.lastCheckInDate || '') !== todayStr) {
        res.status(403).json({ error: 'Check-in not verified' });
        return;
      }
      const idempKey = `ch_checkin:${authUser.uid}:${todayStr}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }
      const streak = Math.max(1, Number(userDoc.checkInStreak || 1));
      const reward = Math.min(20, 5 + Math.floor(streak / 3) * 5);
      const safeHandle = await resolveSafeChannelUsername(authUser.uid, authUser.email, authUser.idToken);
      void sendChannelMessage(
        `🔥 <b>ডেইলি চেক-ইন বোনাস ক্লেইম!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `🎁 প্রাপ্ত বোনাস: <b>+৳${escapeHtml(formatMoney(reward))}</b>\n` +
          `⚡ স্ট্রিক: <b>${streak} দিন</b>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_daily_checkin',
        `চ্যানেল: ডেইলি চেক-ইন ৳${reward} (${safeHandle})`
      );
      res.json({ ok: true });
      return;
    }

    // A5) Support Ticket Created -> Channel Notification (Hides Name, Email, Message Body)
    if (eventType === 'support_ticket_created') {
      const ticketId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!ticketId) {
        res.status(400).json({ error: 'Missing ticketId' });
        return;
      }
      const tDoc = await fetchFirestoreDocument('supportTickets', ticketId, authUser.idToken);
      if (!tDoc || tDoc.userId !== authUser.uid) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const idempKey = `ch_ticket_new:${ticketId}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }
      const safeHandle = await resolveSafeChannelUsername(authUser.uid, authUser.email, authUser.idToken);
      void sendChannelMessage(
        `🎫 <b>নতুন সাপোর্ট টিকেট তৈরি হয়েছে</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `📌 বিষয়: <b>${escapeHtml(String(tDoc.subject || 'সাপোর্ট').slice(0, 80))}</b>\n` +
          `🔐 নাম, ইমেইল ও বিবরণ: <i>গোপনীয়তা সুরক্ষিত</i>\n` +
          `⏳ স্ট্যাটাস: <b>ওপেন</b>\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_support_ticket',
        `চ্যানেল: নতুন সাপোর্ট টিকেট (${safeHandle})`
      );
      res.json({ ok: true });
      return;
    }

    // B) Admin-only events below
    if (!isVerifiedAdmin(authUser)) {
      res.status(403).json({ error: 'Admin permission required' });
      return;
    }

    // B1) Withdrawal Approved / Rejected
    if (eventType === 'withdrawal_processed') {
      const withdrawalId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!withdrawalId) {
        res.status(400).json({ error: 'Missing withdrawalId' });
        return;
      }

      const wDoc = await fetchFirestoreDocument('withdrawals', withdrawalId, authUser.idToken);
      if (!wDoc || (wDoc.status !== 'approved' && wDoc.status !== 'rejected')) {
        res.status(400).json({ error: 'Withdrawal is not in processed state' });
        return;
      }

      const idempKey = `withdrawal:${withdrawalId}:${String(wDoc.status)}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }

      const targetUid = String(wDoc.userId || '');
      const binding = await resolveBindingWithFirestoreFallback(targetUid, authUser.idToken);
      const isApproved = wDoc.status === 'approved';
      const numAmount = Number(wDoc.amount) || 0;
      const amount = formatMoney(numAmount);
      const timeLabel = formatDhakaTime(String(wDoc.processedAt || ''));
      const method = String(wDoc.method || '');

      // Dedicated Channel Post FIRST (works even if user hasn't linked personal bot, hides Name/Email/Phone)
      const safeHandle = await resolveSafeChannelUsername(
        targetUid,
        String(wDoc.userEmail || ''),
        authUser.idToken
      );
      void sendChannelMessage(
        isApproved
          ? `✅ <b>উইথড্র পেমেন্ট সম্পন্ন হয়েছে!</b>\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
              `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
              `🏦 মাধ্যম: <b>${escapeHtml(method)}</b>\n` +
              `🔐 নাম, নম্বর ও TrxID: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
              `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
              `━━━━━━━━━━━━━━━━━━`
          : `↩️ <b>উইথড্র বাতিল ও ব্যালেন্স রিফান্ড</b>\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
              `💰 রিফান্ড: <b>+৳${escapeHtml(amount)}</b>\n` +
              `🏦 মাধ্যম: <b>${escapeHtml(method)}</b>\n` +
              `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
              `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
              `━━━━━━━━━━━━━━━━━━`,
        isApproved ? 'channel_withdrawal_approved' : 'channel_withdrawal_rejected',
        `চ্যানেল: উইথড্র ${isApproved ? 'সম্পন্ন' : 'বাতিল'} ৳${amount} (${safeHandle})`
      );

      pushMiniTx(targetUid, {
        id: withdrawalId,
        label: `উইথড্র (${method})`,
        amount: isApproved ? -numAmount : numAmount,
        status: isApproved ? 'অ্যাপ্রুভড' : 'রিফান্ড',
        time: timeLabel,
      });

      if (
        !getActiveBotToken() ||
        !binding ||
        binding.prefs.withdrawals === false ||
        !shouldDeliverAlert(binding, numAmount)
      ) {
        res.json({ ok: true, skipped: true, reason: 'user_not_linked_or_opted_out' });
        return;
      }

      const accountNumber = String(wDoc.accountNumber || '');
      const payoutTrxId = typeof wDoc.payoutTrxId === 'string' ? wDoc.payoutTrxId : '';
      const adminNote = typeof wDoc.adminNote === 'string' ? wDoc.adminNote : '';

      const msg = isApproved
        ? `✅ <b>CaptchaPay উইথড্র পেমেন্ট সম্পন্ন রিসিট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `অভিনন্দন! আপনার উইথড্র রিকোয়েস্ট অ্যাপ্রুভ ও পেমেন্ট পাঠানো হয়েছে।\n\n` +
          `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
          `🏦 মাধ্যম: <b>${escapeHtml(method)}</b>\n` +
          `📱 অ্যাকাউন্ট: <code>${escapeHtml(accountNumber)}</code>\n` +
          (payoutTrxId ? `🔖 পেআউট TrxID: <code>${escapeHtml(payoutTrxId)}</code>\n` : '') +
          (adminNote ? `💬 অ্যাডমিন নোট: <i>${escapeHtml(adminNote)}</i>\n` : '') +
          `🆔 রিকোয়েস্ট আইডি: <code>${escapeHtml(withdrawalId)}</code>\n` +
          `🕒 প্রসেস সময়: ${escapeHtml(timeLabel)}\n` +
          `━━━━━━━━━━━━━━━━━━` +
          buildFooterLine()
        : `⚠️ <b>CaptchaPay উইথড্র বাতিল ও রিফান্ড রিসিট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `আপনার উইথড্র রিকোয়েস্ট বাতিল করা হয়েছে এবং টাকা মূল ব্যালেন্সে ফেরত দেওয়া হয়েছে।\n\n` +
          `💰 রিফান্ড পরিমাণ: <b>+৳${escapeHtml(amount)}</b>\n` +
          `🏦 মাধ্যম: ${escapeHtml(method)} (${escapeHtml(accountNumber)})\n` +
          (adminNote ? `📝 কারণ: <i>${escapeHtml(adminNote)}</i>\n` : '') +
          `🆔 রিকোয়েস্ট আইডি: <code>${escapeHtml(withdrawalId)}</code>\n` +
          `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
          `━━━━━━━━━━━━━━━━━━` +
          buildFooterLine();

      const sendRes = await sendTelegramMessage(binding.chatId, msg, [
        [{ text: '💳 ব্যালেন্স দেখুন', callback_data: 'menu:balance' }],
      ]);
      appendLog({
        eventType: isApproved ? 'withdrawal_approved' : 'withdrawal_rejected',
        recipientUid: targetUid,
        recipientLabel: `${binding.name} (${binding.chatId})`,
        status: sendRes.ok ? 'sent' : 'failed',
        summary: `উইথড্র ${isApproved ? 'অ্যাপ্রুভ' : 'বাতিল'} ৳${amount} (${method})`,
        error: sendRes.error,
      });

      res.json({ ok: true, delivered: sendRes.ok });
      return;
    }

    // B2) Recharge Approved / Rejected
    if (eventType === 'recharge_processed') {
      const rechargeId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!rechargeId) {
        res.status(400).json({ error: 'Missing rechargeId' });
        return;
      }

      const rDoc = await fetchFirestoreDocument('recharges', rechargeId, authUser.idToken);
      if (!rDoc || (rDoc.status !== 'approved' && rDoc.status !== 'rejected')) {
        res.status(400).json({ error: 'Recharge is not in processed state' });
        return;
      }

      const idempKey = `recharge:${rechargeId}:${String(rDoc.status)}`;
      if (!markDispatched(idempKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }

      const targetUid = String(rDoc.userId || '');
      const binding = await resolveBindingWithFirestoreFallback(targetUid, authUser.idToken);
      const isApproved = rDoc.status === 'approved';
      const isDeposit = String(rDoc.method || '') !== 'Mobile Recharge';
      const numAmount = Number(rDoc.amount) || 0;
      const amount = formatMoney(numAmount);
      const timeLabel = formatDhakaTime(String(rDoc.processedAt || ''));
      const sim = String(rDoc.senderSim || rDoc.method || '');

      // Dedicated Channel Post FIRST (Hides Name, Email, Mobile Number)
      const safeHandle = await resolveSafeChannelUsername(
        targetUid,
        String(rDoc.userEmail || ''),
        authUser.idToken
      );
      void sendChannelMessage(
        isDeposit
          ? isApproved
            ? `💳 <b>ওয়ালেট ডিপোজিট সফলভাবে অনুমোদিত!</b>\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
                `💵 পরিমাণ: <b>+৳${escapeHtml(amount)}</b>\n` +
                `🏦 মাধ্যম: <b>${escapeHtml(sim)}</b>\n` +
                `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
                `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
                `━━━━━━━━━━━━━━━━━━`
            : `❌ <b>ওয়ালেট ডিপোজিট বাতিল</b>\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
                `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
                `🏦 মাধ্যম: <b>${escapeHtml(sim)}</b>\n` +
                `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
                `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
                `━━━━━━━━━━━━━━━━━━`
          : isApproved
            ? `📱 <b>মোবাইল রিচার্জ সফলভাবে সম্পন্ন!</b>\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
                `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
                `📡 অপারেটর: <b>${escapeHtml(sim)}</b>\n` +
                `🔐 নাম ও মোবাইল নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
                `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
                `━━━━━━━━━━━━━━━━━━`
            : `↩️ <b>মোবাইল রিচার্জ বাতিল ও রিফান্ড</b>\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
                `💰 রিফান্ড: <b>+৳${escapeHtml(amount)}</b>\n` +
                `📡 অপারেটর: <b>${escapeHtml(sim)}</b>\n` +
                `🔐 নাম ও নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
                `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
                `━━━━━━━━━━━━━━━━━━`,
        isApproved ? 'channel_recharge_approved' : 'channel_recharge_rejected',
        isDeposit
          ? `চ্যানেল: ডিপোজিট ${isApproved ? 'অনুমোদিত' : 'বাতিল'} ৳${amount} (${safeHandle})`
          : `চ্যানেল: রিচার্জ ${isApproved ? 'সম্পন্ন' : 'বাতিল'} ৳${amount} (${safeHandle})`
      );

      pushMiniTx(targetUid, {
        id: rechargeId,
        label: isDeposit ? `ডিপোজিট (${sim})` : `রিচার্জ (${String(rDoc.senderNumber || '')})`,
        amount: isDeposit ? (isApproved ? numAmount : 0) : isApproved ? -numAmount : numAmount,
        status: isDeposit ? (isApproved ? 'যুক্ত হয়েছে' : 'বাতিল') : isApproved ? 'সম্পন্ন' : 'ফেরত',
        time: timeLabel,
      });

      if (
        !getActiveBotToken() ||
        !binding ||
        binding.prefs.recharges === false ||
        !shouldDeliverAlert(binding, numAmount)
      ) {
        res.json({ ok: true, skipped: true, reason: 'user_not_linked_or_opted_out' });
        return;
      }

      const number = String(rDoc.senderNumber || '');
      const adminNote = typeof rDoc.adminNote === 'string' ? rDoc.adminNote : '';
      const trxId = String(rDoc.trxId || '');

      const msg = isDeposit
        ? isApproved
          ? `💳 <b>CaptchaPay ডিপোজিট অনুমোদন রিসিট</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `আপনার ডিপোজিট সফলভাবে অনুমোদিত হয়েছে এবং ব্যালেন্সে যোগ করা হয়েছে!\n\n` +
            `💵 পরিমাণ: <b>+৳${escapeHtml(amount)}</b>\n` +
            `🏦 মাধ্যম: <b>${escapeHtml(sim)}</b>\n` +
            `📞 সেন্ডার: <code>${escapeHtml(number)}</code>\n` +
            (trxId ? `🔑 TrxID: <code>${escapeHtml(trxId)}</code>\n` : '') +
            (adminNote ? `💬 নোট: <i>${escapeHtml(adminNote)}</i>\n` : '') +
            `🆔 আইডি: <code>${escapeHtml(rechargeId)}</code>\n` +
            `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine()
          : `⚠️ <b>CaptchaPay ডিপোজিট বাতিল</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `আপনার ডিপোজিট রিকোয়েস্টটি বাতিল করা হয়েছে।\n\n` +
            `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
            `🏦 মাধ্যম: <b>${escapeHtml(sim)}</b>\n` +
            (trxId ? `🔑 TrxID: <code>${escapeHtml(trxId)}</code>\n` : '') +
            (adminNote ? `📝 কারণ: <i>${escapeHtml(adminNote)}</i>\n` : '') +
            `🆔 আইডি: <code>${escapeHtml(rechargeId)}</code>\n` +
            `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine()
        : isApproved
          ? `📱 <b>CaptchaPay মোবাইল রিচার্জ সম্পন্ন রিসিট</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `আপনার মোবাইল রিচার্জ রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে!\n\n` +
            `💵 পরিমাণ: <b>৳${escapeHtml(amount)}</b>\n` +
            `📞 নম্বর: <code>${escapeHtml(number)}</code> (${escapeHtml(sim)})\n` +
            (adminNote ? `💬 নোট: <i>${escapeHtml(adminNote)}</i>\n` : '') +
            `🆔 আইডি: <code>${escapeHtml(rechargeId)}</code>\n` +
            `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine()
          : `⚠️ <b>CaptchaPay রিচার্জ বাতিল ও ব্যালেন্স ফেরত</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `আপনার রিচার্জ রিকোয়েস্ট বাতিল হওয়ায় টাকা ব্যালেন্সে ফেরত দেওয়া হয়েছে।\n\n` +
            `💰 ফেরত পরিমাণ: <b>+৳${escapeHtml(amount)}</b>\n` +
            `📞 নম্বর: <code>${escapeHtml(number)}</code>\n` +
            (adminNote ? `📝 কারণ: <i>${escapeHtml(adminNote)}</i>\n` : '') +
            `🆔 আইডি: <code>${escapeHtml(rechargeId)}</code>\n` +
            `🕒 সময়: ${escapeHtml(timeLabel)}\n` +
            `━━━━━━━━━━━━━━━━━━` +
            buildFooterLine();

      const sendRes = await sendTelegramMessage(binding.chatId, msg);
      appendLog({
        eventType: isApproved ? 'recharge_approved' : 'recharge_rejected',
        recipientUid: targetUid,
        recipientLabel: `${binding.name} (${binding.chatId})`,
        status: sendRes.ok ? 'sent' : 'failed',
        summary: isDeposit
          ? `ডিপোজিট ${isApproved ? 'অ্যাপ্রুভ' : 'বাতিল'} ৳${amount} (${sim})`
          : `রিচার্জ ${isApproved ? 'অ্যাপ্রুভ' : 'বাতিল'} ৳${amount} (${number})`,
        error: sendRes.error,
      });

      res.json({ ok: true, delivered: sendRes.ok });
      return;
    }

    // B3) Admin Balance Adjustment
    if (eventType === 'balance_adjusted') {
      const targetUid = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
      const oldBalance = Number(body.oldBalance);
      const newBalance = Number(body.newBalance);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
      if (!targetUid || !Number.isFinite(oldBalance) || !Number.isFinite(newBalance)) {
        res.status(400).json({ error: 'Invalid balance adjustment payload' });
        return;
      }

      const binding = await resolveBindingWithFirestoreFallback(targetUid, authUser.idToken);
      const diff = newBalance - oldBalance;
      const isCredit = diff >= 0;
      const absDiffNum = Math.abs(diff);
      const absDiff = formatMoney(absDiffNum);

      // Dedicated Channel Post FIRST (Hides Real Name & Email)
      const safeHandle = await resolveSafeChannelUsername(targetUid, undefined, authUser.idToken);
      void sendChannelMessage(
        `${isCredit ? '🎁' : '🧾'} <b>ব্যালেন্স ${isCredit ? 'বোনাস যোগ' : 'সমন্বয়'} আপডেট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `💰 পরিমাণ: <b>${isCredit ? '+' : '-'}৳${escapeHtml(absDiff)}</b>\n` +
          (reason ? `📝 বিবরণ: <i>${escapeHtml(reason)}</i>\n` : '') +
          `🔐 নাম ও ইমেইল: <i>গোপনীয়তা সুরক্ষিত</i>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_balance_adjusted',
        `চ্যানেল: ব্যালেন্স ${isCredit ? '+' : '-'}৳${absDiff} (${safeHandle})`
      );

      pushMiniTx(
        targetUid,
        {
          id: `adj-${Date.now()}`,
          label: reason || 'অ্যাডমিন সমন্বয়',
          amount: diff,
          status: 'সম্পন্ন',
          time: formatDhakaTime(),
        },
        newBalance
      );

      if (
        !getActiveBotToken() ||
        !binding ||
        binding.prefs.adjustments === false ||
        !shouldDeliverAlert(binding, absDiffNum)
      ) {
        res.json({ ok: true, skipped: true });
        return;
      }

      const msg =
        `${isCredit ? '🎁' : '🧾'} <b>CaptchaPay ব্যালেন্স আপডেট লাইভ রিসিট</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${isCredit ? 'আপনার অ্যাকাউন্টে অ্যাডমিন দ্বারা ব্যালেন্স যোগ হয়েছে!' : 'অ্যাডমিন দ্বারা আপনার ব্যালেন্স সমন্বয় করা হয়েছে।'}\n\n` +
        `${isCredit ? '➕ যোগ হয়েছে' : '➖ সমন্বয়'}: <b>${isCredit ? '+' : '-'}৳${escapeHtml(absDiff)}</b>\n` +
        `💳 পূর্বের ব্যালেন্স: ৳${escapeHtml(formatMoney(oldBalance))}\n` +
        `💰 বর্তমান ব্যালেন্স: <b>৳${escapeHtml(formatMoney(newBalance))}</b>\n` +
        (reason ? `📝 বিবরণ: <i>${escapeHtml(reason)}</i>\n` : '') +
        `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
        `━━━━━━━━━━━━━━━━━━` +
        buildFooterLine();

      const sendRes = await sendTelegramMessage(binding.chatId, msg);
      appendLog({
        eventType: 'balance_adjusted',
        recipientUid: targetUid,
        recipientLabel: `${binding.name} (${binding.chatId})`,
        status: sendRes.ok ? 'sent' : 'failed',
        summary: `ব্যালেন্স আপডেট ${isCredit ? '+' : '-'}৳${absDiff} → ৳${formatMoney(newBalance)}`,
        error: sendRes.error,
      });

      res.json({ ok: true, delivered: sendRes.ok });
      return;
    }

    // B4) Admin Broadcast Announcement (Posts to Channel always + optionally User DMs)
    if (eventType === 'broadcast') {
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : 'অ্যাডমিন ঘোষণা';
      const textBody = typeof body.body === 'string' ? body.body.trim().slice(0, 1000) : '';
      const channelOnly = Boolean(body.channelOnly);
      if (!textBody && !title) {
        res.status(400).json({ error: 'Empty broadcast' });
        return;
      }

      const channelMsg =
        `📢 <b>${escapeHtml(title || 'CaptchaPay অফিশিয়াল ঘোষণা')}</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${escapeHtml(textBody || title)}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🕒 ${escapeHtml(formatDhakaTime())}` +
        buildFooterLine();

      void sendChannelMessage(channelMsg, 'channel_announcement', `চ্যানেল ঘোষণা: "${title.slice(0, 50)}"`);

      if (channelOnly || !getActiveBotToken()) {
        res.json({ ok: true, sentCount: 0, failCount: 0, totalTargets: 0, channelDispatched: true });
        return;
      }

      const targets = Object.values(state.bindings).filter(
        b => b.chatId && b.prefs.announcements !== false && shouldDeliverAlert(b, 0)
      );
      let sentCount = 0;
      let failCount = 0;

      for (const b of targets) {
        const sendRes = await sendTelegramMessage(b.chatId, channelMsg);
        if (sendRes.ok) sentCount++;
        else failCount++;
      }

      appendLog({
        eventType: 'broadcast',
        recipientUid: 'all',
        recipientLabel: `${targets.length} জন ইউজার`,
        status: sentCount > 0 ? 'sent' : targets.length === 0 ? 'skipped' : 'failed',
        summary: `টেলিগ্রাম ব্রডকাস্ট: "${title.slice(0, 50)}" (সফল: ${sentCount}, ব্যর্থ: ${failCount})`,
      });

      res.json({ ok: true, sentCount, failCount, totalTargets: targets.length });
      return;
    }

    // B5) Admin User Ban / Unban -> Channel Notification (Masked)
    if (eventType === 'admin_user_ban_toggled') {
      const targetUid = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
      if (!targetUid) {
        res.status(400).json({ error: 'Missing targetUserId' });
        return;
      }
      const uDoc = await fetchFirestoreDocument('users', targetUid, authUser.idToken);
      if (!uDoc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const isBanned = Boolean(uDoc.isBanned);
      const safeHandle = await resolveSafeChannelUsername(
        targetUid,
        String(uDoc.email || ''),
        authUser.idToken
      );
      void sendChannelMessage(
        `${isBanned ? '🚫' : '✅'} <b>অ্যাকাউন্ট স্ট্যাটাস পরিবর্তন</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `📌 স্ট্যাটাস: <b>${isBanned ? 'সাময়িক স্থগিত (Banned)' : 'পুনরায় সক্রিয় (Unbanned)'}</b>\n` +
          `🔐 নাম ও ইমেইল: <i>গোপনীয়তা সুরক্ষিত</i>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_user_status',
        `চ্যানেল: ইউজার ${isBanned ? 'ব্যান' : 'আনব্যান'} (${safeHandle})`
      );
      res.json({ ok: true });
      return;
    }

    // B6) Admin VIP Tier Changed -> Channel Notification (Masked)
    if (eventType === 'admin_tier_changed') {
      const targetUid = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
      if (!targetUid) {
        res.status(400).json({ error: 'Missing targetUserId' });
        return;
      }
      const uDoc = await fetchFirestoreDocument('users', targetUid, authUser.idToken);
      if (!uDoc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const tier = String(uDoc.vipTier || 'free').toUpperCase();
      const safeHandle = await resolveSafeChannelUsername(
        targetUid,
        String(uDoc.email || ''),
        authUser.idToken
      );
      void sendChannelMessage(
        `👑 <b>VIP মেম্বারশিপ প্যাকেজ আপডেট!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `🎖️ নতুন প্যাকেজ: <b>${escapeHtml(tier)}</b>\n` +
          `🔐 নাম ও ইমেইল: <i>গোপনীয়তা সুরক্ষিত</i>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_tier_update',
        `চ্যানেল: VIP আপডেট → ${tier} (${safeHandle})`
      );
      res.json({ ok: true });
      return;
    }

    // B7) Support Ticket Replied / Closed -> Channel Notification (Masked)
    if (eventType === 'support_ticket_replied') {
      const ticketId = typeof body.docId === 'string' ? body.docId.trim() : '';
      if (!ticketId) {
        res.status(400).json({ error: 'Missing ticketId' });
        return;
      }
      const tDoc = await fetchFirestoreDocument('supportTickets', ticketId, authUser.idToken);
      if (!tDoc) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      const targetUid = String(tDoc.userId || '');
      const status = String(tDoc.status || 'answered');
      const safeHandle = await resolveSafeChannelUsername(
        targetUid,
        String(tDoc.userEmail || ''),
        authUser.idToken
      );
      void sendChannelMessage(
        `💬 <b>সাপোর্ট টিকেট আপডেট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` +
          `📌 বিষয়: <b>${escapeHtml(String(tDoc.subject || 'সাপোর্ট').slice(0, 80))}</b>\n` +
          `✅ অবস্থা: <b>${status === 'closed' ? 'সমাধান ও বন্ধ' : 'অ্যাডমিন উত্তর দিয়েছেন'}</b>\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_support_replied',
        `চ্যানেল: সাপোর্ট টিকেট উত্তর (${safeHandle})`
      );
      res.json({ ok: true });
      return;
    }

    // B8) General Admin System Action -> Channel Notification (Masked)
    if (eventType === 'admin_system_action') {
      const actionTitle = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : 'সিস্টেম আপডেট';
      const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 300) : '';
      const targetUid = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : '';
      const safeHandle = targetUid
        ? await resolveSafeChannelUsername(targetUid, undefined, authUser.idToken)
        : '';

      void sendChannelMessage(
        `⚙️ <b>অ্যাডমিন প্যানেল সিস্টেম নোটিফিকেশন</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📌 ইভেন্ট: <b>${escapeHtml(actionTitle)}</b>\n` +
          (safeHandle ? `👤 ইউজারনেম: <b>${escapeHtml(safeHandle)}</b>\n` : '') +
          (detail ? `ℹ️ বিবরণ: ${escapeHtml(detail)}\n` : '') +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_system_action',
        `চ্যানেল: ${actionTitle}${safeHandle ? ` (${safeHandle})` : ''}`
      );
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown eventType' });
  });

  // 9. Admin Auto-Hydrate from Encrypted Cloud Firestore Vault on Admin Sign-In
  app.post('/api/telegram/admin/hydrate', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser || !isVerifiedAdmin(authUser)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const result = await hydrateTelegramFromFirestore(authUser.idToken, authUser.email);
    res.json({
      ok: true,
      restoredChannel: result.restoredChannel,
      restoredBot: result.restoredBot,
      vaultSynced: result.vaultSynced,
      botConfigured: Boolean(getActiveBotToken()),
      channelBotConfigured: isChannelConfigured(),
    });
  });

  // 9a. Admin Overview & Delivery Logs
  app.get('/api/telegram/admin/overview', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser || !isVerifiedAdmin(authUser)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    if (!isChannelConfigured() || !getActiveBotToken() || !state.vaultSynced) {
      await hydrateTelegramFromFirestore(authUser.idToken, authUser.email);
    }

    const token = getActiveBotToken();
    const channelToken = getActiveChannelBotToken();
    const activeChannelId = getActiveChannelChatId();
    const activeChannelTitle = getActiveChannelTitle();
    const linkedUsers = Object.values(state.bindings).map(b => ({
      uid: b.uid,
      name: b.name,
      email: b.email,
      username: b.username,
      chatId: b.chatId,
      linkedAt: b.linkedAt,
    }));

    res.json({
      botConfigured: Boolean(token),
      envManaged: isEnvManagedToken(),
      maskedToken: maskToken(token),
      botUsername: state.botInfo?.username || '',
      botName: state.botInfo?.firstName || '',
      pollingActive: isPollingActive,
      adminRadarEnabled: state.adminRadarEnabled,
      commands: TELEGRAM_BOT_COMMANDS,
      linkedCount: linkedUsers.length,
      linkedUsers,
      recentLogs: state.logs.slice(0, 40),
      channelBotConfigured: isChannelConfigured(),
      channelEnvManaged: isEnvManagedChannelToken(),
      channelChatIdEnvManaged: isEnvManagedChannelChatId(),
      channelMaskedToken: maskToken(channelToken),
      channelBotUsername: state.channelBotInfo?.username || '',
      channelBotName: state.channelBotInfo?.firstName || '',
      channelChatId: activeChannelId,
      channelTitle: activeChannelTitle,
      channelUsername: state.channelUsername || '',
      channelEnabled: state.channelEnabled,
      vaultSynced: Boolean(state.vaultSynced),
      vaultUpdatedAt: state.vaultUpdatedAt || '',
    });
  });

  // 9b. Admin Channel Bot Configuration (Dedicated Send-Only Channel Notification Bot)
  app.post('/api/telegram/admin/channel', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser || !isVerifiedAdmin(authUser)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : 'save';

    if (action !== 'disconnect' && (!isChannelConfigured() || !getActiveChannelBotToken())) {
      await hydrateTelegramFromFirestore(authUser.idToken, authUser.email);
    }

    if (action === 'toggle') {
      state.channelEnabled = Boolean(body.enabled);
      saveState();
      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);
      res.json({ ok: true, channelEnabled: state.channelEnabled, vaultSynced });
      return;
    }

    if (action === 'disconnect') {
      if (!isEnvManagedChannelToken()) {
        state.channelBotToken = '';
        state.channelBotInfo = null;
      }
      if (!isEnvManagedChannelChatId()) {
        state.channelChatId = '';
        state.channelTitle = '';
        state.channelUsername = '';
      }
      saveState();
      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);
      res.json({ ok: true, channelBotConfigured: isChannelConfigured(), vaultSynced });
      return;
    }

    if (action === 'test') {
      if (!isChannelConfigured()) {
        res.status(400).json({ error: 'আগে চ্যানেল বট টোকেন ও চ্যানেল আইডি যুক্ত করুন।' });
        return;
      }
      const prevEnabled = state.channelEnabled;
      state.channelEnabled = true;
      const sendRes = await sendChannelMessage(
        `🧪 <b>CaptchaPay চ্যানেল নোটিফিকেশন টেস্ট</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 ইউজারনেম: <b>@sample_user</b>\n` +
          `💵 পরিমাণ: <b>৳৫০০.০০</b> (বিকাশ)\n` +
          `🔐 নাম ও মোবাইল নম্বর: <i>গোপনীয়তা সুরক্ষিত (হাইড)</i>\n` +
          `✅ অবস্থা: সক্রিয় ও নিরাপদ (এই বটের DM থেকে কেউ তথ্য দেখতে পারবে না)\n` +
          `🕒 সময়: ${escapeHtml(formatDhakaTime())}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        'channel_test',
        'চ্যানেল টেস্ট নোটিফিকেশন'
      );
      state.channelEnabled = prevEnabled;
      saveState();
      if (!sendRes.ok) {
        res.status(400).json({ error: `চ্যানেলে মেসেজ পাঠানো যায়নি: ${sendRes.error}` });
        return;
      }
      res.json({ ok: true });
      return;
    }

    const rawChannelId = typeof body.channelChatId === 'string' ? body.channelChatId.trim() : '';
    const rawTokenInput = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    const tokenToUse = rawTokenInput || getActiveChannelBotToken();
    const channelIdToUse = rawChannelId || getActiveChannelChatId();

    if (!tokenToUse || !TELEGRAM_BOT_TOKEN_REGEX.test(tokenToUse)) {
      res.status(400).json({
        error: 'চ্যানেল বটের জন্য সঠিক @BotFather টোকেন দিন।',
      });
      return;
    }

    if (!CHANNEL_CHAT_ID_REGEX.test(channelIdToUse)) {
      res.status(400).json({
        error: 'সঠিক চ্যানেল @username (যেমন @mychannel) অথবা চ্যানেল আইডি (যেমন -1001234567890) দিন।',
      });
      return;
    }

    try {
      const me = await callTelegramApi<{ id: number; username?: string; first_name?: string }>(
        tokenToUse,
        'getMe'
      );
      if (!me.ok || !me.result) {
        res.status(400).json({
          error: `চ্যানেল বট টোকেন যাচাই ব্যর্থ হয়েছে: ${me.description || 'Invalid token'}`,
        });
        return;
      }

      // Ensure this dedicated channel bot never responds to DMs or slash commands
      await callTelegramApi(tokenToUse, 'deleteWebhook', { drop_pending_updates: true });
      await callTelegramApi(tokenToUse, 'setMyCommands', { commands: [] });

      const chatInfo = await callTelegramApi<{
        id: number | string;
        type?: string;
        title?: string;
        username?: string;
      }>(tokenToUse, 'getChat', { chat_id: channelIdToUse });

      if (!chatInfo.ok || !chatInfo.result) {
        res.status(400).json({
          error: `চ্যানেল খুঁজে পাওয়া যায়নি (${chatInfo.description || 'Chat not found'})। অনুগ্রহ করে এই বটটিকে আগে আপনার চ্যানেলে Admin হিসেবে যুক্ত করুন।`,
        });
        return;
      }

      if (chatInfo.result.type === 'private') {
        res.status(400).json({
          error: 'এটি কোনো চ্যানেল নয়! অনুগ্রহ করে শুধুমাত্র আপনার টেলিগ্রাম চ্যানেল (@username বা -100...) দিন।',
        });
        return;
      }

      const resolvedChatId = String(chatInfo.result.id || channelIdToUse);
      const resolvedTitle = chatInfo.result.title || channelIdToUse;
      const resolvedUsername = chatInfo.result.username
        ? `@${chatInfo.result.username.replace(/^@+/, '')}`
        : channelIdToUse.startsWith('@')
        ? channelIdToUse
        : '';

      const verifyPost = await callTelegramApi(tokenToUse, 'sendMessage', {
        chat_id: resolvedChatId,
        text:
          `📢 <b>CaptchaPay অফিশিয়াল চ্যানেল নোটিফিকেশন বট সক্রিয় হয়েছে!</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✅ এখন থেকে উইথড্র, রিচার্জ, P2P ও সকল সিস্টেম নোটিফিকেশন এখানে আসবে।\n` +
          `🔐 ইউজারদের আসল নাম, ইমেইল ও মোবাইল নম্বর সম্পূর্ণ গোপন রেখে শুধু ইউজারনেম দেখানো হবে।\n` +
          `🕒 ${escapeHtml(formatDhakaTime())}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      if (!verifyPost.ok) {
        res.status(400).json({
          error: `বটটি চ্যানেলে মেসেজ পাঠাতে পারছে না (${verifyPost.description || 'Permission denied'})। অনুগ্রহ করে চ্যানেলের Admins লিস্টে বটটিকে "Post Messages" অনুমতি দিয়ে যুক্ত করুন।`,
        });
        return;
      }

      if (!isEnvManagedChannelToken()) {
        state.channelBotToken = tokenToUse;
      }
      state.channelBotInfo = {
        id: me.result.id,
        username: me.result.username || '',
        firstName: me.result.first_name || 'CaptchaPay Channel Bot',
      };
      state.channelChatId = resolvedChatId;
      state.channelTitle = resolvedTitle;
      state.channelUsername = resolvedUsername;
      state.channelEnabled = true;
      saveState();

      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);

      appendLog({
        eventType: 'admin_channel_configured',
        recipientUid: authUser.uid,
        recipientLabel: `${resolvedTitle} (${resolvedChatId})`,
        status: 'sent',
        summary: `চ্যানেল বট (@${state.channelBotInfo.username}) স্থায়ীভাবে যুক্ত হয়েছে`,
      });

      res.json({
        ok: true,
        channelBotConfigured: true,
        channelBotUsername: state.channelBotInfo.username,
        channelBotName: state.channelBotInfo.firstName,
        channelMaskedToken: maskToken(tokenToUse),
        channelChatId: resolvedChatId,
        channelTitle: resolvedTitle,
        channelUsername: resolvedUsername,
        channelEnabled: true,
        vaultSynced,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'চ্যানেল বট সেটআপ করতে সমস্যা হয়েছে',
      });
    }
  });

  // 10. Admin Config (Token, Radar Toggle, Re-Register Commands)
  app.post('/api/telegram/admin/config', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseBearer(req);
    if (!authUser || !isVerifiedAdmin(authUser)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (body.action === 'toggle_radar') {
      state.adminRadarEnabled = Boolean(body.enabled);
      saveState();
      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);
      res.json({ ok: true, adminRadarEnabled: state.adminRadarEnabled, vaultSynced });
      return;
    }

    if (body.action === 'sync_commands') {
      if (!getActiveBotToken()) {
        await hydrateTelegramFromFirestore(authUser.idToken, authUser.email);
      }
      const token = getActiveBotToken();
      if (!token) {
        res.status(400).json({ error: 'বট টোকেন সেট করা নেই' });
        return;
      }
      await registerBotSlashCommands(token, state.botInfo?.username || 'configured');
      res.json({ ok: true, commandsCount: TELEGRAM_BOT_COMMANDS.length });
      return;
    }

    if (body.action === 'disconnect') {
      if (isEnvManagedToken()) {
        res.status(400).json({
          error: 'সার্ভার Environment Secret (TELEGRAM_BOT_TOKEN) থেকে টোকেন সেট করা আছে।',
        });
        return;
      }
      state.botToken = '';
      state.botInfo = null;
      state.commandsRegisteredForUsername = '';
      isPollingActive = false;
      saveState();
      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);
      res.json({ ok: true, botConfigured: false, vaultSynced });
      return;
    }

    const rawToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    if (!TELEGRAM_BOT_TOKEN_REGEX.test(rawToken)) {
      res.status(400).json({
        error: 'সঠিক @BotFather টোকেন দিন (যেমন: 1234567890:ABCdefGHIjklMNO...)।',
      });
      return;
    }

    try {
      const me = await callTelegramApi<{ id: number; username?: string; first_name?: string }>(
        rawToken,
        'getMe'
      );
      if (!me.ok || !me.result) {
        res.status(400).json({
          error: `Telegram বট যাচাই ব্যর্থ হয়েছে: ${me.description || 'Invalid token'}`,
        });
        return;
      }

      await callTelegramApi(rawToken, 'deleteWebhook', { drop_pending_updates: false });
      state.botToken = rawToken;
      state.botInfo = {
        id: me.result.id,
        username: me.result.username || '',
        firstName: me.result.first_name || 'CaptchaPay Bot',
      };
      saveState();
      const vaultSynced = await persistTelegramVaultToFirestore(authUser.idToken, authUser.email);

      await registerBotSlashCommands(rawToken, state.botInfo.username || 'configured');
      startTelegramPolling();
      await pollTelegramOnce();

      appendLog({
        eventType: 'admin_bot_configured',
        recipientUid: authUser.uid,
        recipientLabel: `@${state.botInfo.username || state.botInfo.firstName}`,
        status: 'sent',
        summary: 'টেলিগ্রাম বট এবং ১২টি স্ল্যাশ কমান্ড স্থায়ীভাবে সক্রিয় করা হয়েছে',
      });

      res.json({
        ok: true,
        botConfigured: true,
        botUsername: state.botInfo.username,
        botName: state.botInfo.firstName,
        maskedToken: maskToken(rawToken),
        vaultSynced,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'বট কানেক্ট করতে সমস্যা হয়েছে',
      });
    }
  });
}
