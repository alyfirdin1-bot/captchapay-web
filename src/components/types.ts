export type UserRole = 'admin' | 'user';

export type VipTier = 'free' | 'silver' | 'gold' | 'diamond';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
  balance: number; // in BDT ৳
  totalEarned: number;
  totalWithdrawn: number;
  totalRecharged: number;
  captchasSolvedToday: number;
  solvedTodayByType?: Record<CaptchaType, number>;
  lastSolvedAtByType?: Partial<Record<CaptchaType, number>>;
  totalCaptchasSolved: number;
  videosWatchedToday?: number;
  totalVideosWatched?: number;
  totalAdClicks?: number;
  incompleteAdsCount?: number;
  totalAdEarned?: number;
  lastAdWatchedAt?: number;
  completedAdIds?: string[];
  vipTier: VipTier;
  customDailyLimit?: number;
  isBanned: boolean;
  joinedAt: string;
  lastLogin: string;
  lastSeen?: string;
  isOnline?: boolean;
  referralCode?: string;
  referredBy?: string;
  totalReferralEarned?: number;
  lastCheckInDate?: string;
  checkInStreak?: number;
  hasWithdrawPin?: boolean;
  withdrawPinUpdatedAt?: string;
  lastClaimedP2pId?: string;
  lastPlanSubId?: string;
  totalPlanEarned?: number;
  telegramChatId?: string;
  telegramUsername?: string;
  telegramAlertPrefs?: TelegramAlertPrefs;
}

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

export interface TelegramBotStatus {
  botConfigured: boolean;
  envManaged?: boolean;
  botUsername: string;
  botName: string;
  pollingActive: boolean;
  linked: boolean;
  chatId: string;
  username: string;
  prefs: TelegramAlertPrefs;
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

export type PaymentMethod = 'Mobile Recharge' | 'bKash' | 'Nagad' | 'Rocket' | 'Binance USDT' | 'Bank Transfer';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface RechargeRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  method: PaymentMethod;
  senderNumber: string;
  senderSim?: string;
  trxId: string;
  status: RequestStatus;
  adminNote?: string;
  createdAt: string;
  processedAt?: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  method: PaymentMethod;
  accountNumber: string;
  accountType: 'personal' | 'agent';
  status: RequestStatus;
  payoutTrxId?: string;
  adminNote?: string;
  createdAt: string;
  processedAt?: string;
}

export type CaptchaType = 'text' | 'math' | 'image_grid' | 'slider';

export interface CaptchaTypeConfig {
  enabled: boolean;
  reward: number;
  dailyLimit: number;
  timeLimitSeconds: number;
  cooldownSeconds: number;
}

export interface AdSectionConfig {
  enabled: boolean;
  reward: number;
  minWatchSeconds: number;
  dailyLimit: number;
  cooldownSeconds: number;
}

export interface VideoAdItem {
  id: string;
  title: string;
  url: string;
  enabled: boolean;
  reward?: number;
  minWatchSeconds?: number;
  totalCompletedViews?: number;
  totalIncompleteViews?: number;
  totalClicks?: number;
  createdAt: string;
}

export interface AdWatchLog {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  adId: string;
  adTitle: string;
  adUrl: string;
  status: 'completed' | 'incomplete';
  reviewStatus?: 'in_review' | 'reviewed';
  watchedSeconds: number;
  requiredSeconds: number;
  earned: number;
  createdAt: string;
}

export interface CaptchaChallenge {
  id: string;
  type: CaptchaType;
  question: string;
  expression?: string;
  solution: string; // hashed or plain text solution
  options?: string[]; // for grid or multi-choice
  correctIndices?: number[]; // for image grid
  reward: number; // BDT ৳
  timeLimitSeconds: number;
  hint?: string;
  noiseLevel?: 'low' | 'medium' | 'high';
}

export interface P2PConfig {
  enabled: boolean;
  minAmount: number;
  maxAmount: number;
  feePercent: number;
}

export interface WithdrawalScheduleConfig {
  enabled: boolean;
  startTime: string; // HH:mm in Bangladesh Time (Asia/Dhaka)
  endTime: string;   // HH:mm in Bangladesh Time (Asia/Dhaka)
  closedDays: number[]; // 0 = Sun ... 5 = Fri, 6 = Sat
  holidayMode: boolean;
  holidayMessage: string;
}

export interface P2PTransfer {
  id: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  recipientId: string;
  receiverId?: string;
  recipientName: string;
  recipientEmail: string;
  amount: number;
  fee: number;
  totalDeducted: number;
  note?: string;
  status: 'pending' | 'sent' | 'claimed';
  createdAt: string;
  claimedAtIso?: string;
}

export interface PaymentMethodConfig {
  number: string;
  accountType: 'Personal' | 'Agent' | 'Merchant';
  actionType: 'Send Money' | 'Cash In' | 'Payment' | 'Deposit';
  enabled: boolean;
  logoUrl?: string;
}

export type PlanThemeColor = 'emerald' | 'amber' | 'rose' | 'cyan' | 'purple';

export interface EarningPlan {
  id: string;
  name: string;
  price: number;
  dailyIncome: number;
  durationDays: number;
  badge?: string;
  description?: string;
  color?: PlanThemeColor;
  enabled: boolean;
  sortOrder?: number;
  createdAt?: string;
}

export interface UserPlanSubscription {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  planId: string;
  planName: string;
  price: number;
  dailyIncome: number;
  durationDays: number;
  claimedDays: number;
  totalClaimedAmount: number;
  lastClaimDate: string;
  status: 'active' | 'completed';
  purchasedAtIso: string;
  lastClaimedAtIso?: string;
  createdAt: string;
}

export interface SystemSettings {
  adminEmail: string;
  minWithdrawal: number;
  rewardPerText: number;
  rewardPerMath: number;
  rewardPerGrid: number;
  rewardPerSlider: number;
  dailyFreeLimit: number;
  dailySilverLimit?: number;
  dailyGoldLimit?: number;
  dailyDiamondLimit?: number;
  useVipMultiplier?: boolean;
  captchaConfigs?: Record<CaptchaType, CaptchaTypeConfig>;
  adConfig?: AdSectionConfig;
  videoAds?: VideoAdItem[];
  earningPlans?: EarningPlan[];
  p2pConfig?: P2PConfig;
  withdrawalSchedule?: WithdrawalScheduleConfig;
  paymentNumbers: {
    bkash: PaymentMethodConfig | string;
    nagad: PaymentMethodConfig | string;
    rocket: PaymentMethodConfig | string;
    binance: PaymentMethodConfig | string;
    bankName: string;
    bankAccount: string;
    [key: string]: any;
  };
  operatorLogos?: {
    Grameenphone?: string;
    Banglalink?: string;
    Robi?: string;
    Airtel?: string;
    Teletalk?: string;
    [key: string]: string | undefined;
  };
  notice: string;
  isMaintenance: boolean;
  announcements?: {
    id: string;
    title: string;
    body: string;
    createdAt: string;
  }[];
}

export interface TierInfo {
  tier: VipTier;
  nameEn: string;
  nameBn: string;
  price: number;
  dailyLimit: number;
  rateMultiplier: number;
  ratePerCaptcha: number;
  featuresBn: string[];
  featuresEn: string[];
  popular?: boolean;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  action: string;
  actorEmail: string;
  details: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: 'open' | 'answered' | 'closed';
  adminReply?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'broadcast';
  targetUserId?: string;
  createdAt: string;
  readBy?: string[];
}
