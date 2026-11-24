import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteField,
  increment,
  FieldValue,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { isAuthorizedAdminEmail, getDefaultSettings, getDhakaDateKey, normalizeSettings } from './defaults';
import { createSaltedPinHash, isValidFourDigitPin, sha256Hex, verifyPinAgainstStoredHash } from './pinSecurity';
import { evaluateWithdrawalWindow } from './withdrawalSchedule';
import { dispatchTelegramReceipt, DEFAULT_TELEGRAM_PREFS } from './telegramService';
import type {
  AdWatchLog,
  AuditLogItem,
  CaptchaType,
  EarningPlan,
  P2PTransfer,
  PaymentMethod,
  RechargeRequest,
  SystemSettings,
  TelegramAlertPrefs,
  User,
  UserPlanSubscription,
  VideoAdItem,
  VipTier,
  WithdrawalRequest,
  SupportTicket,
  AppNotification,
} from '../types';

const SETTINGS_DOC_PATH = 'settings/global';

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `${prefix}-${Date.now()}-${rand || 'x1'}`;
}

function toIsoString(val: unknown): string {
  if (typeof val === 'string' && val.trim() !== '') return val;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function stripUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(item => stripUndefinedDeep(item)) as unknown as T;
  }
  if (
    obj &&
    typeof obj === 'object' &&
    !(obj instanceof Timestamp) &&
    !(obj instanceof FieldValue) &&
    !(obj instanceof Date)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return obj;
}

function serializeSettingsForFirestore(settings: SystemSettings): Record<string, unknown> {
  const normalized = normalizeSettings(settings);
  const cleanVideoAds: VideoAdItem[] = (normalized.videoAds || []).slice(0, 100).map(ad => {
    const item: VideoAdItem = {
      id: String(ad.id).slice(0, 128),
      title: String(ad.title || 'ভিডিও অ্যাড').slice(0, 200),
      url: String(ad.url || '').slice(0, 500),
      enabled: ad.enabled !== false,
      totalCompletedViews: Number(ad.totalCompletedViews) || 0,
      totalIncompleteViews: Number(ad.totalIncompleteViews) || 0,
      totalClicks: Number(ad.totalClicks) || 0,
      createdAt: String(ad.createdAt || new Date().toISOString()).slice(0, 64),
    };
    if (typeof ad.reward === 'number' && Number.isFinite(ad.reward)) {
      item.reward = Math.max(0, roundMoney(ad.reward));
    }
    if (typeof ad.minWatchSeconds === 'number' && Number.isFinite(ad.minWatchSeconds)) {
      item.minWatchSeconds = Math.max(3, Math.floor(ad.minWatchSeconds));
    }
    return item;
  });

  const cleaned = stripUndefinedDeep({
    adminEmail: '',
    minWithdrawal: Math.max(10, roundMoney(normalized.minWithdrawal)),
    rewardPerText: Math.max(0, roundMoney(normalized.rewardPerText)),
    rewardPerMath: Math.max(0, roundMoney(normalized.rewardPerMath)),
    rewardPerGrid: Math.max(0, roundMoney(normalized.rewardPerGrid)),
    rewardPerSlider: Math.max(0, roundMoney(normalized.rewardPerSlider)),
    dailyFreeLimit: Math.max(0, Math.floor(normalized.dailyFreeLimit)),
    dailySilverLimit: Math.max(0, Math.floor(normalized.dailySilverLimit ?? 60)),
    dailyGoldLimit: Math.max(0, Math.floor(normalized.dailyGoldLimit ?? 150)),
    dailyDiamondLimit: Math.max(0, Math.floor(normalized.dailyDiamondLimit ?? 9999)),
    useVipMultiplier: Boolean(normalized.useVipMultiplier),
    captchaConfigs: normalized.captchaConfigs,
    adConfig: normalized.adConfig,
    videoAds: cleanVideoAds,
    earningPlans: (normalized.earningPlans || []).slice(0, 50).map((p, idx) => ({
      id: String(p.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `plan-${idx + 1}`,
      name: String(p.name || 'ইনকাম প্ল্যান').slice(0, 120),
      price: Math.max(10, Math.min(1000000, roundMoney(Number(p.price) || 500))),
      dailyIncome: Math.max(1, Math.min(50000, roundMoney(Number(p.dailyIncome) || 35))),
      durationDays: Math.max(1, Math.min(3650, Math.floor(Number(p.durationDays) || 30))),
      badge: String(p.badge || '').slice(0, 40),
      description: String(p.description || '').slice(0, 300),
      color: p.color || 'emerald',
      enabled: p.enabled !== false,
      sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : idx + 1,
      createdAt: p.createdAt ? String(p.createdAt).slice(0, 64) : undefined,
    })),
    p2pConfig: normalized.p2pConfig,
    withdrawalSchedule: normalized.withdrawalSchedule,
    paymentNumbers: normalized.paymentNumbers,
    operatorLogos: normalized.operatorLogos,
    notice: String(normalized.notice || '').slice(0, 500),
    isMaintenance: Boolean(normalized.isMaintenance),
    announcements: (normalized.announcements || []).slice(0, 100).map(a => ({
      id: String(a.id || 'ann-' + Date.now()).slice(0, 128),
      title: String(a.title || 'অ্যাডমিন ঘোষণা').slice(0, 200),
      body: String(a.body || '').slice(0, 1000),
      createdAt: String(a.createdAt || '').slice(0, 64),
    })),
  });

  return {
    ...cleaned,
    updatedAt: serverTimestamp(),
  };
}

function mapDocToUser(raw: Record<string, unknown>, docId: string): User {
  const email = String(raw.email || '');
  const isAdminMail = isAuthorizedAdminEmail(email);
  const lastSeenIso = typeof raw.lastSeen === 'string' ? raw.lastSeen : undefined;
  const isOnline = lastSeenIso
    ? Date.now() - new Date(lastSeenIso).getTime() <= 90_000
    : false;

  const userObj: User = {
    id: String(raw.id || docId),
    name: String(raw.name || email.split('@')[0] || 'User'),
    email,
    avatar: String(raw.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`),
    role: isAdminMail ? 'admin' : 'user',
    balance: roundMoney(Number(raw.balance) || 0),
    totalEarned: roundMoney(Number(raw.totalEarned) || 0),
    totalWithdrawn: roundMoney(Number(raw.totalWithdrawn) || 0),
    totalRecharged: roundMoney(Number(raw.totalRecharged) || 0),
    captchasSolvedToday: Math.max(0, Number(raw.captchasSolvedToday) || 0),
    solvedTodayByType: (raw.solvedTodayByType as Record<CaptchaType, number>) || {
      text: 0,
      math: 0,
      image_grid: 0,
      slider: 0,
    },
    lastSolvedAtByType: (raw.lastSolvedAtByType as Partial<Record<CaptchaType, number>>) || {},
    totalCaptchasSolved: Math.max(0, Number(raw.totalCaptchasSolved) || 0),
    videosWatchedToday: Math.max(0, Number(raw.videosWatchedToday) || 0),
    totalVideosWatched: Math.max(0, Number(raw.totalVideosWatched) || 0),
    totalAdClicks: Math.max(0, Number(raw.totalAdClicks) || 0),
    incompleteAdsCount: Math.max(0, Number(raw.incompleteAdsCount) || 0),
    totalAdEarned: roundMoney(Number(raw.totalAdEarned) || 0),
    lastAdWatchedAt: Number(raw.lastAdWatchedAt) || 0,
    completedAdIds: Array.isArray(raw.completedAdIds) ? raw.completedAdIds.map(String) : [],
    vipTier: (['free', 'silver', 'gold', 'diamond'].includes(String(raw.vipTier))
      ? String(raw.vipTier)
      : 'free') as VipTier,
    isBanned: Boolean(raw.isBanned),
    joinedAt: String(raw.joinedAt || toIsoString(raw.createdAt)),
    lastLogin: String(raw.lastLogin || toIsoString(raw.updatedAt)),
    lastSeen: lastSeenIso,
    isOnline,
    hasWithdrawPin: typeof raw.withdrawPinHash === 'string' && raw.withdrawPinHash.length >= 16,
    withdrawPinUpdatedAt: typeof raw.withdrawPinUpdatedAt === 'string' ? raw.withdrawPinUpdatedAt : undefined,
    totalPlanEarned: roundMoney(Number(raw.totalPlanEarned) || 0),
    telegramChatId: typeof raw.telegramChatId === 'string' ? raw.telegramChatId : '',
    telegramUsername: typeof raw.telegramUsername === 'string' ? raw.telegramUsername : '',
    telegramAlertPrefs:
      raw.telegramAlertPrefs && typeof raw.telegramAlertPrefs === 'object'
        ? { ...DEFAULT_TELEGRAM_PREFS, ...(raw.telegramAlertPrefs as Partial<TelegramAlertPrefs>) }
        : { ...DEFAULT_TELEGRAM_PREFS },
  };

  if (typeof raw.customDailyLimit === 'number' && Number.isFinite(raw.customDailyLimit)) {
    userObj.customDailyLimit = raw.customDailyLimit;
  }

  return userObj;
}

function mapDocToRecharge(raw: Record<string, unknown>, docId: string): RechargeRequest {
  return {
    id: String(raw.id || docId),
    userId: String(raw.userId || ''),
    userName: String(raw.userName || ''),
    userEmail: String(raw.userEmail || ''),
    amount: roundMoney(Number(raw.amount) || 0),
    method: (raw.method || 'Mobile Recharge') as PaymentMethod,
    senderNumber: String(raw.senderNumber || ''),
    senderSim: typeof raw.senderSim === 'string' ? raw.senderSim : undefined,
    trxId: String(raw.trxId || ''),
    status: (['pending', 'approved', 'rejected'].includes(String(raw.status))
      ? String(raw.status)
      : 'pending') as RechargeRequest['status'],
    adminNote: typeof raw.adminNote === 'string' ? raw.adminNote : undefined,
    createdAt: toIsoString(raw.createdAtIso ?? raw.createdAt),
    processedAt: typeof raw.processedAt === 'string' ? raw.processedAt : undefined,
  };
}

function mapDocToWithdrawal(raw: Record<string, unknown>, docId: string): WithdrawalRequest {
  return {
    id: String(raw.id || docId),
    userId: String(raw.userId || ''),
    userName: String(raw.userName || ''),
    userEmail: String(raw.userEmail || ''),
    amount: roundMoney(Number(raw.amount) || 0),
    method: (raw.method || 'bKash') as PaymentMethod,
    accountNumber: String(raw.accountNumber || ''),
    accountType: raw.accountType === 'agent' ? 'agent' : 'personal',
    status: (['pending', 'approved', 'rejected'].includes(String(raw.status))
      ? String(raw.status)
      : 'pending') as WithdrawalRequest['status'],
    payoutTrxId: typeof raw.payoutTrxId === 'string' ? raw.payoutTrxId : undefined,
    adminNote: typeof raw.adminNote === 'string' ? raw.adminNote : undefined,
    createdAt: toIsoString(raw.createdAtIso ?? raw.createdAt),
    processedAt: typeof raw.processedAt === 'string' ? raw.processedAt : undefined,
  };
}

export interface ExtendedAdWatchLog extends Omit<AdWatchLog, 'status'> {
  status: 'clicked' | 'completed' | 'incomplete';
}

function mapDocToAdWatchLog(raw: Record<string, unknown>, docId: string): ExtendedAdWatchLog {
  const statusRaw = String(raw.status || 'incomplete');
  const status = (statusRaw === 'completed' || statusRaw === 'clicked' ? statusRaw : 'incomplete') as
    | 'clicked'
    | 'completed'
    | 'incomplete';

  return {
    id: String(raw.id || docId),
    sessionId: String(raw.sessionId || ''),
    userId: String(raw.userId || ''),
    userName: String(raw.userName || ''),
    userEmail: String(raw.userEmail || ''),
    adId: String(raw.adId || ''),
    adTitle: String(raw.adTitle || ''),
    adUrl: String(raw.adUrl || ''),
    status,
    reviewStatus:
      raw.reviewStatus === 'in_review' || raw.reviewStatus === 'reviewed'
        ? raw.reviewStatus
        : undefined,
    watchedSeconds: Math.max(0, Number(raw.watchedSeconds) || 0),
    requiredSeconds: Math.max(0, Number(raw.requiredSeconds) || 0),
    earned: roundMoney(Number(raw.earned) || 0),
    createdAt: toIsoString(raw.createdAtIso ?? raw.createdAt),
  };
}

function mapDocToAuditLog(raw: Record<string, unknown>, docId: string): AuditLogItem {
  return {
    id: String(raw.id || docId),
    timestamp: toIsoString(raw.timestamp ?? raw.createdAt),
    action: String(raw.action || ''),
    actorEmail: String(raw.actorEmail || ''),
    details: String(raw.details || ''),
  };
}

async function writeAuditLog(action: string, actorEmail: string, details: string): Promise<void> {
  const logId = makeDocId('aud');
  const logRef = doc(db, 'auditLogs', logId);
  try {
    await setDoc(logRef, {
      id: logId,
      timestamp: new Date().toISOString().slice(0, 64),
      action: action.slice(0, 120),
      actorEmail: actorEmail.slice(0, 200),
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auditLogs/${logId}`);
  }
}

export async function ensureAdminSettingsInitialized(): Promise<void> {
  const ref = doc(db, 'settings', 'global');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, serializeSettingsForFirestore(getDefaultSettings()));
    } else {
      const existingData = snap.data() as Partial<SystemSettings> | undefined;
      if (existingData?.adminEmail) {
        await setDoc(ref, serializeSettingsForFirestore(normalizeSettings(existingData)));
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, SETTINGS_DOC_PATH);
  }
}

const upsertInFlightByUid = new Map<string, Promise<User>>();

export function upsertUserOnSignIn(fbUser: FirebaseUser): Promise<User> {
  const uid = fbUser.uid;
  const existingPromise = upsertInFlightByUid.get(uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async (): Promise<User> => {
    const email = (fbUser.email || '').trim();
    const isAdminMail = isAuthorizedAdminEmail(email);
    const displayName = (fbUser.displayName || email.split('@')[0] || 'User').trim().slice(0, 120);
    const avatar = (
      fbUser.photoURL ||
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`
    ).slice(0, 500);
    const nowIso = new Date().toISOString();
    const userRef = doc(db, 'users', uid);

    try {
      const resultUser = await runTransaction(db, async tx => {
        const snap = await tx.get(userRef);
        if (!snap.exists()) {
          const newProfile = {
            id: uid,
            uid,
            name: displayName || 'User',
            email,
            avatar,
            role: isAdminMail ? 'admin' : 'user',
            balance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
            totalRecharged: 0,
            captchasSolvedToday: 0,
            solvedTodayByType: { text: 0, math: 0, image_grid: 0, slider: 0 },
            lastSolvedAtByType: {},
            totalCaptchasSolved: 0,
            videosWatchedToday: 0,
            totalVideosWatched: 0,
            totalAdClicks: 0,
            incompleteAdsCount: 0,
            totalAdEarned: 0,
            lastAdWatchedAt: 0,
            completedAdIds: [] as string[],
            vipTier: 'free',
            isBanned: false,
            joinedAt: nowIso,
            lastLogin: nowIso,
            lastSeen: nowIso,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          tx.set(userRef, newProfile);
          return mapDocToUser(
            {
              ...newProfile,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
            uid
          );
        }

        const existing = snap.data() as Record<string, unknown>;
        if (!existing.isBanned || isAdminMail) {
          const updatePayload: Record<string, unknown> = {
            name: displayName || String(existing.name || 'User'),
            avatar,
            lastLogin: nowIso,
            lastSeen: nowIso,
            updatedAt: serverTimestamp(),
          };
          if (isAdminMail && existing.role !== 'admin') {
            updatePayload.role = 'admin';
          }
          tx.update(userRef, updatePayload);
          return mapDocToUser(
            {
              ...existing,
              ...updatePayload,
              updatedAt: nowIso,
            },
            uid
          );
        }

        return mapDocToUser(existing, uid);
      });

      if (isAdminMail) {
        await ensureAdminSettingsInitialized();
      }

      if (email) {
        try {
          const emailHash = await sha256Hex(email.toLowerCase());
          await setDoc(doc(db, 'walletDirectory', emailHash), {
            id: emailHash,
            uid,
            name: displayName || resultUser.name.slice(0, 120) || 'User',
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Best-effort directory sync for P2P transfers
        }
      }

      return resultUser;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
    }
  })().finally(() => {
    upsertInFlightByUid.delete(uid);
  });

  upsertInFlightByUid.set(uid, task);
  return task;
}

export async function touchUserPresence(uid: string): Promise<void> {
  if (!uid) return;
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      lastSeen: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Presence heartbeat is best-effort; avoid interrupting active user tasks if offline briefly
  }
}

export function subscribeToUserProfile(
  uid: string,
  onData: (user: User | null) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const userRef = doc(db, 'users', uid);
  return onSnapshot(
    userRef,
    snap => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(mapDocToUser(snap.data() as Record<string, unknown>, snap.id));
    },
    err => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }
  );
}

export function subscribeToSettings(
  onData: (settings: SystemSettings) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const settingsRef = doc(db, 'settings', 'global');
  return onSnapshot(
    settingsRef,
    snap => {
      if (!snap.exists()) {
        onData(getDefaultSettings());
        return;
      }
      onData(normalizeSettings(snap.data() as Partial<SystemSettings>));
    },
    err => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.GET, SETTINGS_DOC_PATH);
    }
  );
}

export function subscribeToUserTransactions(
  uid: string,
  onData: (data: { withdrawals: WithdrawalRequest[]; recharges: RechargeRequest[] }) => void
): Unsubscribe {
  let latestWithdrawals: WithdrawalRequest[] = [];
  let latestRecharges: RechargeRequest[] = [];

  const emit = () => {
    onData({
      withdrawals: [...latestWithdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      recharges: [...latestRecharges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  };

  const wQuery = query(collection(db, 'withdrawals'), where('userId', '==', uid));
  const rQuery = query(collection(db, 'recharges'), where('userId', '==', uid));

  const unsubW = onSnapshot(
    wQuery,
    snap => {
      latestWithdrawals = snap.docs.map(d => mapDocToWithdrawal(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
  );

  const unsubR = onSnapshot(
    rQuery,
    snap => {
      latestRecharges = snap.docs.map(d => mapDocToRecharge(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'recharges')
  );

  return () => {
    unsubW();
    unsubR();
  };
}

export function subscribeToUserAdLogs(
  uid: string,
  onData: (logs: AdWatchLog[]) => void
): Unsubscribe {
  const logsQuery = query(collection(db, 'adWatchLogs'), where('userId', '==', uid));
  return onSnapshot(
    logsQuery,
    snap => {
      const mapped = snap.docs
        .map(d => mapDocToAdWatchLog(d.data() as Record<string, unknown>, d.id))
        .filter((l): l is AdWatchLog => l.status === 'completed' || l.status === 'incomplete')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(mapped);
    },
    err => handleFirestoreError(err, OperationType.LIST, 'adWatchLogs')
  );
}

export async function solveCaptchaTransaction(params: {
  uid: string;
  captchaType: CaptchaType;
  settings: SystemSettings;
}): Promise<{ user: User; earned: number; cooldownSeconds: number }> {
  const { uid, captchaType, settings } = params;
  const userRef = doc(db, 'users', uid);

  try {
    const result = await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      }

      const existingRaw = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(existingRaw, uid);
      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      const normalized = normalizeSettings(settings);
      const typeCfg = normalized.captchaConfigs?.[captchaType];
      if (!typeCfg || typeCfg.enabled === false) {
        throw new Error('এই ক্যাপচা সেকশনটি বর্তমানে বন্ধ রয়েছে।');
      }

      const solvedByType = {
        text: current.solvedTodayByType?.text ?? 0,
        math: current.solvedTodayByType?.math ?? 0,
        image_grid: current.solvedTodayByType?.image_grid ?? 0,
        slider: current.solvedTodayByType?.slider ?? 0,
      };
      const typeSolved = solvedByType[captchaType] || 0;

      if (typeCfg.dailyLimit < 9999 && typeSolved >= typeCfg.dailyLimit) {
        throw new Error(`আপনার আজকের এই ক্যাপচার লিমিট (${typeCfg.dailyLimit} টি) পূর্ণ হয়েছে!`);
      }
      if (
        current.customDailyLimit !== undefined &&
        current.customDailyLimit < 9999 &&
        current.captchasSolvedToday >= current.customDailyLimit
      ) {
        throw new Error(`আপনার ব্যক্তিগত দৈনিক লিমিট (${current.customDailyLimit} টি) পূর্ণ হয়েছে!`);
      }

      const lastSolvedMs = current.lastSolvedAtByType?.[captchaType] || 0;
      const cooldownSec = Math.max(0, typeCfg.cooldownSeconds || 0);
      if (cooldownSec > 0 && lastSolvedMs > 0) {
        const elapsedSec = (Date.now() - lastSolvedMs) / 1000;
        if (elapsedSec + 0.5 < cooldownSec) {
          const remaining = Math.ceil(cooldownSec - elapsedSec);
          const err = new Error(`নতুন ক্যাপচা আসতে আরও ${remaining} সেকেন্ড অপেক্ষা করুন`) as Error & {
            cooldownRemaining?: number;
          };
          err.cooldownRemaining = remaining;
          throw err;
        }
      }

      const tierMultipliers: Record<VipTier, number> = {
        free: 1.0,
        silver: 1.4,
        gold: 2.0,
        diamond: 3.2,
      };
      const mult = normalized.useVipMultiplier ? tierMultipliers[current.vipTier] || 1.0 : 1.0;
      const earned = Math.min(50, Math.max(0, roundMoney(typeCfg.reward * mult)));
      const nowMs = Date.now();
      const nowIso = new Date().toISOString();

      const rawBalance = typeof existingRaw.balance === 'number' && Number.isFinite(existingRaw.balance)
        ? existingRaw.balance
        : current.balance;
      const rawTotalEarned = typeof existingRaw.totalEarned === 'number' && Number.isFinite(existingRaw.totalEarned)
        ? existingRaw.totalEarned
        : current.totalEarned;
      const nextBalance = earned > 0 ? Math.max(rawBalance, roundMoney(rawBalance + earned)) : rawBalance;
      const nextTotalEarned = earned > 0 ? Math.max(rawTotalEarned, roundMoney(rawTotalEarned + earned)) : rawTotalEarned;
      const nextSolvedToday = current.captchasSolvedToday + 1;
      const nextTotalSolved = current.totalCaptchasSolved + 1;
      const nextSolvedByType = {
        ...solvedByType,
        [captchaType]: typeSolved + 1,
      };
      const nextLastSolvedByType = {
        ...(current.lastSolvedAtByType || {}),
        [captchaType]: nowMs,
      };

      tx.update(userRef, {
        balance: nextBalance,
        totalEarned: nextTotalEarned,
        captchasSolvedToday: nextSolvedToday,
        solvedTodayByType: nextSolvedByType,
        lastSolvedAtByType: nextLastSolvedByType,
        totalCaptchasSolved: nextTotalSolved,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      const updatedUser: User = {
        ...current,
        balance: nextBalance,
        totalEarned: nextTotalEarned,
        captchasSolvedToday: nextSolvedToday,
        solvedTodayByType: nextSolvedByType,
        lastSolvedAtByType: nextLastSolvedByType,
        totalCaptchasSolved: nextTotalSolved,
        lastSeen: nowIso,
      };

      return { user: updatedUser, earned, cooldownSeconds: cooldownSec };
    });

    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function recordAdClickTransaction(params: {
  uid: string;
  sessionId: string;
  ad: VideoAdItem;
  requiredSeconds: number;
}): Promise<void> {
  const { uid, sessionId, ad, requiredSeconds } = params;
  const userRef = doc(db, 'users', uid);
  const clickLogId = makeDocId('adclk');
  const logRef = doc(db, 'adWatchLogs', clickLogId);
  const nowIso = new Date().toISOString();

  try {
    await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('ইউজার পাওয়া যায়নি');
      }
      const current = mapDocToUser(userSnap.data() as Record<string, unknown>, uid);
      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      tx.update(userRef, {
        totalAdClicks: (current.totalAdClicks || 0) + 1,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(logRef, {
        id: clickLogId,
        sessionId: sessionId.slice(0, 128),
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        adId: ad.id.slice(0, 128),
        adTitle: ad.title.slice(0, 200),
        adUrl: ad.url.slice(0, 500),
        status: 'clicked',
        watchedSeconds: 0,
        requiredSeconds,
        earned: 0,
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !('code' in err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `adWatchLogs/${clickLogId}`);
  }
}

export async function completeAdWatchTransaction(params: {
  uid: string;
  sessionId: string;
  ad: VideoAdItem;
  startedAtMs: number;
  settings: SystemSettings;
}): Promise<{
  success: boolean;
  incomplete: boolean;
  watchedSeconds: number;
  requiredSeconds: number;
  earned: number;
  message: string;
  user: User;
}> {
  const { uid, sessionId, ad, startedAtMs, settings } = params;
  const userRef = doc(db, 'users', uid);
  const logId = makeDocId('adlog');
  const logRef = doc(db, 'adWatchLogs', logId);
  const normalized = normalizeSettings(settings);
  const adCfg = normalized.adConfig!;
  const requiredSeconds = Math.max(3, ad.minWatchSeconds ?? adCfg.minWatchSeconds ?? 10);
  const watchedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const incomplete = watchedSeconds < requiredSeconds;
  const nowIso = new Date().toISOString();

  try {
    return await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('ইউজার পাওয়া যায়নি');
      }
      const current = mapDocToUser(userSnap.data() as Record<string, unknown>, uid);
      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      if (incomplete) {
        const nextIncompleteCount = (current.incompleteAdsCount || 0) + 1;
        tx.update(userRef, {
          incompleteAdsCount: nextIncompleteCount,
          lastSeen: nowIso,
          updatedAt: serverTimestamp(),
        });

        tx.set(logRef, {
          id: logId,
          sessionId: sessionId.slice(0, 128),
          userId: uid,
          userName: current.name.slice(0, 120),
          userEmail: current.email.slice(0, 200),
          adId: ad.id.slice(0, 128),
          adTitle: ad.title.slice(0, 200),
          adUrl: ad.url.slice(0, 500),
          status: 'incomplete',
          watchedSeconds,
          requiredSeconds,
          earned: 0,
          createdAtIso: nowIso,
          createdAt: serverTimestamp(),
        });

        return {
          success: false,
          incomplete: true,
          watchedSeconds,
          requiredSeconds,
          earned: 0,
          message: `অটোমেটিক অ্যাড ব্লক! আপনি কমপক্ষে ${requiredSeconds} সেকেন্ড দেখার আগেই হোমস্ক্রিনে ফিরে এসেছেন (${watchedSeconds}s দেখেছেন)। আপনার একাউন্টে কোনো টাকা যোগ হয়নি — পুনরায় অ্যাডটি দেখুন।`,
          user: {
            ...current,
            incompleteAdsCount: nextIncompleteCount,
            lastSeen: nowIso,
          },
        };
      }

      const alreadyCompleted = (current.completedAdIds || []).includes(ad.id);
      if (alreadyCompleted) {
        throw new Error('এই ভিডিও অ্যাডটি ইতিমধ্যেই দেখা সম্পন্ন ও রিভিউতে রয়েছে।');
      }

      const dailyLimit = Math.max(0, adCfg.dailyLimit ?? 15);
      if (dailyLimit < 9999 && (current.videosWatchedToday || 0) >= dailyLimit) {
        throw new Error(`আজকের ভিডিও অ্যাড দেখার লিমিট (${dailyLimit} টি) পূর্ণ হয়েছে!`);
      }

      const tierMultipliers: Record<VipTier, number> = {
        free: 1.0,
        silver: 1.4,
        gold: 2.0,
        diamond: 3.2,
      };
      const mult = normalized.useVipMultiplier ? tierMultipliers[current.vipTier] || 1.0 : 1.0;
      const baseReward = ad.reward ?? adCfg.reward ?? 5.0;
      const earned = Math.min(100, Math.max(0, roundMoney(baseReward * mult)));

      const userRaw = userSnap.data() as Record<string, unknown>;
      const rawBalance = typeof userRaw.balance === 'number' && Number.isFinite(userRaw.balance)
        ? userRaw.balance
        : current.balance;
      const rawTotalEarned = typeof userRaw.totalEarned === 'number' && Number.isFinite(userRaw.totalEarned)
        ? userRaw.totalEarned
        : current.totalEarned;
      const nextBalance = earned > 0 ? roundMoney(rawBalance + earned) : rawBalance;
      const nextTotalEarned = earned > 0 ? roundMoney(rawTotalEarned + earned) : rawTotalEarned;
      const nextTotalAdEarned = roundMoney((current.totalAdEarned || 0) + earned);
      const nextWatchedToday = (current.videosWatchedToday || 0) + 1;
      const nextTotalWatched = (current.totalVideosWatched || 0) + 1;
      const nextCompletedIds = [...(current.completedAdIds || []), ad.id].slice(-200);
      const nowMs = Date.now();

      tx.update(userRef, {
        balance: nextBalance,
        totalEarned: nextTotalEarned,
        totalAdEarned: nextTotalAdEarned,
        videosWatchedToday: nextWatchedToday,
        totalVideosWatched: nextTotalWatched,
        lastAdWatchedAt: nowMs,
        completedAdIds: nextCompletedIds,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(logRef, {
        id: logId,
        sessionId: sessionId.slice(0, 128),
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        adId: ad.id.slice(0, 128),
        adTitle: ad.title.slice(0, 200),
        adUrl: ad.url.slice(0, 500),
        status: 'completed',
        reviewStatus: 'in_review',
        watchedSeconds,
        requiredSeconds,
        earned,
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        incomplete: false,
        watchedSeconds,
        requiredSeconds,
        earned,
        message: `অভিনন্দন! আপনি ${watchedSeconds} সেকেন্ড ভিডিওটি দেখেছেন এবং আপনার একাউন্টে ৳${earned.toFixed(2)} যোগ হয়েছে!`,
        user: {
          ...current,
          balance: nextBalance,
          totalEarned: nextTotalEarned,
          totalAdEarned: nextTotalAdEarned,
          videosWatchedToday: nextWatchedToday,
          totalVideosWatched: nextTotalWatched,
          lastAdWatchedAt: nowMs,
          completedAdIds: nextCompletedIds,
          lastSeen: nowIso,
        },
      };
    });
  } catch (err) {
    if (err instanceof Error && !('code' in err)) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `adWatchLogs/${logId}`);
  }
}

export async function submitRechargeTransaction(params: {
  uid: string;
  amount: number;
  senderNumber: string;
  senderSim: string;
  method?: PaymentMethod;
  pin?: string;
}): Promise<{ user: User; recharge: RechargeRequest }> {
  const { uid, amount, senderNumber, senderSim, method = 'Mobile Recharge', pin = '' } = params;
  const cleanAmount = roundMoney(amount);
  const cleanNumber = senderNumber.trim();
  const cleanSim = senderSim.trim();

  if (!Number.isFinite(cleanAmount) || cleanAmount < 10 || cleanAmount > 50000) {
    throw new Error('সর্বনিম্ন ৳১০ এবং সর্বোচ্চ ৳৫০,০০০ রিচার্জ করতে পারবেন।');
  }
  if (cleanNumber.length < 3 || cleanNumber.length > 40) {
    throw new Error('সঠিক মোবাইল নাম্বার প্রদান করুন।');
  }

  const rechargeId = makeDocId('RCH');
  const trxId = `RCH-${Math.floor(100000 + Math.random() * 900000)}`;
  const userRef = doc(db, 'users', uid);
  const rechargeRef = doc(db, 'recharges', rechargeId);
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      const rawData = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawData, uid);

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }
      if (typeof rawData.withdrawPinHash === 'string' && rawData.withdrawPinHash.length >= 16) {
        if (!isValidFourDigitPin(pin)) {
          throw new Error('আপনার ৪-ডিজিট সিকিউরিটি পিন প্রদান করুন।');
        }
        const pinOk = await verifyPinAgainstStoredHash(pin, uid, rawData.withdrawPinHash);
        if (!pinOk) {
          throw new Error('ভুল ৪-ডিজিট সিকিউরিটি পিন! সঠিক পিন দিয়ে চেষ্টা করুন।');
        }
      }
      if (current.balance < cleanAmount) {
        throw new Error('আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!');
      }

      const nextBalance = roundMoney(current.balance - cleanAmount);
      tx.update(userRef, {
        balance: nextBalance,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(rechargeRef, {
        id: rechargeId,
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        amount: cleanAmount,
        method: method.slice(0, 40),
        senderNumber: cleanNumber.slice(0, 40),
        senderSim: cleanSim.slice(0, 40),
        trxId,
        status: 'pending',
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
      });

      const recharge: RechargeRequest = {
        id: rechargeId,
        userId: uid,
        userName: current.name,
        userEmail: current.email,
        amount: cleanAmount,
        method,
        senderNumber: cleanNumber,
        senderSim: cleanSim,
        trxId,
        status: 'pending',
        createdAt: nowIso,
      };

      return {
        user: { ...current, balance: nextBalance, lastSeen: nowIso },
        recharge,
      };
    });

    void dispatchTelegramReceipt({ eventType: 'admin_new_recharge', docId: rechargeId });
    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `recharges/${rechargeId}`);
  }
}

export async function submitDepositTransaction(params: {
  uid: string;
  amount: number;
  senderNumber: string;
  trxId: string;
  method: PaymentMethod;
}): Promise<{ user: User; recharge: RechargeRequest }> {
  const { uid, amount, senderNumber, trxId, method } = params;
  const cleanAmount = roundMoney(amount);
  const cleanNumber = senderNumber.trim();
  const cleanTrxId = trxId.trim();

  if (!Number.isFinite(cleanAmount) || cleanAmount < 50 || cleanAmount > 100000) {
    throw new Error('সর্বনিম্ন ৳৫০ এবং সর্বোচ্চ ৳১,০০,০০০ ডিপোজিট করতে পারবেন।');
  }
  if (cleanNumber.length < 3 || cleanNumber.length > 40) {
    throw new Error('আপনার সঠিক সেন্ডার মোবাইল নাম্বার প্রদান করুন।');
  }
  if (!cleanTrxId || cleanTrxId.length < 4) {
    throw new Error('সঠিক ট্রানজেকশন আইডি (TrxID) প্রদান করুন।');
  }

  const rechargeId = makeDocId('DEP');
  const userRef = doc(db, 'users', uid);
  const rechargeRef = doc(db, 'recharges', rechargeId);
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      const rawData = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawData, uid);

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      tx.set(rechargeRef, {
        id: rechargeId,
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        amount: cleanAmount,
        method: method.slice(0, 40),
        senderNumber: cleanNumber.slice(0, 40),
        trxId: cleanTrxId.slice(0, 60),
        status: 'pending',
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
      });

      const recharge: RechargeRequest = {
        id: rechargeId,
        userId: uid,
        userName: current.name,
        userEmail: current.email,
        amount: cleanAmount,
        method,
        senderNumber: cleanNumber,
        trxId: cleanTrxId,
        status: 'pending',
        createdAt: nowIso,
      };

      return {
        user: current,
        recharge,
      };
    });

    void dispatchTelegramReceipt({ eventType: 'admin_new_recharge', docId: rechargeId });
    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `recharges/${rechargeId}`);
  }
}

export function subscribeToSingleRecharge(
  rechargeId: string,
  onUpdate: (recharge: RechargeRequest | null) => void
): () => void {
  const ref = doc(db, 'recharges', rechargeId);
  return onSnapshot(
    ref,
    snap => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(mapDocToRecharge(snap.data() as Record<string, unknown>, snap.id));
    },
    () => {
      // Ignore transient listener errors
    }
  );
}

export async function submitWithdrawalTransaction(params: {
  uid: string;
  amount: number;
  method: PaymentMethod;
  accountNumber: string;
  accountType: 'personal' | 'agent';
  minWithdrawal: number;
  pin: string;
}): Promise<{ user: User; withdrawal: WithdrawalRequest }> {
  const { uid, amount, method, accountNumber, accountType, minWithdrawal, pin } = params;
  const cleanAmount = roundMoney(amount);
  const cleanAccount = accountNumber.trim();

  if (!Number.isFinite(cleanAmount) || cleanAmount < Math.max(10, minWithdrawal) || cleanAmount > 100000) {
    throw new Error(`সর্বনিম্ন উত্তোলন পরিমাণ ৳${Math.max(10, minWithdrawal)}`);
  }
  if (cleanAccount.length < 3 || cleanAccount.length > 120) {
    throw new Error('সঠিক একাউন্ট নাম্বার প্রদান করুন।');
  }
  if (!isValidFourDigitPin(pin)) {
    throw new Error('সঠিক ৪ সংখ্যার সিকিউরিটি পিন প্রদান করুন।');
  }

  const withdrawalId = makeDocId('WDR');
  const userRef = doc(db, 'users', uid);
  const withdrawalRef = doc(db, 'withdrawals', withdrawalId);
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      const settingsSnap = await tx.get(doc(db, 'settings', 'global'));
      if (!userSnap.exists()) throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      const rawData = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawData, uid);

      const liveSettings = settingsSnap.exists()
        ? normalizeSettings(settingsSnap.data() as Partial<SystemSettings>)
        : getDefaultSettings();
      const windowStatus = evaluateWithdrawalWindow(liveSettings.withdrawalSchedule);
      if (!windowStatus.isOpen) {
        const countdownHint = windowStatus.countdownText ? ` (খুলবে: ${windowStatus.countdownText})` : '';
        throw new Error(`${windowStatus.headline}${countdownHint}`);
      }

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }
      if (typeof rawData.withdrawPinHash !== 'string' || rawData.withdrawPinHash.length < 16) {
        throw new Error('উইথড্র করার আগে অনুগ্রহ করে আপনার ৪-ডিজিট সিকিউরিটি পিন সেট করুন।');
      }
      const pinOk = await verifyPinAgainstStoredHash(pin, uid, rawData.withdrawPinHash);
      if (!pinOk) {
        throw new Error('ভুল ৪-ডিজিট সিকিউরিটি পিন! সঠিক পিন দিয়ে আবার চেষ্টা করুন।');
      }
      if (current.balance < cleanAmount) {
        throw new Error('আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!');
      }

      const nextBalance = roundMoney(current.balance - cleanAmount);
      tx.update(userRef, {
        balance: nextBalance,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(withdrawalRef, {
        id: withdrawalId,
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        amount: cleanAmount,
        method: method.slice(0, 40),
        accountNumber: cleanAccount.slice(0, 120),
        accountType,
        status: 'pending',
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
      });

      const withdrawal: WithdrawalRequest = {
        id: withdrawalId,
        userId: uid,
        userName: current.name,
        userEmail: current.email,
        amount: cleanAmount,
        method,
        accountNumber: cleanAccount,
        accountType,
        status: 'pending',
        createdAt: nowIso,
      };

      return {
        user: { ...current, balance: nextBalance, lastSeen: nowIso },
        withdrawal,
      };
    });

    void dispatchTelegramReceipt({ eventType: 'admin_new_withdrawal', docId: withdrawalId });
    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `withdrawals/${withdrawalId}`);
  }
}

export interface AdminOverviewSnapshot {
  users: User[];
  recharges: RechargeRequest[];
  withdrawals: WithdrawalRequest[];
  settings: SystemSettings;
  settingsLoaded: boolean;
  auditLogs: AuditLogItem[];
  adWatchLogs: AdWatchLog[];
  rawAdLogs: ExtendedAdWatchLog[];
  userPlans: UserPlanSubscription[];
}

export function subscribeToAdminOverview(
  onData: (snapshot: AdminOverviewSnapshot) => void
): Unsubscribe {
  let users: User[] = [];
  let recharges: RechargeRequest[] = [];
  let withdrawals: WithdrawalRequest[] = [];
  let settings: SystemSettings = getDefaultSettings();
  let settingsLoaded = false;
  let auditLogs: AuditLogItem[] = [];
  let rawAdLogs: ExtendedAdWatchLog[] = [];
  let userPlans: UserPlanSubscription[] = [];

  const emit = () => {
    const adWatchLogs: AdWatchLog[] = rawAdLogs
      .filter((l): l is AdWatchLog => l.status === 'completed' || l.status === 'incomplete')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    onData({
      users: [...users],
      recharges: [...recharges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      withdrawals: [...withdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      settings,
      settingsLoaded,
      auditLogs: [...auditLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      adWatchLogs,
      rawAdLogs: [...rawAdLogs],
      userPlans: [...userPlans].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  };

  const unsubUsers = onSnapshot(
    collection(db, 'users'),
    snap => {
      users = snap.docs.map(d => mapDocToUser(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'users')
  );

  const unsubRecharges = onSnapshot(
    collection(db, 'recharges'),
    snap => {
      recharges = snap.docs.map(d => mapDocToRecharge(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'recharges')
  );

  const unsubWithdrawals = onSnapshot(
    collection(db, 'withdrawals'),
    snap => {
      withdrawals = snap.docs.map(d => mapDocToWithdrawal(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
  );

  const unsubSettings = onSnapshot(
    doc(db, 'settings', 'global'),
    snap => {
      settings = snap.exists()
        ? normalizeSettings(snap.data() as Partial<SystemSettings>)
        : getDefaultSettings();
      settingsLoaded = true;
      emit();
    },
    err => handleFirestoreError(err, OperationType.GET, SETTINGS_DOC_PATH)
  );

  const unsubAdLogs = onSnapshot(
    collection(db, 'adWatchLogs'),
    snap => {
      rawAdLogs = snap.docs.map(d => mapDocToAdWatchLog(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'adWatchLogs')
  );

  const unsubAuditLogs = onSnapshot(
    collection(db, 'auditLogs'),
    snap => {
      auditLogs = snap.docs.map(d => mapDocToAuditLog(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
  );

  const unsubUserPlans = onSnapshot(
    collection(db, 'userPlans'),
    snap => {
      userPlans = snap.docs.map(d => mapDocToUserPlan(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'userPlans')
  );

  return () => {
    unsubUsers();
    unsubRecharges();
    unsubWithdrawals();
    unsubSettings();
    unsubAdLogs();
    unsubAuditLogs();
    unsubUserPlans();
  };
}

export async function saveSettingsInFirestore(
  newSettings: SystemSettings,
  actorEmail: string
): Promise<SystemSettings> {
  const settingsRef = doc(db, 'settings', 'global');
  try {
    await setDoc(settingsRef, serializeSettingsForFirestore(newSettings));
    await writeAuditLog(
      'সিস্টেম ও রেট সেটিংস আপডেট',
      actorEmail,
      'সিস্টেম কনফিগারেশন, ক্যাপচা রেট এবং অ্যাড সেটিংস Cloud Firestore-এ সেভ করা হয়েছে।'
    );
    return normalizeSettings(newSettings);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, SETTINGS_DOC_PATH);
  }
}

export async function processRechargeTransaction(params: {
  rechargeId: string;
  action: 'approve' | 'reject';
  adminNote?: string;
  actorEmail: string;
}): Promise<string> {
  const { rechargeId, action, adminNote, actorEmail } = params;
  const rechargeRef = doc(db, 'recharges', rechargeId);
  const nowIso = new Date().toISOString();

  try {
    const info = await runTransaction(db, async tx => {
      const rSnap = await tx.get(rechargeRef);
      if (!rSnap.exists()) throw new Error('রিচার্জ রিকোয়েস্ট পাওয়া যায়নি');
      const r = mapDocToRecharge(rSnap.data() as Record<string, unknown>, rechargeId);
      if (r.status !== 'pending') {
        throw new Error('এই রিকোয়েস্টটি ইতিমধ্যেই প্রসেস করা হয়েছে।');
      }

      const userRef = doc(db, 'users', r.userId);
      const uSnap = await tx.get(userRef);

      const isDeposit = r.method !== 'Mobile Recharge';
      const status = action === 'approve' ? 'approved' : 'rejected';
      const defaultNote = action === 'approve'
        ? (isDeposit ? 'ডিপোজিট সফলভাবে অনুমোদন ও ব্যালেন্স যুক্ত হয়েছে' : 'মোবাইল রিচার্জ সফলভাবে পাঠানো হয়েছে')
        : (isDeposit ? 'ডিপোজিট রিকোয়েস্ট বাতিল করা হয়েছে' : 'রিচার্জ রিকোয়েস্ট বাতিল ও ব্যালেন্স ফেরত দেওয়া হয়েছে');
      const finalNote = (adminNote || defaultNote).slice(0, 300);

      tx.update(rechargeRef, {
        status,
        adminNote: finalNote,
        processedAt: nowIso,
      });

      if (uSnap.exists()) {
        const u = mapDocToUser(uSnap.data() as Record<string, unknown>, r.userId);
        if (action === 'approve') {
          tx.update(userRef, {
            balance: isDeposit ? roundMoney(u.balance + r.amount) : u.balance,
            totalRecharged: roundMoney(u.totalRecharged + r.amount),
            updatedAt: serverTimestamp(),
          });
        } else {
          if (!isDeposit) {
            tx.update(userRef, {
              balance: roundMoney(u.balance + r.amount),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      return { r, status, isDeposit };
    });

    const isDeposit = info.isDeposit;
    await writeAuditLog(
      info.status === 'approved'
        ? (isDeposit ? 'ডিপোজিট অনুমোদন' : 'রিচার্জ অনুমোদন')
        : (isDeposit ? 'ডিপোজিট বাতিল' : 'রিচার্জ বাতিল'),
      actorEmail,
      `${info.r.userName} (${info.r.method} - ${info.r.senderNumber}) - ৳${info.r.amount} [${info.r.trxId || 'N/A'}] ${
        info.status === 'approved'
          ? (isDeposit ? 'অনুমোদিত ও ব্যালেন্সে যুক্ত' : 'অনুমোদিত')
          : (isDeposit ? 'বাতিলকৃত' : 'বাতিল ও ব্যালেন্স ফেরত')
      }`
    );

    void dispatchTelegramReceipt({
      eventType: 'recharge_processed',
      docId: rechargeId,
    });

    if (isDeposit) {
      return info.status === 'approved'
        ? `৳${info.r.amount} ডিপোজিট সফলভাবে অনুমোদন করা হয়েছে এবং ইউজারের ব্যালেন্সে যুক্ত হয়েছে!`
        : 'ডিপোজিট রিকোয়েস্ট বাতিল করা হয়েছে।';
    }

    return info.status === 'approved'
      ? 'মোবাইল রিচার্জ সফলভাবে অনুমোদন করা হয়েছে!'
      : 'রিচার্জ বাতিল করা হয়েছে এবং ব্যালেন্স ফেরত দেওয়া হয়েছে।';
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `recharges/${rechargeId}`);
  }
}

export async function processWithdrawalTransaction(params: {
  withdrawalId: string;
  action: 'approve' | 'reject';
  payoutTrxId?: string;
  adminNote?: string;
  actorEmail: string;
}): Promise<string> {
  const { withdrawalId, action, payoutTrxId, adminNote, actorEmail } = params;
  const withdrawalRef = doc(db, 'withdrawals', withdrawalId);
  const nowIso = new Date().toISOString();

  try {
    const info = await runTransaction(db, async tx => {
      const wSnap = await tx.get(withdrawalRef);
      if (!wSnap.exists()) throw new Error('উইথড্র রিকোয়েস্ট পাওয়া যায়নি');
      const w = mapDocToWithdrawal(wSnap.data() as Record<string, unknown>, withdrawalId);
      if (w.status !== 'pending') {
        throw new Error('এই উইথড্র রিকোয়েস্টটি ইতিমধ্যেই প্রসেস করা হয়েছে।');
      }

      const userRef = doc(db, 'users', w.userId);
      const uSnap = await tx.get(userRef);

      const status = action === 'approve' ? 'approved' : 'rejected';
      const finalNote = (
        adminNote ||
        (action === 'approve'
          ? 'টাকা সফলভাবে পাঠানো হয়েছে'
          : 'অ্যাকাউন্ট তথ্যে ভুল থাকায় টাকা রিফান্ড করা হলো')
      ).slice(0, 300);

      const updatePayload: Record<string, unknown> = {
        status,
        adminNote: finalNote,
        processedAt: nowIso,
      };
      if (action === 'approve') {
        updatePayload.payoutTrxId = (
          payoutTrxId?.trim() || `BKP${Math.floor(1000000 + Math.random() * 9000000)}`
        ).slice(0, 80);
      }

      tx.update(withdrawalRef, updatePayload);

      if (uSnap.exists()) {
        const u = mapDocToUser(uSnap.data() as Record<string, unknown>, w.userId);
        if (action === 'approve') {
          tx.update(userRef, {
            totalWithdrawn: roundMoney(u.totalWithdrawn + w.amount),
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(userRef, {
            balance: roundMoney(u.balance + w.amount),
            updatedAt: serverTimestamp(),
          });
        }
      }

      return { w, status };
    });

    await writeAuditLog(
      info.status === 'approved' ? 'উইথড্র পেমেন্ট সম্পন্ন' : 'উইথড্র বাতিল ও রিফান্ড',
      actorEmail,
      `${info.w.userName} (${info.w.method}) - ৳${info.w.amount}`
    );

    void dispatchTelegramReceipt({
      eventType: 'withdrawal_processed',
      docId: withdrawalId,
    });

    return info.status === 'approved'
      ? 'উইথড্র পেমেন্ট সফলভাবে অনুমোদিত হয়েছে!'
      : 'উইথড্র বাতিল করা হয়েছে এবং টাকা ইউজারের একাউন্টে ফেরত গেছে।';
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `withdrawals/${withdrawalId}`);
  }
}

export async function adjustUserBalanceTransaction(params: {
  targetUserId: string;
  exactBalance?: number;
  deltaAmount?: number;
  reason?: string;
  actorEmail: string;
}): Promise<{ user: User; message: string }> {
  const { targetUserId, exactBalance, deltaAmount, reason, actorEmail } = params;
  const userRef = doc(db, 'users', targetUserId);

  try {
    const res = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
      const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);

      const nextBalance =
        typeof exactBalance === 'number' && Number.isFinite(exactBalance)
          ? Math.max(0, roundMoney(exactBalance))
          : Math.max(0, roundMoney(u.balance + (Number(deltaAmount) || 0)));

      const deltaDiff = roundMoney(nextBalance - u.balance);
      const nextTotalEarned =
        deltaDiff > 0 ? roundMoney(u.totalEarned + deltaDiff) : u.totalEarned;

      tx.update(userRef, {
        balance: nextBalance,
        totalEarned: nextTotalEarned,
        updatedAt: serverTimestamp(),
      });

      return {
        oldBalance: u.balance,
        user: { ...u, balance: nextBalance, totalEarned: nextTotalEarned },
      };
    });

    await writeAuditLog(
      'অ্যাডমিন ব্যালেন্স সমন্বয়',
      actorEmail,
      `${res.user.name} (${res.user.email}): ৳${res.oldBalance.toFixed(2)} → ৳${res.user.balance.toFixed(2)}${
        reason ? ` (${reason})` : ''
      }`
    );

    void dispatchTelegramReceipt({
      eventType: 'balance_adjusted',
      targetUserId,
      oldBalance: res.oldBalance,
      newBalance: res.user.balance,
      reason,
    });

    return {
      user: res.user,
      message: `${res.user.name}-এর ব্যালেন্স আপডেট হয়েছে: ৳${res.user.balance.toFixed(2)}`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function toggleUserBanInFirestore(
  targetUserId: string,
  actorEmail: string
): Promise<{ user: User; message: string }> {
  const userRef = doc(db, 'users', targetUserId);
  try {
    const res = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
      const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);
      if (u.role === 'admin' || isAuthorizedAdminEmail(u.email)) {
        throw new Error('অ্যাডমিন একাউন্ট ব্যান করা যাবে না।');
      }
      const nextBanned = !u.isBanned;
      tx.update(userRef, {
        isBanned: nextBanned,
        updatedAt: serverTimestamp(),
      });
      return { ...u, isBanned: nextBanned };
    });

    await writeAuditLog(
      res.isBanned ? 'ইউজার ব্যান' : 'ইউজার আনব্যান',
      actorEmail,
      `${res.name} (${res.email})`
    );

    void dispatchTelegramReceipt({
      eventType: 'admin_user_ban_toggled',
      targetUserId,
    });

    return {
      user: res,
      message: res.isBanned ? `${res.name}-কে ব্যান করা হয়েছে` : `${res.name}-কে আনব্যান করা হয়েছে`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function setUserTierInFirestore(
  targetUserId: string,
  tier: VipTier,
  actorEmail: string
): Promise<{ user: User; message: string }> {
  const userRef = doc(db, 'users', targetUserId);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
    const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);
    await updateDoc(userRef, {
      vipTier: tier,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      'ইউজার প্যাকেজ পরিবর্তন',
      actorEmail,
      `${u.name} → ${tier.toUpperCase()}`
    );

    void dispatchTelegramReceipt({
      eventType: 'admin_tier_changed',
      targetUserId,
    });

    return {
      user: { ...u, vipTier: tier },
      message: `${u.name}-এর প্যাকেজ ${tier.toUpperCase()} করা হয়েছে।`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function setUserCustomLimitInFirestore(
  targetUserId: string,
  customDailyLimit: number | null,
  actorEmail: string
): Promise<{ user: User; message: string }> {
  const userRef = doc(db, 'users', targetUserId);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
    const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);

    if (customDailyLimit === null || !Number.isFinite(customDailyLimit)) {
      await updateDoc(userRef, {
        customDailyLimit: deleteField(),
        updatedAt: serverTimestamp(),
      });
      const updated = { ...u };
      delete updated.customDailyLimit;
      await writeAuditLog('দৈনিক কাস্টম লিমিট রিসেট', actorEmail, `${u.name} → ডিফল্ট লিমিট`);
      void dispatchTelegramReceipt({
        eventType: 'admin_system_action',
        title: 'দৈনিক কাস্টম লিমিট রিসেট',
        detail: 'ডিফল্ট দৈনিক লিমিট পুনরায় কার্যকর হয়েছে',
        targetUserId,
      });
      return { user: updated, message: `${u.name}-এর ব্যক্তিগত লিমিট ডিফল্টে রিসেট হয়েছে।` };
    }

    const cleanLimit = Math.max(0, Math.floor(customDailyLimit));
    await updateDoc(userRef, {
      customDailyLimit: cleanLimit,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog('দৈনিক কাস্টম লিমিট সেট', actorEmail, `${u.name} → ${cleanLimit} টি`);
    void dispatchTelegramReceipt({
      eventType: 'admin_system_action',
      title: 'ব্যক্তিগত দৈনিক লিমিট আপডেট',
      detail: `নতুন দৈনিক লিমিট: ${cleanLimit} টি`,
      targetUserId,
    });
    return {
      user: { ...u, customDailyLimit: cleanLimit },
      message: `${u.name}-এর ব্যক্তিগত দৈনিক লিমিট ${cleanLimit} টি সেট হয়েছে।`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function resetAllDailyQuotasInFirestore(actorEmail: string): Promise<string> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    await Promise.all(
      snap.docs.map(d =>
        updateDoc(d.ref, {
          captchasSolvedToday: 0,
          solvedTodayByType: { text: 0, math: 0, image_grid: 0, slider: 0 },
          videosWatchedToday: 0,
          updatedAt: serverTimestamp(),
        })
      )
    );
    await writeAuditLog(
      'দৈনিক ক্যাপচা ও ভিডিও লিমিট রিসেট',
      actorEmail,
      `সকল (${snap.size} জন) ইউজারের আজকের কাউন্ট ০ করা হয়েছে।`
    );
    void dispatchTelegramReceipt({
      eventType: 'admin_system_action',
      title: 'দৈনিক ক্যাপচা ও ভিডিও লিমিট রিসেট',
      detail: `সকল (${snap.size} জন) ইউজারের আজকের কোটা ০ করা হয়েছে`,
    });
    return 'সকল ইউজারের আজকের ক্যাপচা ও ভিডিও লিমিট ০ করা হয়েছে!';
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'users');
  }
}

export async function resetVideoAdInFirestore(adId: string, actorEmail: string): Promise<string> {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    await Promise.all(
      usersSnap.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        const completed = Array.isArray(data.completedAdIds) ? data.completedAdIds.map(String) : [];
        if (!completed.includes(adId)) return Promise.resolve();
        return updateDoc(d.ref, {
          completedAdIds: completed.filter(id => id !== adId),
          updatedAt: serverTimestamp(),
        });
      })
    );

    const logsQuery = query(collection(db, 'adWatchLogs'), where('adId', '==', adId));
    const logsSnap = await getDocs(logsQuery);
    await Promise.all(
      logsSnap.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        if (data.status === 'completed' && data.reviewStatus === 'in_review') {
          return updateDoc(d.ref, { reviewStatus: 'reviewed' });
        }
        return Promise.resolve();
      })
    );

    await writeAuditLog(
      'ভিডিও অ্যাড রিভিউ রিসেট',
      actorEmail,
      `Ad ID ${adId} পুনরায় সকল ইউজারের জন্য চালু করা হয়েছে।`
    );

    void dispatchTelegramReceipt({
      eventType: 'admin_system_action',
      title: 'ভিডিও অ্যাড রিভিউ রিসেট',
      detail: `Ad ID ${adId} পুনরায় সকল ইউজারের জন্য চালু করা হয়েছে`,
    });

    return 'ভিডিওটি রিভিউ থেকে পুনরায় সকল ইউজারের জন্য চালু হয়েছে!';
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `adWatchLogs`);
  }
}

export async function resetUserAdsInFirestore(
  targetUserId: string,
  actorEmail: string
): Promise<{ user: User; message: string }> {
  const userRef = doc(db, 'users', targetUserId);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
    const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);

    await updateDoc(userRef, {
      videosWatchedToday: 0,
      completedAdIds: [],
      updatedAt: serverTimestamp(),
    });

    const logsQuery = query(collection(db, 'adWatchLogs'), where('userId', '==', targetUserId));
    const logsSnap = await getDocs(logsQuery);
    await Promise.all(
      logsSnap.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        if (data.status === 'completed' && data.reviewStatus === 'in_review') {
          return updateDoc(d.ref, { reviewStatus: 'reviewed' });
        }
        return Promise.resolve();
      })
    );

    await writeAuditLog(
      'ইউজারের ভিডিও রিভিউ লক রিসেট',
      actorEmail,
      `${u.name} (${u.email}) এর ভিডিও লিমিট ও রিভিউ লক রিসেট করা হয়েছে।`
    );

    void dispatchTelegramReceipt({
      eventType: 'admin_system_action',
      title: 'ইউজারের ভিডিও রিভিউ লক রিসেট',
      detail: 'ভিডিও দৈনিক লিমিট ও রিভিউ লক রিসেট করা হয়েছে',
      targetUserId,
    });

    return {
      user: { ...u, videosWatchedToday: 0, completedAdIds: [] },
      message: `${u.name}-এর সকল ভিডিও রিভিউ লক ও দৈনিক লিমিট রিসেট হয়েছে!`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function claimDailyCheckIn(userId: string): Promise<{ success: boolean; reward: number; message: string; streak: number }> {
  const userRef = doc(db, 'users', userId);
  const nowIso = new Date().toISOString();
  try {
    const result = await runTransaction(db, async transaction => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
      const data = snap.data() as Record<string, unknown>;
      if (Boolean(data.isBanned) && !isAuthorizedAdminEmail(String(data.email || ''))) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }
      const todayStr = nowIso.slice(0, 10);
      const lastCheckIn = String(data.lastCheckInDate || '');

      if (lastCheckIn === todayStr) {
        throw new Error('আপনি আজ ইতিমধ্যেই দৈনিক চেক-ইন বোনাস ক্লেইম করেছেন!');
      }

      let streak = Number(data.checkInStreak || 0);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (lastCheckIn === yesterday) {
        streak += 1;
      } else {
        streak = 1;
      }

      const reward = Math.min(20, 5 + Math.floor(streak / 3) * 5); // 5 to 20 BDT based on streak
      const currentBalance = typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : 0;
      const currentEarned = typeof data.totalEarned === 'number' && Number.isFinite(data.totalEarned) ? data.totalEarned : 0;

      transaction.update(userRef, {
        balance: roundMoney(currentBalance + reward),
        totalEarned: roundMoney(currentEarned + reward),
        lastCheckInDate: todayStr,
        checkInStreak: streak,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        reward,
        streak,
        message: `অভিনন্দন! আপনার ${streak} দিনের স্ট্রিক বোনাস ৳${reward} সফলভাবে যোগ হয়েছে!`,
      };
    });

    void dispatchTelegramReceipt({ eventType: 'daily_checkin' });
    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    throw err;
  }
}

export async function createSupportTicket(
  userId: string,
  userName: string,
  userEmail: string,
  subject: string,
  message: string
): Promise<string> {
  const ticketId = makeDocId('ticket');
  const ticketRef = doc(db, 'supportTickets', ticketId);
  const nowIso = new Date().toISOString();
  try {
    await setDoc(ticketRef, {
      id: ticketId,
      userId,
      userName: userName.slice(0, 120),
      userEmail: userEmail.slice(0, 200),
      subject: subject.slice(0, 200),
      message: message.slice(0, 1000),
      status: 'open',
      createdAtIso: nowIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void dispatchTelegramReceipt({ eventType: 'support_ticket_created', docId: ticketId });
    return ticketId;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.CREATE, `supportTickets/${ticketId}`);
    throw err;
  }
}

export async function replySupportTicket(
  ticketId: string,
  adminReply: string,
  status: 'answered' | 'closed'
): Promise<void> {
  const ticketRef = doc(db, 'supportTickets', ticketId);
  try {
    await updateDoc(ticketRef, {
      adminReply: adminReply.slice(0, 1000),
      status,
      updatedAt: serverTimestamp(),
    });
    void dispatchTelegramReceipt({ eventType: 'support_ticket_replied', docId: ticketId });
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `supportTickets/${ticketId}`);
    throw err;
  }
}

export function subscribeToSupportTickets(
  userId: string | null,
  isAdmin: boolean,
  callback: (tickets: SupportTicket[]) => void
): Unsubscribe {
  const ticketsRef = collection(db, 'supportTickets');
  const q = isAdmin ? ticketsRef : query(ticketsRef, where('userId', '==', userId || ''));
  return onSnapshot(
    q,
    snapshot => {
      const list: SupportTicket[] = snapshot.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: String(data.id || d.id),
          userId: String(data.userId || ''),
          userName: String(data.userName || 'User'),
          userEmail: String(data.userEmail || ''),
          subject: String(data.subject || ''),
          message: String(data.message || ''),
          status: (data.status as 'open' | 'answered' | 'closed') || 'open',
          adminReply: data.adminReply ? String(data.adminReply) : undefined,
          createdAt: toIsoString(data.createdAt),
          updatedAt: data.updatedAt ? toIsoString(data.updatedAt) : undefined,
        };
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    err => {
      handleFirestoreError(err, OperationType.LIST, 'supportTickets');
    }
  );
}

export async function sendBroadcastNotification(
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'broadcast'
): Promise<string> {
  const notifId = makeDocId('notif');
  const notifRef = doc(db, 'notifications', notifId);
  const nowIso = new Date().toISOString();
  try {
    await setDoc(notifRef, {
      id: notifId,
      title: title.slice(0, 150),
      message: message.slice(0, 500),
      type,
      createdAtIso: nowIso,
      createdAt: serverTimestamp(),
      readBy: [],
    });
    void dispatchTelegramReceipt({
      eventType: 'broadcast',
      title: title.slice(0, 150),
      body: message.slice(0, 500),
      channelOnly: true,
    });
    return notifId;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.CREATE, `notifications/${notifId}`);
    throw err;
  }
}

export function subscribeToNotifications(callback: (notifs: AppNotification[]) => void): Unsubscribe {
  const notifRef = collection(db, 'notifications');
  return onSnapshot(
    notifRef,
    snapshot => {
      const list: AppNotification[] = snapshot.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: String(data.id || d.id),
          title: String(data.title || ''),
          message: String(data.message || ''),
          type: (data.type as 'info' | 'success' | 'warning' | 'broadcast') || 'broadcast',
          createdAt: toIsoString(data.createdAtIso ?? data.createdAt),
          readBy: Array.isArray(data.readBy) ? (data.readBy as string[]) : [],
        };
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    err => {
      handleFirestoreError(err, OperationType.LIST, 'notifications');
    }
  );
}

export async function setOrUpdateWithdrawPinInFirestore(params: {
  uid: string;
  newPin: string;
  currentPin?: string;
}): Promise<{ user: User; message: string }> {
  const { uid, newPin, currentPin = '' } = params;
  if (!isValidFourDigitPin(newPin)) {
    throw new Error('সিকিউরিটি পিন অবশ্যই ৪টি সংখ্যা (০-৯) হতে হবে।');
  }

  const userRef = doc(db, 'users', uid);
  const nowIso = new Date().toISOString();

  try {
    return await runTransaction(db, async tx => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      }

      const rawData = snap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawData, uid);
      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      const hasExisting = typeof rawData.withdrawPinHash === 'string' && rawData.withdrawPinHash.length >= 16;
      if (hasExisting) {
        if (!isValidFourDigitPin(currentPin)) {
          throw new Error('বর্তমান ৪-ডিজিট সিকিউরিটি পিন দিন।');
        }
        const ok = await verifyPinAgainstStoredHash(currentPin, uid, String(rawData.withdrawPinHash));
        if (!ok) {
          throw new Error('বর্তমান ৪-ডিজিট সিকিউরিটি পিনটি সঠিক নয়!');
        }
      }

      const nextHash = await createSaltedPinHash(newPin, uid);
      tx.update(userRef, {
        withdrawPinHash: nextHash,
        withdrawPinUpdatedAt: nowIso,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      const updatedUser: User = {
        ...current,
        hasWithdrawPin: true,
        withdrawPinUpdatedAt: nowIso,
        lastSeen: nowIso,
      };

      return {
        user: updatedUser,
        message: hasExisting
          ? 'আপনার ৪-ডিজিট সিকিউরিটি পিন সফলভাবে পরিবর্তন হয়েছে!'
          : 'আপনার ৪-ডিজিট সিকিউরিটি পিন সফলভাবে সেট হয়েছে!',
      };
    });
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function resetUserWithdrawPinInFirestore(
  targetUserId: string,
  actorEmail: string
): Promise<{ user: User; message: string }> {
  const userRef = doc(db, 'users', targetUserId);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error('ইউজার পাওয়া যায়নি');
    const u = mapDocToUser(snap.data() as Record<string, unknown>, targetUserId);

    await updateDoc(userRef, {
      withdrawPinHash: deleteField(),
      withdrawPinUpdatedAt: deleteField(),
      updatedAt: serverTimestamp(),
    });

    await writeAuditLog(
      'ইউজারের উইথড্র পিন রিসেট',
      actorEmail,
      `${u.name} (${u.email})-এর ৪-ডিজিট উইথড্র সিকিউরিটি পিন রিসেট করা হয়েছে।`
    );

    void dispatchTelegramReceipt({
      eventType: 'admin_system_action',
      title: 'উইথড্র সিকিউরিটি পিন রিসেট',
      detail: '৪-ডিজিট উইথড্র সিকিউরিটি পিন রিসেট করা হয়েছে',
      targetUserId,
    });

    const updatedUser: User = {
      ...u,
      hasWithdrawPin: false,
      withdrawPinUpdatedAt: undefined,
    };

    return {
      user: updatedUser,
      message: `${u.name}-এর উইথড্র সিকিউরিটি পিন রিসেট করা হয়েছে।`,
    };
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

function mapDocToP2PTransfer(raw: Record<string, unknown>, docId: string): P2PTransfer {
  const receiverId = String(raw.receiverId || raw.recipientId || '');
  const status: P2PTransfer['status'] =
    raw.status === 'claimed' ? 'claimed' : raw.status === 'pending' ? 'pending' : 'sent';
  return {
    id: String(raw.id || docId),
    senderId: String(raw.senderId || ''),
    senderName: String(raw.senderName || ''),
    senderEmail: String(raw.senderEmail || ''),
    recipientId: String(raw.recipientId || receiverId),
    receiverId: receiverId || undefined,
    recipientName: String(raw.recipientName || ''),
    recipientEmail: String(raw.recipientEmail || ''),
    amount: roundMoney(Number(raw.amount) || 0),
    fee: roundMoney(Number(raw.fee) || 0),
    totalDeducted: roundMoney(Number(raw.totalDeducted) || 0),
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : undefined,
    status,
    createdAt: toIsoString(raw.createdAtIso ?? raw.createdAt),
    claimedAtIso: typeof raw.claimedAtIso === 'string' ? raw.claimedAtIso : undefined,
  };
}

export async function lookupP2PRecipientByEmail(
  email: string
): Promise<{ uid: string; name: string; email: string } | null> {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) return null;
  try {
    const emailHash = await sha256Hex(cleanEmail);
    const snap = await getDoc(doc(db, 'walletDirectory', emailHash));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      uid: String(data.uid || ''),
      name: String(data.name || cleanEmail.split('@')[0]),
      email: cleanEmail,
    };
  } catch {
    return null;
  }
}

export async function sendP2PTransferTransaction(params: {
  uid: string;
  recipientEmail: string;
  amount: number;
  pin: string;
  note?: string;
}): Promise<{ user: User; transfer: P2PTransfer }> {
  const { uid, recipientEmail, amount, pin, note = '' } = params;
  const cleanEmail = recipientEmail.toLowerCase().trim();
  const cleanAmount = roundMoney(amount);
  const cleanNote = note.trim().slice(0, 200);

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('প্রাপকের সঠিক ইমেইল ঠিকানা লিখুন।');
  }
  if (!Number.isFinite(cleanAmount) || cleanAmount < 10 || cleanAmount > 50000) {
    throw new Error('ট্রান্সফার পরিমাণ ৳১০ থেকে ৳৫০,০০০ এর মধ্যে হতে হবে।');
  }
  if (!isValidFourDigitPin(pin)) {
    throw new Error('সঠিক ৪ সংখ্যার সিকিউরিটি পিন প্রদান করুন।');
  }

  const recipient = await lookupP2PRecipientByEmail(cleanEmail);
  if (!recipient || !recipient.uid) {
    throw new Error('এই ইমেইলে কোনো CaptchaPay অ্যাকাউন্ট পাওয়া যায়নি। প্রাপককে অন্তত একবার সাইন ইন করতে হবে।');
  }
  if (recipient.uid === uid) {
    throw new Error('নিজের অ্যাকাউন্টে P2P ব্যালেন্স পাঠানো যাবে না!');
  }

  const transferId = makeDocId('P2P');
  const userRef = doc(db, 'users', uid);
  const recipientRef = doc(db, 'users', recipient.uid);
  const transferRef = doc(db, 'p2pTransfers', transferId);
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async tx => {
      const userSnap = await tx.get(userRef);
      const settingsSnap = await tx.get(doc(db, 'settings', 'global'));
      if (!userSnap.exists()) throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      const rawData = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawData, uid);

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      const liveSettings = settingsSnap.exists()
        ? normalizeSettings(settingsSnap.data() as Partial<SystemSettings>)
        : getDefaultSettings();
      const p2pCfg = liveSettings.p2pConfig!;
      if (!p2pCfg.enabled) {
        throw new Error('অ্যাডমিন সাময়িকভাবে P2P ব্যালেন্স ট্রান্সফার বন্ধ রেখেছেন।');
      }
      if (cleanAmount < p2pCfg.minAmount || cleanAmount > p2pCfg.maxAmount) {
        throw new Error(`সর্বনিম্ন ৳${p2pCfg.minAmount} এবং সর্বোচ্চ ৳${p2pCfg.maxAmount} ট্রান্সফার করা যাবে।`);
      }

      if (typeof rawData.withdrawPinHash !== 'string' || rawData.withdrawPinHash.length < 16) {
        throw new Error('P2P ট্রান্সফারের আগে ৪-ডিজিট সিকিউরিটি পিন সেট করুন।');
      }
      const pinOk = await verifyPinAgainstStoredHash(pin, uid, rawData.withdrawPinHash);
      if (!pinOk) {
        throw new Error('ভুল ৪-ডিজিট সিকিউরিটি পিন! সঠিক পিন দিয়ে আবার চেষ্টা করুন।');
      }

      const fee = roundMoney((cleanAmount * Math.max(0, p2pCfg.feePercent)) / 100);
      const totalDeducted = roundMoney(cleanAmount + fee);
      if (current.balance < totalDeducted) {
        throw new Error(`আপনার পর্যাপ্ত ব্যালেন্স নেই! (প্রয়োজন: ৳${totalDeducted.toFixed(2)})`);
      }

      const nextBalance = roundMoney(current.balance - totalDeducted);
      tx.update(userRef, {
        balance: nextBalance,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.update(recipientRef, {
        balance: increment(cleanAmount),
        lastClaimedP2pId: transferId,
        updatedAt: serverTimestamp(),
      });

      const payload: Record<string, unknown> = {
        id: transferId,
        senderId: uid,
        senderName: current.name.slice(0, 120),
        senderEmail: current.email.slice(0, 200),
        recipientId: recipient.uid,
        receiverId: recipient.uid,
        recipientName: recipient.name.slice(0, 120),
        recipientEmail: recipient.email.slice(0, 200),
        amount: cleanAmount,
        fee,
        totalDeducted,
        status: 'claimed',
        createdAtIso: nowIso,
        claimedAtIso: nowIso,
        createdAt: serverTimestamp(),
      };
      if (cleanNote) {
        payload.note = cleanNote;
      }
      tx.set(transferRef, payload);

      const transfer: P2PTransfer = {
        id: transferId,
        senderId: uid,
        senderName: current.name,
        senderEmail: current.email,
        recipientId: recipient.uid,
        receiverId: recipient.uid,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        amount: cleanAmount,
        fee,
        totalDeducted,
        note: cleanNote || undefined,
        status: 'claimed',
        createdAt: nowIso,
        claimedAtIso: nowIso,
      };

      return {
        user: { ...current, balance: nextBalance, lastSeen: nowIso },
        transfer,
      };
    });

    void dispatchTelegramReceipt({
      eventType: 'p2p_transfer',
      docId: transferId,
    });

    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `p2pTransfers/${transferId}`);
  }
}

export async function updateUserTelegramBindingInFirestore(params: {
  uid: string;
  chatId: string;
  username?: string;
  prefs: TelegramAlertPrefs;
}): Promise<void> {
  const { uid, chatId, username, prefs } = params;
  const userRef = doc(db, 'users', uid);
  const trimmedChatId = (chatId || '').trim().slice(0, 32);
  const cleanChatId = trimmedChatId === '' || /^-?\d{5,20}$/.test(trimmedChatId) ? trimmedChatId : '';
  const cleanUsername = (username || '').trim().replace(/^@+/, '').slice(0, 64);
  const minAmountNum = Number(prefs?.minAlertAmount);
  const cleanPrefs: TelegramAlertPrefs = {
    p2pReceived: prefs?.p2pReceived !== false,
    p2pSent: prefs?.p2pSent !== false,
    withdrawals: prefs?.withdrawals !== false,
    recharges: prefs?.recharges !== false,
    adjustments: prefs?.adjustments !== false,
    announcements: prefs?.announcements !== false,
    dailyDigest: prefs?.dailyDigest !== false,
    minAlertAmount:
      Number.isFinite(minAmountNum) && minAmountNum >= 0 && minAmountNum <= 50000
        ? Math.round(minAmountNum)
        : 0,
    mutedUntil: typeof prefs?.mutedUntil === 'string' ? prefs.mutedUntil.slice(0, 64) : '',
  };
  try {
    await updateDoc(userRef, {
      telegramChatId: cleanChatId,
      telegramUsername: cleanUsername,
      telegramAlertPrefs: cleanPrefs,
      lastSeen: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function claimIncomingP2PTransfer(
  uid: string,
  transferId: string
): Promise<{ user: User; transfer: P2PTransfer } | null> {
  const userRef = doc(db, 'users', uid);
  const transferRef = doc(db, 'p2pTransfers', transferId);
  const nowIso = new Date().toISOString();

  let stage = 'init';
  let debugMeta: Record<string, unknown> = {
    uid,
    authUid: auth.currentUser?.uid ?? null,
    emailVerified: auth.currentUser?.emailVerified ?? null,
    transferId,
  };

  try {
    return await runTransaction(db, async tx => {
      stage = 'get-transfer';
      const transferSnap = await tx.get(transferRef);
      stage = 'get-user';
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists() || !transferSnap.exists()) return null;

      const tRaw = transferSnap.data() as Record<string, unknown>;
      const t = mapDocToP2PTransfer(tRaw, transferId);
      const isReceiver = t.recipientId === uid || t.receiverId === uid;
      const isPendingClaim = t.status === 'sent' || t.status === 'pending';
      if (!isReceiver || !isPendingClaim) {
        return null;
      }

      const userRaw = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(userRaw, uid);
      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        return null;
      }

      const existingClaimedIds = Array.isArray(userRaw.claimedP2pIds)
        ? userRaw.claimedP2pIds.map(String)
        : [];
      if (existingClaimedIds.includes(transferId)) {
        stage = 'finalize-already-credited-transfer';
        tx.update(transferRef, {
          status: 'claimed',
          claimedAtIso: nowIso,
        });
        return null;
      }

      const rawBalance = typeof userRaw.balance === 'number' && Number.isFinite(userRaw.balance)
        ? userRaw.balance
        : current.balance;
      const nextBalance = roundMoney(rawBalance + t.amount);
      const nextClaimedIds = [...existingClaimedIds, transferId];
      debugMeta = {
        ...debugMeta,
        recipientMatch: isReceiver,
        tStatus: t.status,
        tAmount: t.amount,
        tAmountType: typeof tRaw.amount,
        tCreatedAtType: typeof tRaw.createdAt,
        tKeys: Object.keys(tRaw),
        uKeys: Object.keys(userRaw),
        oldBalance: userRaw.balance ?? null,
        nextBalance,
        existingLastClaimed: userRaw.lastClaimedP2pId ?? null,
        existingClaimedCount: existingClaimedIds.length,
      };

      stage = 'commit-atomic-claim';
      tx.update(transferRef, {
        status: 'claimed',
        claimedAtIso: nowIso,
      });

      tx.update(userRef, {
        balance: nextBalance,
        lastClaimedP2pId: transferId,
        claimedP2pIds: nextClaimedIds,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      return {
        user: {
          ...current,
          balance: nextBalance,
          lastClaimedP2pId: transferId,
          lastSeen: nowIso,
        },
        transfer: {
          ...t,
          status: 'claimed',
          claimedAtIso: nowIso,
        },
      };
    });
  } catch (err) {
    const errCode =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    console.error(
      `Failed to claim incoming P2P transfer [stage=${stage}, code=${errCode}] (users/${uid}, p2pTransfers/${transferId}) meta=${JSON.stringify(debugMeta)}:`,
      err
    );
    return null;
  }
}

export function subscribeToUserP2PTransfers(
  uid: string,
  onData: (transfers: P2PTransfer[]) => void
): Unsubscribe {
  let sentList: P2PTransfer[] = [];
  let receivedList: P2PTransfer[] = [];
  let receiverFieldList: P2PTransfer[] = [];

  const emit = () => {
    const byId = new Map<string, P2PTransfer>();
    for (const item of [...sentList, ...receivedList, ...receiverFieldList]) {
      byId.set(item.id, item);
    }
    const merged = Array.from(byId.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    onData(merged);
  };

  const sentQ = query(collection(db, 'p2pTransfers'), where('senderId', '==', uid));
  const recQ = query(collection(db, 'p2pTransfers'), where('recipientId', '==', uid));
  const receiverQ = query(collection(db, 'p2pTransfers'), where('receiverId', '==', uid));

  const unsubSent = onSnapshot(
    sentQ,
    snap => {
      sentList = snap.docs.map(d => mapDocToP2PTransfer(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'p2pTransfers')
  );

  const unsubRec = onSnapshot(
    recQ,
    snap => {
      receivedList = snap.docs.map(d => mapDocToP2PTransfer(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'p2pTransfers')
  );

  const unsubReceiverField = onSnapshot(
    receiverQ,
    snap => {
      receiverFieldList = snap.docs.map(d => mapDocToP2PTransfer(d.data() as Record<string, unknown>, d.id));
      emit();
    },
    err => handleFirestoreError(err, OperationType.LIST, 'p2pTransfers')
  );

  return () => {
    unsubSent();
    unsubRec();
    unsubReceiverField();
  };
}

function mapDocToUserPlan(raw: Record<string, unknown>, docId: string): UserPlanSubscription {
  return {
    id: String(raw.id || docId),
    userId: String(raw.userId || ''),
    userName: String(raw.userName || ''),
    userEmail: String(raw.userEmail || ''),
    planId: String(raw.planId || ''),
    planName: String(raw.planName || 'ইনকাম প্ল্যান'),
    price: roundMoney(Number(raw.price) || 0),
    dailyIncome: roundMoney(Number(raw.dailyIncome) || 0),
    durationDays: Math.max(1, Math.floor(Number(raw.durationDays) || 30)),
    claimedDays: Math.max(0, Math.floor(Number(raw.claimedDays) || 0)),
    totalClaimedAmount: roundMoney(Number(raw.totalClaimedAmount) || 0),
    lastClaimDate: String(raw.lastClaimDate || ''),
    status: raw.status === 'completed' ? 'completed' : 'active',
    purchasedAtIso: String(raw.purchasedAtIso || toIsoString(raw.createdAt)),
    lastClaimedAtIso: typeof raw.lastClaimedAtIso === 'string' ? raw.lastClaimedAtIso : undefined,
    createdAt: toIsoString(raw.purchasedAtIso ?? raw.createdAt),
  };
}

export function subscribeToUserPlans(
  uid: string,
  onData: (plans: UserPlanSubscription[]) => void
): Unsubscribe {
  const q = query(collection(db, 'userPlans'), where('userId', '==', uid));
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs
        .map(d => mapDocToUserPlan(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(list);
    },
    err => handleFirestoreError(err, OperationType.LIST, 'userPlans')
  );
}

export async function purchaseEarningPlanTransaction(params: {
  uid: string;
  plan: EarningPlan;
}): Promise<{ user: User; subscription: UserPlanSubscription; message: string }> {
  const { uid, plan } = params;
  const subId = makeDocId('PLN');
  const userRef = doc(db, 'users', uid);
  const subRef = doc(db, 'userPlans', subId);
  const settingsRef = doc(db, 'settings', 'global');
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async tx => {
      const [userSnap, settingsSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(settingsRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      }

      const rawUser = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawUser, uid);

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      const liveSettings = settingsSnap.exists()
        ? normalizeSettings(settingsSnap.data() as Partial<SystemSettings>)
        : getDefaultSettings();

      const livePlans = liveSettings.earningPlans || [];
      const authoritativePlan = livePlans.find(p => p.id === plan.id) || plan;

      if (!authoritativePlan.enabled) {
        throw new Error('এই প্ল্যানটি বর্তমানে অ্যাডমিন দ্বারা বন্ধ রয়েছে।');
      }

      const price = Math.max(10, roundMoney(authoritativePlan.price));
      const dailyIncome = Math.max(1, roundMoney(authoritativePlan.dailyIncome));
      const durationDays = Math.max(1, Math.floor(authoritativePlan.durationDays));

      const rawBalance =
        typeof rawUser.balance === 'number' && Number.isFinite(rawUser.balance)
          ? rawUser.balance
          : current.balance;

      if (rawBalance < price) {
        throw new Error(
          `পর্যাপ্ত ব্যালেন্স নেই! এই প্ল্যানটি কিনতে ৳${price} প্রয়োজন (আপনার ব্যালেন্স: ৳${rawBalance.toFixed(2)})।`
        );
      }

      const nextBalance = roundMoney(rawBalance - price);
      const cleanPlanId = String(authoritativePlan.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'plan-1';
      const cleanPlanName = String(authoritativePlan.name || 'ইনকাম প্ল্যান').slice(0, 120);

      tx.update(userRef, {
        balance: nextBalance,
        lastPlanSubId: subId,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      tx.set(subRef, {
        id: subId,
        userId: uid,
        userName: current.name.slice(0, 120),
        userEmail: current.email.slice(0, 200),
        planId: cleanPlanId,
        planName: cleanPlanName,
        price,
        dailyIncome,
        durationDays,
        claimedDays: 0,
        totalClaimedAmount: 0,
        lastClaimDate: '',
        status: 'active',
        purchasedAtIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const subscription: UserPlanSubscription = {
        id: subId,
        userId: uid,
        userName: current.name,
        userEmail: current.email,
        planId: cleanPlanId,
        planName: cleanPlanName,
        price,
        dailyIncome,
        durationDays,
        claimedDays: 0,
        totalClaimedAmount: 0,
        lastClaimDate: '',
        status: 'active',
        purchasedAtIso: nowIso,
        createdAt: nowIso,
      };

      return {
        user: { ...current, balance: nextBalance, lastSeen: nowIso },
        subscription,
        message: `অভিনন্দন! "${cleanPlanName}" (৳${price}) সফলভাবে কেনা হয়েছে! এখন থেকেই প্রতিদিন ৳${dailyIncome} ক্লেইম করতে পারবেন।`,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.WRITE, `userPlans/${subId}`);
  }
}

export async function claimPlanDailyIncomeTransaction(params: {
  uid: string;
  subId: string;
}): Promise<{ user: User; subscription: UserPlanSubscription; reward: number; message: string }> {
  const { uid, subId } = params;
  const userRef = doc(db, 'users', uid);
  const subRef = doc(db, 'userPlans', subId);
  const settingsRef = doc(db, 'settings', 'global');
  const nowIso = new Date().toISOString();
  const todayDhaka = getDhakaDateKey();

  try {
    const result = await runTransaction(db, async tx => {
      const [userSnap, subSnap, settingsSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(subRef),
        tx.get(settingsRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error('ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি।');
      }
      if (!subSnap.exists()) {
        throw new Error('প্ল্যান সাবস্ক্রিপশন পাওয়া যায়নি।');
      }

      const rawUser = userSnap.data() as Record<string, unknown>;
      const current = mapDocToUser(rawUser, uid);

      if (current.isBanned && !isAuthorizedAdminEmail(current.email)) {
        throw new Error('আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে!');
      }

      const sub = mapDocToUserPlan(subSnap.data() as Record<string, unknown>, subId);
      if (sub.userId !== uid) {
        throw new Error('এই প্ল্যানটি আপনার অ্যাকাউন্টের নয়।');
      }
      if (sub.status !== 'active' || sub.claimedDays >= sub.durationDays) {
        throw new Error('এই প্ল্যানটির মেয়াদ ইতিমধ্যেই সম্পন্ন হয়েছে।');
      }
      if (sub.lastClaimDate === todayDhaka) {
        throw new Error('আপনি আজ ইতিমধ্যেই এই প্ল্যানের ডেইলি ইনকাম ক্লেইম করেছেন! আগামীকাল আবার ক্লেইম করতে পারবেন।');
      }

      const liveSettings = settingsSnap.exists()
        ? normalizeSettings(settingsSnap.data() as Partial<SystemSettings>)
        : getDefaultSettings();

      const livePlan = (liveSettings.earningPlans || []).find(p => p.id === sub.planId);
      const effectiveDailyIncome = livePlan
        ? Math.max(1, Math.min(50000, roundMoney(livePlan.dailyIncome)))
        : Math.max(1, Math.min(50000, roundMoney(sub.dailyIncome)));

      const nextClaimedDays = sub.claimedDays + 1;
      const nextStatus: 'active' | 'completed' =
        nextClaimedDays >= sub.durationDays ? 'completed' : 'active';
      const nextTotalClaimed = roundMoney(sub.totalClaimedAmount + effectiveDailyIncome);

      const rawBalance =
        typeof rawUser.balance === 'number' && Number.isFinite(rawUser.balance)
          ? rawUser.balance
          : current.balance;
      const rawTotalEarned =
        typeof rawUser.totalEarned === 'number' && Number.isFinite(rawUser.totalEarned)
          ? rawUser.totalEarned
          : current.totalEarned;
      const rawTotalPlanEarned =
        typeof rawUser.totalPlanEarned === 'number' && Number.isFinite(rawUser.totalPlanEarned)
          ? rawUser.totalPlanEarned
          : current.totalPlanEarned || 0;

      const nextBalance = roundMoney(rawBalance + effectiveDailyIncome);
      const nextTotalEarned = roundMoney(rawTotalEarned + effectiveDailyIncome);
      const nextTotalPlanEarned = roundMoney(rawTotalPlanEarned + effectiveDailyIncome);

      tx.update(subRef, {
        claimedDays: nextClaimedDays,
        totalClaimedAmount: nextTotalClaimed,
        lastClaimDate: todayDhaka,
        lastClaimedAtIso: nowIso,
        dailyIncome: effectiveDailyIncome,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      tx.update(userRef, {
        balance: nextBalance,
        totalEarned: nextTotalEarned,
        totalPlanEarned: nextTotalPlanEarned,
        lastPlanSubId: subId,
        lastSeen: nowIso,
        updatedAt: serverTimestamp(),
      });

      const updatedSub: UserPlanSubscription = {
        ...sub,
        claimedDays: nextClaimedDays,
        totalClaimedAmount: nextTotalClaimed,
        lastClaimDate: todayDhaka,
        lastClaimedAtIso: nowIso,
        dailyIncome: effectiveDailyIncome,
        status: nextStatus,
      };

      return {
        user: {
          ...current,
          balance: nextBalance,
          totalEarned: nextTotalEarned,
          totalPlanEarned: nextTotalPlanEarned,
          lastSeen: nowIso,
        },
        subscription: updatedSub,
        reward: effectiveDailyIncome,
        message: `সফল ক্লেইম! "${sub.planName}" থেকে আজকের ৳${effectiveDailyIncome.toFixed(2)} আপনার ব্যালেন্সে যোগ হয়েছে (${nextClaimedDays}/${sub.durationDays} দিন)।`,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof Error && !('code' in err)) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `userPlans/${subId}`);
  }
}



