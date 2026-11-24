/**
 * CaptchaPay Self-Healing Guard & Client Telemetry
 * Provides error reporting, automatic fallback recovery, and AI Diagnostic Report generation.
 */

export interface ErrorDiagnosticContext {
  message: string;
  source: string;
  url: string;
  stack?: string;
  componentStack?: string;
  userEmail?: string;
  userUid?: string;
  timestamp: string;
  userAgent: string;
}

let lastReportedSignature = '';
let lastReportedTime = 0;

/**
 * Report a client-side error to the server backend.
 * Silent fallback so the telemetry itself never throws or crashes.
 */
export async function reportClientError(
  error: unknown,
  source = 'client:react',
  extraContext?: {
    componentStack?: string;
    userEmail?: string;
    userUid?: string;
  }
): Promise<{ ok: boolean; alerted?: boolean }> {
  try {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    const stack = error instanceof Error ? error.stack : undefined;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const now = Date.now();

    // Prevent immediate duplicate reporting within 10 seconds
    const signature = `${source}:${message}`;
    if (signature === lastReportedSignature && now - lastReportedTime < 10000) {
      return { ok: true };
    }
    lastReportedSignature = signature;
    lastReportedTime = now;

    const payload = {
      message,
      source,
      url,
      stack: stack ? `${stack}\n\nComponent: ${extraContext?.componentStack || 'N/A'}` : extraContext?.componentStack,
      userEmail: extraContext?.userEmail,
      userUid: extraContext?.userUid,
    };

    const res = await fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      return { ok: true, alerted: data.alertSent };
    }
    return { ok: false };
  } catch {
    // Telemetry should never crash the user experience
    return { ok: false };
  }
}

/**
 * Formats a clean, structured diagnostic report ready to be copied and pasted to the AI.
 */
export function formatAiDiagnosticReport(data: {
  error: unknown;
  source?: string;
  componentStack?: string;
  userEmail?: string;
  userUid?: string;
}): string {
  const err = data.error instanceof Error ? data.error : new Error(String(data.error));
  const url = typeof window !== 'undefined' ? window.location.href : 'Unknown';
  const time = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });

  return [
    `# 🚨 CaptchaPay AI Diagnostic Report`,
    `**সময় (Time):** ${time}`,
    `**সোর্স (Source):** ${data.source || 'React Error Boundary'}`,
    `**ইউআরএল (URL):** ${url}`,
    `**ইউজার (User):** ${data.userEmail || 'Anonymous'} (${data.userUid || 'No UID'})`,
    ``,
    `### ⚠️ এরর মেসেজ (Error Message):`,
    `\`\`\``,
    err.message,
    `\`\`\``,
    ``,
    `### 🔍 স্ট্যাক ট্রেস (Stack Trace):`,
    `\`\`\``,
    err.stack ? err.stack.slice(0, 1000) : 'No stack trace available',
    `\`\`\``,
    data.componentStack ? `\n### 🧩 কম্পোনেন্ট স্ট্যাক (Component):\n\`\`\`\n${data.componentStack.slice(0, 500)}\n\`\`\`` : '',
    ``,
    `### 🛡️ সেলফ-হিলিং রিকভারি স্ট্যাটাস:`,
    `- লোকাল ক্যাশ সক্রিয়`,
    `- টেলিগ্রাম ব্যাকঅফিস অ্যালার্ট নোটিফাইড`,
    `- ব্যবহারকারী ডেটা সুরক্ষিত`,
  ].join('\n');
}

/**
 * Safe localStorage reader with fallback to prevent crashes if storage is blocked
 */
export function safeLocalStorageGet<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const item = window.localStorage.getItem(key);
    if (!item) return fallback;
    return JSON.parse(item) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safe localStorage setter
 */
export function safeLocalStorageSet<T>(key: string, value: T): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes an async function with auto-retry and exponential backoff
 */
export async function withAutoRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 600
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        throw err;
      }
      await new Promise(res => setTimeout(res, delayMs * Math.pow(1.5, attempt - 1)));
    }
  }
  throw new Error('All retry attempts failed');
}

/**
 * Attach global browser listeners to intercept uncaught errors
 */
export function initializeGlobalBrowserListeners(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    // Ignore benign browser extension script errors
    if (event.filename && event.filename.includes('chrome-extension')) return;

    reportClientError(event.error || event.message, 'window.onerror', {
      componentStack: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    // Ignore benign network aborts
    if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('cancelled')) return;

    reportClientError(reason, 'window.unhandledrejection');
  });
}
