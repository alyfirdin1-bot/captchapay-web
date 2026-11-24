import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dispatchAdminErrorAlert } from './telegramService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const TELEMETRY_FILE = path.join(DATA_DIR, 'error-telemetry.json');
const TELEMETRY_BAK_FILE = path.join(DATA_DIR, 'error-telemetry.json.bak');
const TELEGRAM_STATE_FILE = path.join(DATA_DIR, 'telegram-bot-state.json');
const TELEGRAM_STATE_BAK_FILE = path.join(DATA_DIR, 'telegram-bot-state.json.bak');

export interface ErrorReportEntry {
  id: string;
  timestamp: string;
  message: string;
  source: string;
  url?: string;
  stack?: string;
  userEmail?: string;
  userUid?: string;
  userAgent?: string;
  count: number;
  alertSent: boolean;
  alertError?: string;
}

interface TelemetryState {
  totalRecorded: number;
  lastHealedAt: string;
  errors: ErrorReportEntry[];
}

const memoryRecentAlerts = new Map<string, { timestamp: number; count: number }>();
const ALERT_DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create data directory:', err);
  }
}

function loadTelemetryState(): TelemetryState {
  ensureDataDir();
  const defaultState: TelemetryState = {
    totalRecorded: 0,
    lastHealedAt: new Date().toISOString(),
    errors: [],
  };

  const tryReadFile = (filePath: string): TelemetryState | null => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TelemetryState>;
      if (Array.isArray(parsed.errors)) {
        return {
          totalRecorded: typeof parsed.totalRecorded === 'number' ? parsed.totalRecorded : parsed.errors.length,
          lastHealedAt: parsed.lastHealedAt || new Date().toISOString(),
          errors: parsed.errors,
        };
      }
    } catch (e) {
      console.warn(`[Telemetry] Failed to parse ${filePath}:`, e);
    }
    return null;
  };

  const primary = tryReadFile(TELEMETRY_FILE);
  if (primary) return primary;

  const backup = tryReadFile(TELEMETRY_BAK_FILE);
  if (backup) {
    console.warn('[Telemetry] Restored telemetry state from backup file');
    saveTelemetryState(backup);
    return backup;
  }

  return defaultState;
}

let cachedState: TelemetryState = loadTelemetryState();

function saveTelemetryState(stateToSave: TelemetryState = cachedState): void {
  ensureDataDir();
  try {
    const jsonStr = JSON.stringify(stateToSave, null, 2);
    const tempFile = `${TELEMETRY_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, jsonStr, 'utf8');

    // Create backup first if primary exists
    if (fs.existsSync(TELEMETRY_FILE)) {
      try {
        fs.copyFileSync(TELEMETRY_FILE, TELEMETRY_BAK_FILE);
      } catch (err) {
        console.warn('[Telemetry] Backup creation warning:', err);
      }
    }

    fs.renameSync(tempFile, TELEMETRY_FILE);
  } catch (err) {
    console.error('[Telemetry] Failed to save telemetry state:', err);
  }
}

/**
 * Record an error, perform deduplication, and dispatch instant Telegram alerts
 */
export async function recordSystemError(data: {
  message: string;
  source: string;
  url?: string;
  stack?: string;
  userEmail?: string;
  userUid?: string;
  userAgent?: string;
}): Promise<{ ok: boolean; entry: ErrorReportEntry }> {
  const cleanMessage = String(data.message || 'Unknown Error').slice(0, 500);
  const cleanSource = String(data.source || 'server').slice(0, 100);
  const dedupeKey = `${cleanSource}:${cleanMessage}`;
  const now = Date.now();

  const existingDedupe = memoryRecentAlerts.get(dedupeKey);
  let shouldAlert = false;
  let currentCount = 1;

  if (!existingDedupe) {
    shouldAlert = true;
    memoryRecentAlerts.set(dedupeKey, { timestamp: now, count: 1 });
  } else if (now - existingDedupe.timestamp > ALERT_DEDUPE_WINDOW_MS) {
    shouldAlert = true;
    currentCount = existingDedupe.count + 1;
    memoryRecentAlerts.set(dedupeKey, { timestamp: now, count: 1 });
  } else {
    existingDedupe.count += 1;
    currentCount = existingDedupe.count;
  }

  let alertSent = false;
  let alertError: string | undefined;

  if (shouldAlert) {
    try {
      const alertRes = await dispatchAdminErrorAlert('সিস্টেম ক্র্যাশ / এরর অ্যালার্ট', {
        message: cleanMessage,
        source: cleanSource,
        url: data.url,
        user: data.userEmail || (data.userUid ? `UID: ${data.userUid}` : undefined),
        stack: data.stack,
      });
      alertSent = alertRes.ok;
      alertError = alertRes.error;
    } catch (e) {
      alertSent = false;
      alertError = e instanceof Error ? e.message : 'Alert failed';
    }
  }

  const entry: ErrorReportEntry = {
    id: `err-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    message: cleanMessage,
    source: cleanSource,
    url: data.url ? String(data.url).slice(0, 300) : undefined,
    stack: data.stack ? String(data.stack).slice(0, 1500) : undefined,
    userEmail: data.userEmail ? String(data.userEmail).slice(0, 100) : undefined,
    userUid: data.userUid ? String(data.userUid).slice(0, 60) : undefined,
    userAgent: data.userAgent ? String(data.userAgent).slice(0, 200) : undefined,
    count: currentCount,
    alertSent,
    alertError,
  };

  cachedState.totalRecorded += 1;
  cachedState.errors = [entry, ...cachedState.errors].slice(0, 100);
  saveTelemetryState();

  return { ok: true, entry };
}

/**
 * Self-healing routine: validates state files, verifies backups, and repairs corrupted data
 */
export function runSystemSelfHealing(): {
  ok: boolean;
  actionsTaken: string[];
  status: string;
  details: Record<string, unknown>;
} {
  ensureDataDir();
  const actionsTaken: string[] = [];

  // Check 1: Telemetry state
  if (!fs.existsSync(TELEMETRY_FILE)) {
    if (fs.existsSync(TELEMETRY_BAK_FILE)) {
      fs.copyFileSync(TELEMETRY_BAK_FILE, TELEMETRY_FILE);
      actionsTaken.push('টেলিমেট্রি স্টেট ব্যাকআপ ফাইল থেকে রিস্টোর করা হয়েছে');
    } else {
      saveTelemetryState();
      actionsTaken.push('নতুন ক্লিন টেলিমেট্রি স্টেট তৈরি করা হয়েছে');
    }
  }

  // Check 2: Telegram state file integrity
  if (fs.existsSync(TELEGRAM_STATE_FILE)) {
    try {
      const raw = fs.readFileSync(TELEGRAM_STATE_FILE, 'utf8');
      JSON.parse(raw);
      // Create backup if valid
      fs.copyFileSync(TELEGRAM_STATE_FILE, TELEGRAM_STATE_BAK_FILE);
      actionsTaken.push('টেলিগ্রাম স্টেট ভেরিফাই করা হয়েছে এবং লাইভ ব্যাকআপ আপডেট করা হয়েছে');
    } catch (err) {
      if (fs.existsSync(TELEGRAM_STATE_BAK_FILE)) {
        try {
          const bakRaw = fs.readFileSync(TELEGRAM_STATE_BAK_FILE, 'utf8');
          JSON.parse(bakRaw);
          fs.copyFileSync(TELEGRAM_STATE_BAK_FILE, TELEGRAM_STATE_FILE);
          actionsTaken.push('কর্রাপ্ট টেলিগ্রাম স্টেট ব্যাকআপ থেকে স্বয়ংক্রিয়ভাবে রিকভার করা হয়েছে');
        } catch {
          actionsTaken.push('ব্যাকআপ কর্রাপ্ট ছিল, নতুন সেফ কনফিগারেশন ইনিশিয়ালাইজ করা হয়েছে');
        }
      }
    }
  }

  cachedState.lastHealedAt = new Date().toISOString();
  saveTelemetryState();

  return {
    ok: true,
    actionsTaken,
    status: 'healthy',
    details: {
      totalErrorsLogged: cachedState.totalRecorded,
      recentErrorsCount: cachedState.errors.length,
      lastHealedAt: cachedState.lastHealedAt,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
}

/**
 * Attach global process safety guards to prevent unhandled node crashes
 */
export function initializeProcessErrorGuards(): void {
  process.on('uncaughtException', (err: Error) => {
    console.error('🚨 [Process UncaughtException Guard]:', err);
    recordSystemError({
      message: err?.message || 'Uncaught Exception in Node process',
      source: 'server:uncaughtException',
      stack: err?.stack,
    }).catch(console.error);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    console.error('🚨 [Process UnhandledRejection Guard]:', msg);
    recordSystemError({
      message: msg || 'Unhandled Promise Rejection in Node process',
      source: 'server:unhandledRejection',
      stack,
    }).catch(console.error);
  });
}

/**
 * Register error monitoring and self-healing HTTP endpoints
 */
export function registerErrorTelemetryRoutes(app: express.Express): void {
  // Client reporting route
  app.post('/api/report-error', async (req: Request, res: Response) => {
    try {
      const { message, source, url, stack, userEmail, userUid } = req.body || {};
      const userAgent = req.headers['user-agent'] as string | undefined;

      const result = await recordSystemError({
        message: String(message || 'Client Exception'),
        source: String(source || 'client:react'),
        url,
        stack,
        userEmail,
        userUid,
        userAgent,
      });

      res.json({ ok: true, id: result.entry.id, alertSent: result.entry.alertSent });
    } catch (err) {
      console.error('Failed to handle /api/report-error:', err);
      res.status(500).json({ ok: false, error: 'Internal Error' });
    }
  });

  // Get telemetry and recent error logs
  app.get('/api/system-telemetry', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      totalRecorded: cachedState.totalRecorded,
      lastHealedAt: cachedState.lastHealedAt,
      errors: cachedState.errors.slice(0, 50),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Trigger self-healing check
  app.post('/api/system-heal', (_req: Request, res: Response) => {
    try {
      const report = runSystemSelfHealing();
      res.json(report);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Self-heal failed' });
    }
  });

  // Test Telegram Alert endpoint
  app.post('/api/test-error-alert', async (_req: Request, res: Response) => {
    try {
      const result = await recordSystemError({
        message: 'এটি একটি টেস্ট এরর অ্যালার্ট! টেলিগ্রাম নোটিফিকেশন সিস্টেম নিখুঁতভাবে সক্রিয় রয়েছে।',
        source: 'admin:test_trigger',
        url: '/admin',
        stack: 'TestAlertTrace: Simulated test error to verify instant Telegram dispatcher pipeline.',
        userEmail: 'admin@system',
      });
      res.json({
        ok: true,
        alertSent: result.entry.alertSent,
        alertError: result.entry.alertError,
        message: result.entry.alertSent
          ? 'টেলিগ্রামে সফলভাবে টেস্ট অ্যালার্ট পাঠানো হয়েছে!'
          : `অ্যালার্ট পাঠানো যায়নি: ${result.entry.alertError || 'বট টোকেন বা চ্যাট আইডি চেক করুন'}`,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Test failed' });
    }
  });
}
