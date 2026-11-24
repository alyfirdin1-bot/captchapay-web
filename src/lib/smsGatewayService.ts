import { auth } from './firebase';
import type { PaymentMethod } from '../types';

export interface SmsGatewayDeviceInfo {
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
  isOnline: boolean;
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

export interface SmsGatewayAdminState {
  enabled: boolean;
  paymentSmsOnly: boolean;
  autoMatchAlertTelegram: boolean;
  envManaged: boolean;
  gatewayToken: string;
  maskedToken: string;
  vaultSynced: boolean;
  vaultUpdatedAt: string;
  serverUrl: string;
  ingestUrl: string;
  heartbeatUrl: string;
  androidProjectDir: string;
  devices: SmsGatewayDeviceInfo[];
  smsLogs: SmsGatewayLogItem[];
  stats: {
    onlineDevices: number;
    totalDevices: number;
    totalCaptured: number;
    matchedCount: number;
    unmatchedPaymentCount: number;
  };
}

async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('অনুগ্রহ করে প্রথমে গুগল দিয়ে সাইন ইন করুন।');
  }
  const token = await currentUser.getIdToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchWithFirebaseAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders(false);
  let res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && auth.currentUser) {
    const freshHeaders = await getAuthHeaders(true);
    res = await fetch(url, {
      ...init,
      headers: {
        ...freshHeaders,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }
  return res;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `সার্ভার ত্রুটি (${res.status})`);
  }
  return data;
}

export async function hydrateAdminSmsGatewayVault(): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await fetchWithFirebaseAuth('/api/deposit-gateway/admin/hydrate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch {
    // Best-effort vault hydration
  }
}

export async function fetchSmsGatewayAdminState(): Promise<SmsGatewayAdminState> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/admin/state');
  return parseJson<SmsGatewayAdminState>(res);
}

export async function updateSmsGatewayConfig(payload: {
  enabled?: boolean;
  paymentSmsOnly?: boolean;
  autoMatchAlertTelegram?: boolean;
  rotateToken?: boolean;
}): Promise<{ ok: boolean; state: SmsGatewayAdminState }> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/admin/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; state: SmsGatewayAdminState }>(res);
}

export async function sendTestGatewaySms(payload: {
  smsSender: string;
  rawBody: string;
}): Promise<{ ok: boolean; log: SmsGatewayLogItem; state: SmsGatewayAdminState }> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/admin/test-sms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; log: SmsGatewayLogItem; state: SmsGatewayAdminState }>(res);
}

export async function linkGatewaySmsToDeposit(logId: string, depositId: string): Promise<void> {
  const res = await fetchWithFirebaseAuth(
    `/api/deposit-gateway/admin/logs/${encodeURIComponent(logId)}/match`,
    {
      method: 'POST',
      body: JSON.stringify({ depositId }),
    }
  );
  await parseJson(res);
}

export async function deleteGatewaySmsLog(logId: string): Promise<void> {
  const res = await fetchWithFirebaseAuth(
    `/api/deposit-gateway/admin/logs/${encodeURIComponent(logId)}`,
    {
      method: 'DELETE',
    }
  );
  await parseJson(res);
}

export async function downloadAndroidSmsGatewayZip(): Promise<void> {
  const headers = await getAuthHeaders(false);
  const res = await fetch('/api/deposit-gateway/download-project', {
    method: 'GET',
    headers: {
      Authorization: headers.Authorization,
    },
  });
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || `ডাউনলোড ব্যর্থ (${res.status})`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'CaptchaPay-SMS-Gateway-Android.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
}

export interface VerifyPaymentResponse {
  ok: boolean;
  verified: boolean;
  reason?: string;
  smsLogId?: string;
  detectedMethod?: PaymentMethod;
  amount?: number;
  senderNumber?: string;
  trxId?: string;
}

export async function verifyDepositPaymentWithServer(payload: {
  amount: number;
  method: PaymentMethod;
  senderNumber?: string;
  trxId: string;
}): Promise<VerifyPaymentResponse> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/verify-payment', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseJson<VerifyPaymentResponse>(res);
}

export async function registerVerifiedDepositWithServer(payload: {
  rechargeId: string;
  trxId: string;
}): Promise<void> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/register-verified-deposit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await parseJson(res);
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

export async function fetchPendingAutoApprovals(): Promise<PendingAutoApprovalItem[]> {
  const res = await fetchWithFirebaseAuth('/api/deposit-gateway/admin/pending-auto-approvals');
  const data = await parseJson<{ items?: PendingAutoApprovalItem[] }>(res);
  return Array.isArray(data.items) ? data.items : [];
}

export async function markDepositAutoApproved(rechargeId: string): Promise<void> {
  await fetchWithFirebaseAuth('/api/deposit-gateway/admin/auto-approved', {
    method: 'POST',
    body: JSON.stringify({ rechargeId }),
  });
}
