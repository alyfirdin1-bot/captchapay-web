import { auth } from './firebase';
import type { TelegramAlertPrefs, TelegramBotStatus, TelegramDeliveryLog } from '../types';

export const DEFAULT_TELEGRAM_PREFS: TelegramAlertPrefs = {
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

export interface TelegramWalletSnapshot {
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

async function parseApiResponse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `সার্ভার ত্রুটি (${res.status})`);
  }
  return data;
}

export async function fetchTelegramStatus(): Promise<TelegramBotStatus> {
  const res = await fetchWithFirebaseAuth('/api/telegram/status');
  return parseApiResponse<TelegramBotStatus>(res);
}

export async function syncTelegramBindingToServer(params: {
  chatId?: string;
  username?: string;
  prefs?: TelegramAlertPrefs;
  snapshot?: TelegramWalletSnapshot;
}): Promise<void> {
  if (!params.chatId || !auth.currentUser) return;
  try {
    await fetchWithFirebaseAuth('/api/telegram/sync', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch {
    // Best-effort cache warm-up
  }
}

export async function requestTelegramLinkCode(): Promise<{
  code: string;
  botUsername: string;
  deepLink: string;
  expiresInMinutes: number;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/link-code', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return parseApiResponse(res);
}

export async function connectManualTelegramChatId(chatId: string): Promise<{
  linked: boolean;
  chatId: string;
  username: string;
  prefs: TelegramAlertPrefs;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/connect-manual', {
    method: 'POST',
    body: JSON.stringify({ chatId: chatId.trim() }),
  });
  return parseApiResponse(res);
}

export async function saveTelegramAlertPrefsOnServer(
  prefs: TelegramAlertPrefs
): Promise<{ ok: boolean; prefs: TelegramAlertPrefs }> {
  const res = await fetchWithFirebaseAuth('/api/telegram/preferences', {
    method: 'POST',
    body: JSON.stringify({ prefs }),
  });
  return parseApiResponse(res);
}

export async function unlinkTelegramOnServer(): Promise<void> {
  const res = await fetchWithFirebaseAuth('/api/telegram/unlink', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await parseApiResponse(res);
}

export async function sendTestTelegramReceipt(): Promise<void> {
  const res = await fetchWithFirebaseAuth('/api/telegram/test', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await parseApiResponse(res);
}

export async function requestTelegramOtp(): Promise<{ ok: boolean; expiresInSeconds: number }> {
  const res = await fetchWithFirebaseAuth('/api/telegram/otp/request', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return parseApiResponse(res);
}

export async function verifyTelegramOtp(code: string): Promise<{ ok: boolean; verified: boolean }> {
  const res = await fetchWithFirebaseAuth('/api/telegram/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim() }),
  });
  return parseApiResponse(res);
}

export type TelegramDispatchPayload =
  | { eventType: 'p2p_transfer'; docId: string }
  | { eventType: 'admin_new_withdrawal'; docId: string }
  | { eventType: 'admin_new_recharge'; docId: string }
  | { eventType: 'withdrawal_processed'; docId: string }
  | { eventType: 'recharge_processed'; docId: string }
  | {
      eventType: 'balance_adjusted';
      targetUserId: string;
      oldBalance: number;
      newBalance: number;
      reason?: string;
    }
  | { eventType: 'broadcast'; title: string; body: string; channelOnly?: boolean }
  | { eventType: 'daily_checkin' }
  | { eventType: 'support_ticket_created'; docId: string }
  | { eventType: 'support_ticket_replied'; docId: string }
  | { eventType: 'admin_user_ban_toggled'; targetUserId: string }
  | { eventType: 'admin_tier_changed'; targetUserId: string }
  | { eventType: 'admin_system_action'; title: string; detail?: string; targetUserId?: string };

export async function dispatchTelegramReceipt(
  payload: TelegramDispatchPayload
): Promise<{ ok?: boolean; sentCount?: number; failCount?: number; totalTargets?: number }> {
  try {
    if (!auth.currentUser) return {};
    const headers = await getAuthHeaders();
    const res = await fetch('/api/telegram/dispatch', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return {};
    return (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sentCount?: number;
      failCount?: number;
      totalTargets?: number;
    };
  } catch {
    return {};
  }
}

export interface AdminTelegramOverview {
  botConfigured: boolean;
  envManaged: boolean;
  maskedToken: string;
  botUsername: string;
  botName: string;
  pollingActive: boolean;
  adminRadarEnabled?: boolean;
  commands?: Array<{ command: string; description: string }>;
  linkedCount: number;
  linkedUsers: Array<{
    uid: string;
    name: string;
    email: string;
    username: string;
    chatId: string;
    linkedAt: string;
  }>;
  recentLogs: TelegramDeliveryLog[];
  channelBotConfigured?: boolean;
  channelEnvManaged?: boolean;
  channelChatIdEnvManaged?: boolean;
  channelMaskedToken?: string;
  channelBotUsername?: string;
  channelBotName?: string;
  channelChatId?: string;
  channelTitle?: string;
  channelUsername?: string;
  channelEnabled?: boolean;
  vaultSynced?: boolean;
  vaultUpdatedAt?: string;
}

export async function hydrateAdminTelegramVault(): Promise<{
  ok?: boolean;
  restoredChannel?: boolean;
  restoredBot?: boolean;
  vaultSynced?: boolean;
}> {
  if (!auth.currentUser) return {};
  try {
    const res = await fetchWithFirebaseAuth('/api/telegram/admin/hydrate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res.ok) return {};
    return (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      restoredChannel?: boolean;
      restoredBot?: boolean;
      vaultSynced?: boolean;
    };
  } catch {
    return {};
  }
}

export async function fetchAdminTelegramOverview(): Promise<AdminTelegramOverview> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/overview');
  return parseApiResponse<AdminTelegramOverview>(res);
}

export async function saveAdminTelegramBotToken(botToken: string): Promise<{
  ok: boolean;
  botConfigured: boolean;
  botUsername: string;
  botName: string;
  maskedToken: string;
  vaultSynced?: boolean;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/config', {
    method: 'POST',
    body: JSON.stringify({ botToken: botToken.trim() }),
  });
  return parseApiResponse(res);
}

export async function toggleAdminTelegramRadar(enabled: boolean): Promise<{
  ok: boolean;
  adminRadarEnabled: boolean;
  vaultSynced?: boolean;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/config', {
    method: 'POST',
    body: JSON.stringify({ action: 'toggle_radar', enabled }),
  });
  return parseApiResponse(res);
}

export async function syncAdminTelegramCommands(): Promise<{
  ok: boolean;
  commandsCount: number;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/config', {
    method: 'POST',
    body: JSON.stringify({ action: 'sync_commands' }),
  });
  return parseApiResponse(res);
}

export async function disconnectAdminTelegramBot(): Promise<void> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/config', {
    method: 'POST',
    body: JSON.stringify({ action: 'disconnect' }),
  });
  await parseApiResponse(res);
}

export async function saveAdminChannelBotConfig(params: {
  botToken?: string;
  channelChatId: string;
}): Promise<{
  ok: boolean;
  channelBotConfigured: boolean;
  channelBotUsername: string;
  channelBotName: string;
  channelMaskedToken: string;
  channelChatId: string;
  channelTitle: string;
  channelUsername?: string;
  channelEnabled: boolean;
  vaultSynced?: boolean;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/channel', {
    method: 'POST',
    body: JSON.stringify({
      action: 'save',
      botToken: params.botToken?.trim() || '',
      channelChatId: params.channelChatId.trim(),
    }),
  });
  return parseApiResponse(res);
}

export async function toggleAdminChannelEnabled(enabled: boolean): Promise<{
  ok: boolean;
  channelEnabled: boolean;
  vaultSynced?: boolean;
}> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/channel', {
    method: 'POST',
    body: JSON.stringify({ action: 'toggle', enabled }),
  });
  return parseApiResponse(res);
}

export async function sendAdminChannelTest(): Promise<{ ok: boolean }> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/channel', {
    method: 'POST',
    body: JSON.stringify({ action: 'test' }),
  });
  return parseApiResponse(res);
}

export async function disconnectAdminChannelBot(): Promise<void> {
  const res = await fetchWithFirebaseAuth('/api/telegram/admin/channel', {
    method: 'POST',
    body: JSON.stringify({ action: 'disconnect' }),
  });
  await parseApiResponse(res);
}
