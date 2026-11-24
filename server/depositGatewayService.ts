import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { parseDepositSmsText } from '../src/lib/smsParser';
import type { PaymentMethod } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'deposit-gateway-state.json');
const ANDROID_PROJECT_DIR = path.join(ROOT_DIR, 'android-sms-gateway');
const FIREBASE_CONFIG_FILE = path.join(ROOT_DIR, 'firebase-applet-config.json');

const ADMIN_EMAIL_SHA256 = '57afcc0e54fca27f7781c7d88d15e55b0180465b4ca881c5110ae617c38c38e3';
const DEVICE_ONLINE_THRESHOLD_MS = 120_000;

export interface SmsGatewayDevice {
  deviceId: string;
  deviceName: string;
  model: string;
  androidVersion: string;
  batteryPct: number;
  isCharging: boolean;
  simOperator: string;
  networkType: string;
  permissionsGranted: boolean;
  batteryUnrestricted: boolean;
  queueDepth: number;
  totalSmsSent: number;
  appVersion: string;
  lastHeartbeatAt: string;
  lastSmsAt?: string;
}

export interface SmsGatewayLogItem {
  id: string;
  smsHash: string;
  receivedAt: string;
  deviceId: string;
  deviceName: string;
  smsSender: string;
  simSlot: number;
  rawBody: string;
  detectedMethod?: PaymentMethod;
  amount?: number;
  trxId?: string;
  senderNumber?: string;
  confidence: 'high' | 'partial' | 'none';
  matchedDepositId?: string;
  matchedAt?: string;
  source: 'android' | 'simulator';
  isTest?: boolean;
}

export interface VerifiedGatewayClaim {
  trxId: string;
  uid: string;
  userEmail: string;
  amount: number;
  method: string;
  senderNumber: string;
  smsLogId: string;
  rechargeId?: string;
  verifiedAt: string;
  autoApproved?: boolean;
}

export interface PendingAutoApprovalItem {
  rechargeId: string;
  trxId: string;
  smsLogId: string;
  uid: string;
  amount: number;
  method: string;
  queuedAt: string;
}

interface PersistedGatewayState {
  enabled: boolean;
  paymentSmsOnly: boolean;
  autoMatchAlertTelegram: boolean;
  gatewayToken: string;
  vaultSynced: boolean;
  vaultUpdatedAt: string;
  devices: Record<string, SmsGatewayDevice>;
  smsLogs: SmsGatewayLogItem[];
  seenHashes: string[];
  verifiedClaims: Record<string, VerifiedGatewayClaim>;
  pendingAutoApprovals: PendingAutoApprovalItem[];
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

function getFirebaseConfig(): FirebaseConfigJson {
  const raw = fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8');
  return JSON.parse(raw) as FirebaseConfigJson;
}

function isAdminEmailMatch(email: string): boolean {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return false;
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return hash === ADMIN_EMAIL_SHA256;
}

function generateGatewayToken(): string {
  return `cpgw_${crypto.randomBytes(24).toString('hex')}`;
}

function loadState(): PersistedGatewayState {
  const defaultState: PersistedGatewayState = {
    enabled: true,
    paymentSmsOnly: true,
    autoMatchAlertTelegram: true,
    gatewayToken: generateGatewayToken(),
    vaultSynced: false,
    vaultUpdatedAt: '',
    devices: {},
    smsLogs: [],
    seenHashes: [],
    verifiedClaims: {},
    pendingAutoApprovals: [],
  };

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const bakFile = `${STATE_FILE}.bak`;
    let raw = '';
    if (fs.existsSync(STATE_FILE)) {
      raw = fs.readFileSync(STATE_FILE, 'utf8').trim();
    } else if (fs.existsSync(bakFile)) {
      raw = fs.readFileSync(bakFile, 'utf8').trim();
    }
    if (!raw) {
      return defaultState;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedGatewayState>;
    return {
      enabled: parsed.enabled !== false,
      paymentSmsOnly: parsed.paymentSmsOnly !== false,
      autoMatchAlertTelegram: parsed.autoMatchAlertTelegram !== false,
      gatewayToken:
        typeof parsed.gatewayToken === 'string' && parsed.gatewayToken.trim().length >= 16
          ? parsed.gatewayToken.trim()
          : defaultState.gatewayToken,
      vaultSynced: Boolean(parsed.vaultSynced),
      vaultUpdatedAt: typeof parsed.vaultUpdatedAt === 'string' ? parsed.vaultUpdatedAt : '',
      devices: parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : {},
      smsLogs: Array.isArray(parsed.smsLogs) ? parsed.smsLogs.slice(0, 250) : [],
      seenHashes: Array.isArray(parsed.seenHashes) ? parsed.seenHashes.slice(0, 500) : [],
      verifiedClaims:
        parsed.verifiedClaims && typeof parsed.verifiedClaims === 'object'
          ? parsed.verifiedClaims
          : {},
      pendingAutoApprovals: Array.isArray(parsed.pendingAutoApprovals)
        ? parsed.pendingAutoApprovals.slice(0, 100)
        : [],
    };
  } catch {
    return defaultState;
  }
}

const state: PersistedGatewayState = loadState();

function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    state.smsLogs = state.smsLogs.slice(0, 250);
    state.seenHashes = state.seenHashes.slice(-500);

    const payload = JSON.stringify(state, null, 2);
    const tmpFile = `${STATE_FILE}.tmp`;
    const bakFile = `${STATE_FILE}.bak`;
    fs.writeFileSync(tmpFile, payload, 'utf8');
    if (fs.existsSync(STATE_FILE)) {
      try {
        fs.copyFileSync(STATE_FILE, bakFile);
      } catch {
        // ignore backup error
      }
    }
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.warn('[DepositGateway] Failed to persist state:', err);
  }
}

function getEffectiveGatewayToken(): string {
  const envToken = (process.env.DEPOSIT_GATEWAY_TOKEN || '').trim();
  return envToken || state.gatewayToken;
}

function isGatewayEnvManaged(): boolean {
  return Boolean((process.env.DEPOSIT_GATEWAY_TOKEN || '').trim());
}

function maskSecret(token: string): string {
  if (!token) return '';
  if (token.length <= 12) return '************';
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

// --- Firestore Vault AES-256-GCM Encryption & REST Helpers ---
function getVaultCipherKey(): Buffer {
  const cfg = getFirebaseConfig();
  const customSecret = (process.env.SMS_GATEWAY_VAULT_SECRET || '').trim();
  const seed =
    customSecret ||
    `${cfg.projectId}:${cfg.firestoreDatabaseId || '(default)'}:${cfg.appId || ''}:captchapay-smsgw-vault-v1`;
  return crypto.scryptSync(seed, 'captchapay-sms-gateway-vault-salt-2026', 32);
}

function encryptVaultToken(plain: string): string {
  const clean = (plain || '').trim();
  if (clean.length < 16) return '';
  const key = getVaultCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptVaultToken(cipherText: unknown): string {
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
    return plain.length >= 16 ? plain : '';
  } catch {
    return '';
  }
}

function decodeFirestoreValue(val: unknown): unknown {
  if (!val || typeof val !== 'object') return undefined;
  const v = val as Record<string, unknown>;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return String(v.stringValue ?? '');
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return String(v.timestampValue ?? '');
  return undefined;
}

function encodeFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  return { stringValue: String(val) };
}

async function fetchGatewayVaultFromFirestore(idToken: string): Promise<Record<string, unknown> | null> {
  try {
    const cfg = getFirebaseConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents/smsGatewayVault/config`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
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

async function persistGatewayVaultToFirestore(idToken: string, adminEmail: string): Promise<boolean> {
  if (!idToken || !isAdminEmailMatch(adminEmail)) return false;
  try {
    const cfg = getFirebaseConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      cfg.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents:commit`;
    const docName = `projects/${cfg.projectId}/databases/${dbId}/documents/smsGatewayVault/config`;

    const fields: Record<string, unknown> = {
      id: encodeFirestoreValue('config'),
      enabled: encodeFirestoreValue(Boolean(state.enabled)),
      paymentSmsOnly: encodeFirestoreValue(Boolean(state.paymentSmsOnly)),
      autoMatchAlertTelegram: encodeFirestoreValue(Boolean(state.autoMatchAlertTelegram)),
      updatedBy: encodeFirestoreValue(adminEmail.slice(0, 200)),
    };

    const encToken = encryptVaultToken(state.gatewayToken);
    if (encToken) {
      fields.gatewayTokenEnc = encodeFirestoreValue(encToken);
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
    if (!res.ok) return false;
    state.vaultSynced = true;
    state.vaultUpdatedAt = new Date().toISOString();
    saveState();
    return true;
  } catch {
    return false;
  }
}

async function verifySignedInFirebaseUser(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  try {
    const cfg = getFirebaseConfig();
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      cfg.apiKey
    )}`;
    const res = await fetch(lookupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
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
    if (!u?.localId || !u.email || u.emailVerified !== true) return null;
    return {
      uid: u.localId,
      email: u.email,
      emailVerified: true,
      name: u.displayName || 'User',
      idToken,
    };
  } catch {
    return null;
  }
}

async function verifyAdminRequest(req: Request): Promise<VerifiedFirebaseUser | null> {
  const user = await verifySignedInFirebaseUser(req);
  if (!user || !isAdminEmailMatch(user.email)) return null;
  return user;
}

// --- Timing-Safe Gateway Device Authentication ---
function safeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyDeviceAuth(req: Request): { ok: boolean; error?: string } {
  const expectedToken = getEffectiveGatewayToken();
  if (!expectedToken) {
    return { ok: false, error: 'Gateway token not initialized on server' };
  }

  const headerToken = String(
    req.headers['x-gateway-token'] ||
      (String(req.headers.authorization || '').startsWith('Bearer ')
        ? String(req.headers.authorization || '').slice(7)
        : '')
  ).trim();

  if (!headerToken || !safeEqualStrings(headerToken, expectedToken)) {
    return { ok: false, error: 'Invalid gateway token' };
  }

  // Optional HMAC-SHA256 replay protection when Android client sends signature + timestamp
  const sig = String(req.headers['x-gateway-signature'] || '').trim().toLowerCase();
  const ts = String(req.headers['x-gateway-timestamp'] || '').trim();
  const rawBody = (req as Request & { rawBody?: string }).rawBody;

  if (sig && ts && rawBody !== undefined) {
    const tsMs = Number(ts);
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60_000) {
      return { ok: false, error: 'Request timestamp expired' };
    }
    const expectedSig = crypto
      .createHmac('sha256', expectedToken)
      .update(`${ts}.${rawBody}`)
      .digest('hex')
      .toLowerCase();
    if (!safeEqualStrings(sig, expectedSig)) {
      return { ok: false, error: 'Invalid HMAC signature' };
    }
  }

  return { ok: true };
}

function resolveBaseUrl(req: Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && configured !== 'MY_APP_URL') {
    return configured;
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function formatPublicDevices(): Array<SmsGatewayDevice & { isOnline: boolean }> {
  const now = Date.now();
  return Object.values(state.devices)
    .map(dev => ({
      ...dev,
      isOnline: now - new Date(dev.lastHeartbeatAt).getTime() <= DEVICE_ONLINE_THRESHOLD_MS,
    }))
    .sort((a, b) => new Date(b.lastHeartbeatAt).getTime() - new Date(a.lastHeartbeatAt).getTime());
}

function buildAdminSnapshot(req: Request) {
  const baseUrl = resolveBaseUrl(req);
  const devices = formatPublicDevices();
  const onlineCount = devices.filter(d => d.isOnline).length;
  const totalCaptured = state.smsLogs.length;
  const matchedCount = state.smsLogs.filter(l => Boolean(l.matchedDepositId)).length;
  const token = getEffectiveGatewayToken();

  return {
    enabled: state.enabled,
    paymentSmsOnly: state.paymentSmsOnly,
    autoMatchAlertTelegram: state.autoMatchAlertTelegram,
    envManaged: isGatewayEnvManaged(),
    gatewayToken: token,
    maskedToken: maskSecret(token),
    vaultSynced: state.vaultSynced,
    vaultUpdatedAt: state.vaultUpdatedAt,
    serverUrl: baseUrl,
    ingestUrl: `${baseUrl}/api/deposit-gateway/ingest`,
    heartbeatUrl: `${baseUrl}/api/deposit-gateway/heartbeat`,
    androidProjectDir: '/android-sms-gateway',
    devices,
    smsLogs: state.smsLogs.slice(0, 120),
    stats: {
      onlineDevices: onlineCount,
      totalDevices: devices.length,
      totalCaptured,
      matchedCount,
      unmatchedPaymentCount: state.smsLogs.filter(
        l => !l.matchedDepositId && Boolean(l.trxId)
      ).length,
    },
  };
}

// --- Zero-Dependency Pure Node.js ZIP Archive Builder ---
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function collectProjectFiles(baseDir: string, currentDir: string, out: Array<{ relPath: string; absPath: string }>) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.gradle' || entry.name === 'build' || entry.name === '.idea') continue;
    const absPath = path.resolve(currentDir, entry.name);
    if (!absPath.startsWith(baseDir + path.sep)) continue;
    if (entry.isDirectory()) {
      collectProjectFiles(baseDir, absPath, out);
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, absPath).split(path.sep).join('/');
      out.push({ relPath: `android-sms-gateway/${relPath}`, absPath });
    }
  }
}

function buildZipFromDirectory(rootDir: string): Buffer {
  const files: Array<{ relPath: string; absPath: string }> = [];
  collectProjectFiles(path.resolve(rootDir), path.resolve(rootDir), files);

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const raw = fs.readFileSync(f.absPath);
    const compressed = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(f.relPath, 'utf8');
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function ingestSmsRecord(params: {
  deviceId: string;
  deviceName: string;
  smsSender: string;
  rawBody: string;
  receivedAtMs?: number;
  simSlot?: number;
  source: 'android' | 'simulator';
  isTest?: boolean;
}): { duplicate: boolean; log: SmsGatewayLogItem } {
  const cleanBody = params.rawBody.trim().slice(0, 2000);
  const cleanSender = params.smsSender.trim().slice(0, 80) || 'Unknown';
  const tsBucket = Math.floor((params.receivedAtMs || Date.now()) / 60_000);
  const smsHash = crypto
    .createHash('sha256')
    .update(`${cleanSender}|${cleanBody}|${tsBucket}`)
    .digest('hex')
    .slice(0, 32);

  const existingLog = state.smsLogs.find(l => l.smsHash === smsHash);
  if (existingLog && !params.isTest) {
    return { duplicate: true, log: existingLog };
  }

  const parsed = parseDepositSmsText(cleanBody);
  const nowIso = new Date(params.receivedAtMs && params.receivedAtMs > 0 ? params.receivedAtMs : Date.now()).toISOString();

  const log: SmsGatewayLogItem = {
    id: `SMSGW-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    smsHash,
    receivedAt: nowIso,
    deviceId: params.deviceId.slice(0, 64),
    deviceName: params.deviceName.slice(0, 80),
    smsSender: cleanSender,
    simSlot: Number.isFinite(params.simSlot) ? Number(params.simSlot) : -1,
    rawBody: cleanBody,
    detectedMethod: parsed.detectedMethod,
    amount: parsed.amount,
    trxId: parsed.trxId,
    senderNumber: parsed.senderNumber,
    confidence: parsed.confidence,
    source: params.source,
    isTest: Boolean(params.isTest),
  };

  state.smsLogs.unshift(log);
  state.seenHashes.push(smsHash);

  if (params.deviceId && state.devices[params.deviceId]) {
    state.devices[params.deviceId].lastSmsAt = nowIso;
    state.devices[params.deviceId].lastHeartbeatAt = new Date().toISOString();
  }

  saveState();
  return { duplicate: false, log };
}

export function registerDepositGatewayRoutes(app: express.Express) {
  // 1. Android APK -> Ingest incoming payment SMS
  app.post('/api/deposit-gateway/ingest', (req: Request, res: Response) => {
    const authCheck = verifyDeviceAuth(req);
    if (!authCheck.ok) {
      res.status(401).json({ ok: false, error: authCheck.error });
      return;
    }

    if (!state.enabled) {
      res.status(503).json({ ok: false, error: 'Deposit SMS Gateway is paused by admin' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const rawBody = typeof body.rawBody === 'string' ? body.rawBody : '';
    const smsSender = typeof body.smsSender === 'string' ? body.smsSender : 'Unknown';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : 'android-device';
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : 'Android Phone';
    const receivedAtMs = Number(body.receivedAtMs) || Date.now();
    const simSlot = Number.isFinite(Number(body.simSlot)) ? Number(body.simSlot) : -1;
    const isTest = Boolean(body.isTest);

    if (!rawBody.trim()) {
      res.status(400).json({ ok: false, error: 'rawBody is required' });
      return;
    }

    const { duplicate, log } = ingestSmsRecord({
      deviceId: deviceId || 'android-device',
      deviceName: deviceName || 'Android Phone',
      smsSender,
      rawBody,
      receivedAtMs,
      simSlot,
      source: 'android',
      isTest,
    });

    res.json({
      ok: true,
      duplicate,
      id: log.id,
      parsed: {
        detectedMethod: log.detectedMethod,
        amount: log.amount,
        trxId: log.trxId,
        senderNumber: log.senderNumber,
        confidence: log.confidence,
      },
    });
  });

  // 2. Android APK -> Periodic 45s Device Telemetry Heartbeat
  app.post('/api/deposit-gateway/heartbeat', (req: Request, res: Response) => {
    const authCheck = verifyDeviceAuth(req);
    if (!authCheck.ok) {
      res.status(401).json({ ok: false, error: authCheck.error });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const deviceId =
      typeof body.deviceId === 'string' && body.deviceId.trim()
        ? body.deviceId.trim().slice(0, 64)
        : 'android-default';

    const existing = state.devices[deviceId];
    const nowIso = new Date().toISOString();

    state.devices[deviceId] = {
      deviceId,
      deviceName:
        typeof body.deviceName === 'string' && body.deviceName.trim()
          ? body.deviceName.trim().slice(0, 80)
          : existing?.deviceName || 'Admin Android Phone',
      model:
        typeof body.model === 'string' ? body.model.slice(0, 80) : existing?.model || 'Android',
      androidVersion:
        typeof body.androidVersion === 'string'
          ? body.androidVersion.slice(0, 32)
          : existing?.androidVersion || '',
      batteryPct: Number.isFinite(Number(body.batteryPct)) ? Number(body.batteryPct) : -1,
      isCharging: Boolean(body.isCharging),
      simOperator:
        typeof body.simOperator === 'string'
          ? body.simOperator.slice(0, 64)
          : existing?.simOperator || 'Unknown',
      networkType:
        typeof body.networkType === 'string'
          ? body.networkType.slice(0, 32)
          : existing?.networkType || 'Online',
      permissionsGranted: Boolean(body.permissionsGranted),
      batteryUnrestricted: Boolean(body.batteryUnrestricted),
      queueDepth: Math.max(0, Math.floor(Number(body.queueDepth) || 0)),
      totalSmsSent: Math.max(0, Math.floor(Number(body.totalSmsSent) || 0)),
      appVersion:
        typeof body.appVersion === 'string' ? body.appVersion.slice(0, 24) : '1.0.0',
      lastHeartbeatAt: nowIso,
      lastSmsAt: existing?.lastSmsAt,
    };

    // Keep at most 20 recent device records
    const entries = Object.entries(state.devices);
    if (entries.length > 20) {
      entries
        .sort(
          (a, b) =>
            new Date(b[1].lastHeartbeatAt).getTime() - new Date(a[1].lastHeartbeatAt).getTime()
        )
        .slice(20)
        .forEach(([k]) => {
          delete state.devices[k];
        });
    }

    saveState();
    res.json({
      ok: true,
      enabled: state.enabled,
      paymentSmsOnly: state.paymentSmsOnly,
      serverTime: nowIso,
    });
  });

  // 3. Admin -> Fetch Live Monitoring & Gateway State
  app.get('/api/deposit-gateway/admin/state', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন প্রবেশ করতে পারবেন' });
      return;
    }
    res.json(buildAdminSnapshot(req));
  });

  // 4. Admin -> Hydrate Encrypted Token from Firestore Vault
  app.post('/api/deposit-gateway/admin/hydrate', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন অনুমোদিত' });
      return;
    }

    const vaultDoc = await fetchGatewayVaultFromFirestore(admin.idToken);
    if (!vaultDoc) {
      // Seed vault on first login so token survives future restarts
      await persistGatewayVaultToFirestore(admin.idToken, admin.email);
      res.json({ ok: true, restored: false, vaultSynced: state.vaultSynced });
      return;
    }

    let restored = false;
    const dec = decryptVaultToken(vaultDoc.gatewayTokenEnc);
    if (dec && !isGatewayEnvManaged()) {
      state.gatewayToken = dec;
      restored = true;
    }
    if (typeof vaultDoc.enabled === 'boolean') state.enabled = vaultDoc.enabled;
    if (typeof vaultDoc.paymentSmsOnly === 'boolean') {
      state.paymentSmsOnly = vaultDoc.paymentSmsOnly;
    }
    if (typeof vaultDoc.autoMatchAlertTelegram === 'boolean') {
      state.autoMatchAlertTelegram = vaultDoc.autoMatchAlertTelegram;
    }
    state.vaultSynced = true;
    if (typeof vaultDoc.updatedAt === 'string') {
      state.vaultUpdatedAt = vaultDoc.updatedAt;
    }
    saveState();

    res.json({ ok: true, restored, vaultSynced: true });
  });

  // 5. Admin -> Update Gateway Config or Rotate Token
  app.post('/api/deposit-gateway/admin/config', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন অনুমোদিত' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.enabled === 'boolean') state.enabled = body.enabled;
    if (typeof body.paymentSmsOnly === 'boolean') state.paymentSmsOnly = body.paymentSmsOnly;
    if (typeof body.autoMatchAlertTelegram === 'boolean') {
      state.autoMatchAlertTelegram = body.autoMatchAlertTelegram;
    }
    if (body.rotateToken === true && !isGatewayEnvManaged()) {
      state.gatewayToken = generateGatewayToken();
    }

    saveState();
    await persistGatewayVaultToFirestore(admin.idToken, admin.email);
    res.json({ ok: true, state: buildAdminSnapshot(req) });
  });

  // 6. Admin -> Test SMS Simulator (Verify parser & monitoring feed)
  app.post('/api/deposit-gateway/admin/test-sms', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন অনুমোদিত' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const rawBody =
      typeof body.rawBody === 'string' && body.rawBody.trim()
        ? body.rawBody.trim()
        : `Send Money Tk 500.00 to 01700000000 successful. Fee Tk 5.00. TrxID SIM${Date.now()
            .toString()
            .slice(-6)}`;
    const smsSender = typeof body.smsSender === 'string' && body.smsSender.trim() ? body.smsSender.trim() : 'bKash';

    const { log } = ingestSmsRecord({
      deviceId: 'admin-simulator',
      deviceName: 'Admin Test Simulator',
      smsSender,
      rawBody,
      receivedAtMs: Date.now(),
      simSlot: 1,
      source: 'simulator',
      isTest: true,
    });

    res.json({ ok: true, log, state: buildAdminSnapshot(req) });
  });

  // 7. Admin -> Link SMS log entry to matched Deposit Request ID
  app.post('/api/deposit-gateway/admin/logs/:id/match', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন অনুমোদিত' });
      return;
    }

    const logId = String(req.params.id || '').trim();
    const depositId = String((req.body as Record<string, unknown>)?.depositId || '').trim().slice(0, 64);
    const target = state.smsLogs.find(l => l.id === logId);
    if (!target) {
      res.status(404).json({ error: 'SMS লগ খুঁজে পাওয়া যায়নি' });
      return;
    }
    target.matchedDepositId = depositId || undefined;
    target.matchedAt = depositId ? new Date().toISOString() : undefined;
    saveState();
    res.json({ ok: true, log: target });
  });

  // 8. Admin -> Delete an SMS log item
  app.delete('/api/deposit-gateway/admin/logs/:id', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন অনুমোদিত' });
      return;
    }

    const logId = String(req.params.id || '').trim();
    state.smsLogs = state.smsLogs.filter(l => l.id !== logId);
    saveState();
    res.json({ ok: true });
  });

  // 9. Admin -> Download Complete Native Android Studio Project (.zip)
  app.get('/api/deposit-gateway/download-project', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'শুধুমাত্র অ্যাডমিন প্রজেক্ট ডাউনলোড করতে পারবেন' });
      return;
    }

    if (!fs.existsSync(ANDROID_PROJECT_DIR)) {
      res.status(404).json({ error: 'Android project folder not found on server' });
      return;
    }

    try {
      const zipBuf = buildZipFromDirectory(ANDROID_PROJECT_DIR);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="CaptchaPay-SMS-Gateway-Android.zip"'
      );
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'ZIP তৈরি করতে সমস্যা হয়েছে',
      });
    }
  });

  // 10. User -> Instant 2-3s Payment Verification against captured Deposit SMS logs
  app.post('/api/deposit-gateway/verify-payment', async (req: Request, res: Response) => {
    const caller = await verifySignedInFirebaseUser(req);
    if (!caller) {
      res.status(401).json({ ok: false, verified: false, reason: 'অনুগ্রহ করে প্রথমে গুগল দিয়ে সাইন ইন করুন।' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const rawTrxId = typeof body.trxId === 'string' ? body.trxId.trim().toUpperCase() : '';
    const amount = Number(body.amount);
    const method = typeof body.method === 'string' ? body.method.trim() : '';
    const senderNumber = typeof body.senderNumber === 'string' ? body.senderNumber.trim() : '';

    if (!rawTrxId || rawTrxId.length < 4 || rawTrxId.length > 64) {
      res.json({
        ok: true,
        verified: false,
        reason: 'সঠিক ট্রানজেকশন আইডি (TrxID) প্রদান করুন।',
      });
      return;
    }
    if (!Number.isFinite(amount) || amount < 50 || amount > 50000) {
      res.json({
        ok: true,
        verified: false,
        reason: 'ডিপোজিট পরিমাণ ৳৫০ থেকে ৳৫০,০০০-এর মধ্যে হতে হবে।',
      });
      return;
    }

    // Replay check: disallow claiming an already-verified TrxID
    const existingClaim = state.verifiedClaims[rawTrxId];
    if (existingClaim) {
      if (existingClaim.uid === caller.uid && !existingClaim.rechargeId && Math.abs(existingClaim.amount - amount) <= 1) {
        res.json({
          ok: true,
          verified: true,
          smsLogId: existingClaim.smsLogId,
          detectedMethod: existingClaim.method,
          amount: existingClaim.amount,
          senderNumber: existingClaim.senderNumber,
          trxId: rawTrxId,
        });
        return;
      }
      res.json({
        ok: true,
        verified: false,
        reason: `এই TrxID (${rawTrxId}) ইতিমধ্যেই ব্যবহার করা হয়ে গেছে! নতুন ট্রানজেকশন আইডি দিন।`,
      });
      return;
    }

    const callerIsAdmin = isAdminEmailMatch(caller.email);
    const matchingLogs = state.smsLogs.filter(
      l =>
        (l.trxId || '').trim().toUpperCase() === rawTrxId &&
        (l.source === 'android' || callerIsAdmin)
    );

    if (matchingLogs.length === 0) {
      res.json({
        ok: true,
        verified: false,
        reason: `সার্ভারে TrxID "${rawTrxId}"-এর কোনো পেমেন্ট SMS এখনো আসেনি। টাকা পাঠিয়ে ২-৩ সেকেন্ড পর আবার চেষ্টা করুন।`,
      });
      return;
    }

    const unusedLog = matchingLogs.find(l => !l.matchedDepositId);
    if (!unusedLog) {
      res.json({
        ok: true,
        verified: false,
        reason: `এই TrxID (${rawTrxId}) পূর্বেই ভেরিফাই ও ব্যবহার করা হয়েছে।`,
      });
      return;
    }

    if (typeof unusedLog.amount !== 'number' || Math.abs(unusedLog.amount - amount) > 1) {
      res.json({
        ok: true,
        verified: false,
        reason:
          typeof unusedLog.amount === 'number'
            ? `টাকার পরিমাণ মেলেনি! SMS-এ এসেছে ৳${unusedLog.amount}, কিন্তু আপনি দিয়েছেন ৳${amount}।`
            : 'SMS-এ সঠিক টাকার পরিমাণ শনাক্ত করা যায়নি।',
      });
      return;
    }

    if (
      unusedLog.detectedMethod &&
      method &&
      unusedLog.detectedMethod !== method &&
      method !== 'Bank Transfer'
    ) {
      res.json({
        ok: true,
        verified: false,
        reason: `পেমেন্ট মাধ্যম মেলেনি! SMS এসেছে ${unusedLog.detectedMethod}-এ, আপনি সিলেক্ট করেছেন ${method}।`,
      });
      return;
    }

    const resolvedSender =
      (senderNumber && senderNumber.length >= 3 ? senderNumber : '') ||
      unusedLog.senderNumber ||
      unusedLog.smsSender ||
      'SMS-Verified';

    state.verifiedClaims[rawTrxId] = {
      trxId: rawTrxId,
      uid: caller.uid,
      userEmail: caller.email,
      amount: unusedLog.amount,
      method: unusedLog.detectedMethod || method || 'bKash',
      senderNumber: resolvedSender.slice(0, 40),
      smsLogId: unusedLog.id,
      verifiedAt: new Date().toISOString(),
    };
    unusedLog.matchedDepositId = `VERIFIED-${caller.uid.slice(0, 8)}`;
    unusedLog.matchedAt = new Date().toISOString();
    saveState();

    res.json({
      ok: true,
      verified: true,
      smsLogId: unusedLog.id,
      detectedMethod: unusedLog.detectedMethod || method,
      amount: unusedLog.amount,
      senderNumber: resolvedSender.slice(0, 40),
      trxId: rawTrxId,
    });
  });

  // 11. User -> Bind Firestore DEP-... rechargeId to verified claim for Admin auto-approval
  app.post('/api/deposit-gateway/register-verified-deposit', async (req: Request, res: Response) => {
    const caller = await verifySignedInFirebaseUser(req);
    if (!caller) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const rechargeId = typeof body.rechargeId === 'string' ? body.rechargeId.trim().slice(0, 128) : '';
    const trxId = typeof body.trxId === 'string' ? body.trxId.trim().toUpperCase() : '';

    const claim = state.verifiedClaims[trxId];
    if (!claim || claim.uid !== caller.uid || !rechargeId) {
      res.status(400).json({ ok: false, error: 'Verified claim not found' });
      return;
    }

    claim.rechargeId = rechargeId;
    const log = state.smsLogs.find(l => l.id === claim.smsLogId);
    if (log) {
      log.matchedDepositId = rechargeId;
      log.matchedAt = new Date().toISOString();
    }

    if (!state.pendingAutoApprovals.some(p => p.rechargeId === rechargeId)) {
      state.pendingAutoApprovals.push({
        rechargeId,
        trxId,
        smsLogId: claim.smsLogId,
        uid: caller.uid,
        amount: claim.amount,
        method: claim.method,
        queuedAt: new Date().toISOString(),
      });
    }

    saveState();
    res.json({ ok: true });
  });

  // 12. Admin -> Fetch queued verified deposits waiting to be credited in Firestore
  app.get('/api/deposit-gateway/admin/pending-auto-approvals', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    res.json({ items: state.pendingAutoApprovals.slice(0, 50) });
  });

  // 13. Admin -> Mark queued verified deposit as auto-approved in Firestore
  app.post('/api/deposit-gateway/admin/auto-approved', async (req: Request, res: Response) => {
    const admin = await verifyAdminRequest(req);
    if (!admin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const rechargeId = String((req.body as Record<string, unknown>)?.rechargeId || '').trim();
    state.pendingAutoApprovals = state.pendingAutoApprovals.filter(p => p.rechargeId !== rechargeId);
    const claim = Object.values(state.verifiedClaims).find(c => c.rechargeId === rechargeId);
    if (claim) {
      claim.autoApproved = true;
    }
    saveState();
    res.json({ ok: true });
  });
}
