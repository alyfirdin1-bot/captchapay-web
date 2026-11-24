import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const EMAIL_LOG_FILE = path.join(DATA_DIR, 'email-logs.json');

export interface EmailLogEntry {
  id: string;
  timestamp: string;
  recipientEmail: string;
  subject: string;
  eventType: string;
  status: 'sent' | 'simulated' | 'failed';
  error?: string;
}

let emailLogs: EmailLogEntry[] = [];

try {
  if (fs.existsSync(EMAIL_LOG_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      emailLogs = parsed.slice(0, 100);
    }
  }
} catch {
  emailLogs = [];
}

function saveEmailLogs(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(emailLogs, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save email logs:', err);
  }
}

function appendEmailLog(entry: Omit<EmailLogEntry, 'id' | 'timestamp'>): void {
  const full: EmailLogEntry = {
    id: `email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  emailLogs = [full, ...emailLogs].slice(0, 100);
  saveEmailLogs();
}

function getTransporter() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function wrapEmailHtml(title: string, bodyContent: string): string {
  return `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #1e293b; border: 1px solid #38bdf833; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }
    .header { background: linear-gradient(135deg, #0369a1, #0284c7); padding: 25px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 800; }
    .content { padding: 30px; line-height: 1.6; font-size: 14px; color: #cbd5e1; }
    .card { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .footer { background: #0f172a; padding: 15px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #334155; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; background: #0284c720; color: #38bdf8; border: 1px solid #0284c740; }
    .highlight { color: #38bdf8; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>CaptchaPay Bangladesh</h1>
      <p style="margin: 5px 0 0; font-size: 12px; opacity: 0.9;">অফিশিয়াল ইমেইল নোটিফিকেশন সিস্টেম</p>
    </div>
    <div class="content">
      <span class="badge">${title}</span>
      ${bodyContent}
    </div>
    <div class="footer">
      &copy; 2026 CaptchaPay Bangladesh. সকল অধিকার সংরক্ষিত।
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendEmailNotification(params: {
  email: string;
  subject: string;
  title: string;
  htmlBody: string;
  eventType?: string;
}): Promise<boolean> {
  const { email, subject, title, htmlBody, eventType = 'general' } = params;
  if (!email || !email.includes('@')) return false;

  const transporter = getTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@captchapay.com';
  const fullHtml = wrapEmailHtml(title, htmlBody);

  if (!transporter) {
    console.log(`[Email Simulated] To: ${email} | Subject: ${subject}`);
    appendEmailLog({
      recipientEmail: email,
      subject,
      eventType,
      status: 'simulated',
    });
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"CaptchaPay Bangladesh" <${fromEmail}>`,
      to: email,
      subject,
      html: fullHtml,
    });
    appendEmailLog({
      recipientEmail: email,
      subject,
      eventType,
      status: 'sent',
    });
    return true;
  } catch (err) {
    console.error('Failed to send email:', err);
    appendEmailLog({
      recipientEmail: email,
      subject,
      eventType,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function sendTransactionEmailNotice(params: {
  email: string;
  name: string;
  type: 'withdrawal_request' | 'recharge_request' | 'p2p_received' | 'p2p_sent' | 'support_reply';
  amount?: number;
  details?: string;
  trxId?: string;
}): Promise<void> {
  const { email, name, type, amount = 0, details = '', trxId = '' } = params;
  if (!email) return;

  let subject = 'CaptchaPay নোটিফিকেশন';
  let title = 'সিস্টেম আপডেট';
  let body = '';

  if (type === 'withdrawal_request') {
    subject = `উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে (৳${amount})`;
    title = '🏦 উইথড্র রিকোয়েস্ট পেন্ডিং';
    body = `
      <p>প্রিয় <strong>${name}</strong>,</p>
      <p>আপনার <strong>৳${amount}</strong> টাকার উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে এবং বর্তমানে পর্যালোচনায় (Pending) আছে।</p>
      <div class="card">
        <p>💵 পরিমাণ: <span class="highlight">৳${amount}</span></p>
        <p>📋 বিবরণ: ${details}</p>
        ${trxId ? `<p>🆔 আইডি: <code>${trxId}</code></p>` : ''}
      </div>
      <p>অ্যাডমিন কর্তৃক যাচাই শেষে খুব দ্রুত আপনার অ্যাকাউন্টে পেমেন্ট পাঠিয়ে দেওয়া হবে।</p>
    `;
  } else if (type === 'recharge_request') {
    subject = `মোবাইল রিচার্জ রিকোয়েস্ট জমা হয়েছে (৳${amount})`;
    title = '📱 মোবাইল রিচার্জ রিকোয়েস্ট পেন্ডিং';
    body = `
      <p>প্রিয় <strong>${name}</strong>,</p>
      <p>আপনার <strong>৳${amount}</strong> টাকার মোবাইল রিচার্জ রিকোয়েস্ট সফলভাবে জমা হয়েছে।</p>
      <div class="card">
        <p>💵 পরিমাণ: <span class="highlight">৳${amount}</span></p>
        <p>📞 নম্বর/বিবরণ: ${details}</p>
        ${trxId ? `<p>🆔 ট্রানজেকশন আইডি: <code>${trxId}</code></p>` : ''}
      </div>
      <p>যাচাই সাপেক্ষে আপনার নম্বরে রিচার্জ সফলভাবে সম্পন্ন করা হবে।</p>
    `;
  } else if (type === 'p2p_received') {
    subject = `নতুন P2P ব্যালেন্স প্রাপ্তি (৳${amount})`;
    title = '💚 P2P ব্যালেন্স অটো-ক্রেডিট';
    body = `
      <p>প্রিয় <strong>${name}</strong>,</p>
      <p>আপনার অ্যাকাউন্টে নতুন P2P ব্যালেন্স সরাসরি জমা হয়েছে!</p>
      <div class="card">
        <p>💰 প্রাপ্ত পরিমাণ: <span class="highlight">+৳${amount}</span></p>
        <p>ℹ️ বিবরণ: ${details}</p>
        ${trxId ? `<p>🆔 ট্রান্সফার আইডি: <code>${trxId}</code></p>` : ''}
      </div>
      <p>✨ কোনো ক্লেইম ছাড়াই টাকা সরাসরি আপনার ব্যালেন্সে যোগ হয়েছে।</p>
    `;
  } else if (type === 'p2p_sent') {
    subject = `P2P ব্যালেন্স সেন্ড সফল হয়েছে (৳${amount})`;
    title = '📤 P2P সেন্ড কনফার্মেশন';
    body = `
      <p>প্রিয় <strong>${name}</strong>,</p>
      <p>আপনার P2P ব্যালেন্স ট্রান্সফার সফলভাবে সম্পন্ন হয়েছে।</p>
      <div class="card">
        <p>💸 প্রেরিত পরিমাণ: <span class="highlight">৳${amount}</span></p>
        <p>👤 প্রাপক বিবরণ: ${details}</p>
        ${trxId ? `<p>🆔 ট্রান্সফার আইডি: <code>${trxId}</code></p>` : ''}
      </div>
    `;
  } else if (type === 'support_reply') {
    subject = `সাপোর্ট টিকিট আপডেট ও উত্তর`;
    title = '🎫 সাপোর্ট টিকিট উত্তর';
    body = `
      <p>প্রিয় <strong>${name}</strong>,</p>
      <p>আপনার সাপোর্ট টিকেটে অ্যাডমিন উত্তর দিয়েছেন:</p>
      <div class="card">
        <p>💬 উত্তর: ${details}</p>
      </div>
    `;
  }

  void sendEmailNotification({
    email,
    subject,
    title,
    htmlBody: body,
    eventType: type,
  });
}

export function registerEmailRoutes(app: any): void {
  app.get('/api/email/logs', (_req: any, res: any) => {
    res.json({
      configured: Boolean(getTransporter()),
      logs: emailLogs.slice(0, 50),
    });
  });
}
