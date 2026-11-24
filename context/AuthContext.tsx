import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { isAuthorizedAdminEmail, getDefaultSettings } from '../lib/defaults';
import {
  subscribeToSettings,
  subscribeToUserProfile,
  touchUserPresence,
  upsertUserOnSignIn,
  claimIncomingP2PTransfer,
  subscribeToUserP2PTransfers,
  processRechargeTransaction,
} from '../lib/dbService';
import { hydrateAdminTelegramVault, syncTelegramBindingToServer } from '../lib/telegramService';
import {
  hydrateAdminSmsGatewayVault,
  fetchPendingAutoApprovals,
  markDepositAutoApproved,
} from '../lib/smsGatewayService';
import type { User, SystemSettings } from '../types';

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  isLoading: boolean;
  settings: SystemSettings | null;
  toasts: ToastMessage[];
  loginWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  applySettings: (newSettings: SystemSettings) => void;
  applyUser: (updatedUser: User) => void;
  adminEventTick: number;
  transactionEventTick: number;
  onlineEmails: string[];
  presenceUpdate: { email: string; isOnline: boolean; lastSeen?: string } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [settings, setSettings] = useState<SystemSettings | null>(() => getDefaultSettings());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  const profileUnsubRef = useRef<(() => void) | null>(null);
  const settingsUnsubRef = useRef<(() => void) | null>(null);
  const signedInUidRef = useRef<string | null>(null);
  const claimingP2pIdsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const applySettings = useCallback((newSettings: SystemSettings) => {
    setSettings(newSettings);
  }, []);

  const applyUser = useCallback((updatedUser: User) => {
    const normalized: User = { ...updatedUser };
    if (isAuthorizedAdminEmail(normalized.email)) {
      normalized.role = 'admin';
    }
    setUser(prev => {
      if (!prev) return normalized;
      if (prev.id === normalized.id || prev.email.toLowerCase().trim() === normalized.email.toLowerCase().trim()) {
        return normalized;
      }
      return prev;
    });
  }, []);

  const refreshSettings = useCallback(async () => {
    // Settings stay synced in real time via Cloud Firestore onSnapshot
  }, []);

  const refreshUser = useCallback(async () => {
    const currentFbUser = auth.currentUser;
    if (!currentFbUser) return;
    try {
      await touchUserPresence(currentFbUser.uid);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async fbUser => {
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }
      if (settingsUnsubRef.current) {
        settingsUnsubRef.current();
        settingsUnsubRef.current = null;
      }

      if (!fbUser) {
        signedInUidRef.current = null;
        setUser(null);
        setSettings(getDefaultSettings());
        setIsLoading(false);
        return;
      }

      signedInUidRef.current = fbUser.uid;
      setIsLoading(true);
      try {
        settingsUnsubRef.current = subscribeToSettings(
          liveSettings => {
            setSettings(liveSettings);
          },
          err => {
            console.error('Settings listener error:', err);
          }
        );

        const syncedUser = await upsertUserOnSignIn(fbUser);
        if (signedInUidRef.current !== fbUser.uid) return;
        setUser(syncedUser);

        profileUnsubRef.current = subscribeToUserProfile(
          fbUser.uid,
          liveUser => {
            if (liveUser) {
              setUser(liveUser);
            }
          },
          err => {
            console.error('User profile listener error:', err);
          }
        );
      } catch (err) {
        console.error('Auth initialization error:', err);
        showToast('ক্লাউড ডেটাবেসে সংযোগ করতে সমস্যা হয়েছে, আবার চেষ্টা করুন।', 'error');
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (profileUnsubRef.current) profileUnsubRef.current();
      if (settingsUnsubRef.current) settingsUnsubRef.current();
    };
  }, [showToast]);

  // 30s presence heartbeat while signed in
  useEffect(() => {
    if (!user?.id || user.isBanned) return;
    const interval = setInterval(() => {
      void touchUserPresence(user.id);
    }, 30_000);
    return () => clearInterval(interval);
  }, [user?.id, user?.isBanned]);

  // Auto-restore encrypted Telegram Bot & Channel Bot config from Cloud Firestore Vault on admin login
  const hydratedAdminUidRef = useRef<string | null>(null);
  const processingAutoApprovalIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.id || !isAuthorizedAdminEmail(user.email)) {
      if (!user?.id) {
        hydratedAdminUidRef.current = null;
      }
      return;
    }
    if (hydratedAdminUidRef.current === user.id) return;
    hydratedAdminUidRef.current = user.id;
    void hydrateAdminTelegramVault();
    void hydrateAdminSmsGatewayVault();
  }, [user?.id, user?.email]);

  // Auto-process SMS Gateway verified deposits in Firestore whenever Admin session is active
  useEffect(() => {
    if (!user?.id || !isAuthorizedAdminEmail(user.email)) return;
    let cancelled = false;

    const runAutoApprovals = async () => {
      try {
        const items = await fetchPendingAutoApprovals();
        for (const item of items) {
          if (cancelled || processingAutoApprovalIdsRef.current.has(item.rechargeId)) continue;
          processingAutoApprovalIdsRef.current.add(item.rechargeId);
          try {
            await processRechargeTransaction({
              rechargeId: item.rechargeId,
              action: 'approve',
              adminNote: `SMS Gateway ২-সেকেন্ড অটো-ভেরিফাইড (${item.trxId})`,
              actorEmail: user.email,
            });
            await markDepositAutoApproved(item.rechargeId);
            showToast(`SMS অটো-ভেরিফাই: ৳${item.amount} (${item.trxId}) অনুমোদিত হয়েছে!`, 'success');
          } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('ইতিমধ্যেই প্রসেস') || msg.includes('পাওয়া যায়নি')) {
              await markDepositAutoApproved(item.rechargeId).catch(() => {});
            }
          } finally {
            processingAutoApprovalIdsRef.current.delete(item.rechargeId);
          }
        }
      } catch {
        // Silent background check
      }
    };

    void runAutoApprovals();
    const timer = setInterval(() => {
      void runAutoApprovals();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.id, user?.email, showToast]);

  // Keep server Telegram cache & live wallet snapshot synced for bot commands (/balance, /stats, /digest)
  useEffect(() => {
    const chatId = (user?.telegramChatId || '').trim();
    if (!user?.id || !/^-?\d{5,20}$/.test(chatId)) return;
    void syncTelegramBindingToServer({
      chatId,
      username: user.telegramUsername,
      prefs: user.telegramAlertPrefs,
      snapshot: {
        balance: user.balance,
        totalEarned: user.totalEarned,
        totalWithdrawn: user.totalWithdrawn,
        totalRecharged: user.totalRecharged,
        vipTier: user.vipTier,
        captchasSolvedToday: user.captchasSolvedToday,
        totalCaptchasSolved: user.totalCaptchasSolved,
        videosWatchedToday: user.videosWatchedToday || 0,
        totalAdEarned: user.totalAdEarned || 0,
        referralCode: user.referralCode,
      },
    });
  }, [
    user?.id,
    user?.telegramChatId,
    user?.telegramUsername,
    user?.telegramAlertPrefs,
    user?.balance,
    user?.totalEarned,
    user?.totalWithdrawn,
    user?.totalRecharged,
    user?.vipTier,
    user?.captchasSolvedToday,
    user?.totalCaptchasSolved,
    user?.videosWatchedToday,
    user?.totalAdEarned,
    user?.referralCode,
  ]);

  const notifiedP2pIdsRef = useRef<Set<string>>(new Set());
  const p2pInitialLoadRef = useRef<boolean>(true);

  // Notify recipient on new instant incoming P2P transfers & silently settle any legacy pending ones
  useEffect(() => {
    if (!user?.id || user.isBanned) {
      if (!user?.id) {
        claimingP2pIdsRef.current.clear();
        notifiedP2pIdsRef.current.clear();
        p2pInitialLoadRef.current = true;
      }
      return;
    }

    const uid = user.id;
    p2pInitialLoadRef.current = true;
    const unsubP2p = subscribeToUserP2PTransfers(uid, async transfers => {
      const isInitialSnapshot = p2pInitialLoadRef.current;
      p2pInitialLoadRef.current = false;

      for (const t of transfers) {
        const isReceiver = t.recipientId === uid || t.receiverId === uid;
        if (!isReceiver) continue;

        if (t.status === 'claimed') {
          if (isInitialSnapshot) {
            const ageMs = Date.now() - new Date(t.claimedAtIso || t.createdAt).getTime();
            if (ageMs <= 15_000 && !notifiedP2pIdsRef.current.has(t.id)) {
              notifiedP2pIdsRef.current.add(t.id);
              showToast(
                `আপনি ${t.senderName} থেকে ৳${t.amount.toFixed(2)} P2P ব্যালেন্স পেয়েছেন!`,
                'success'
              );
            } else {
              notifiedP2pIdsRef.current.add(t.id);
            }
          } else if (!notifiedP2pIdsRef.current.has(t.id)) {
            notifiedP2pIdsRef.current.add(t.id);
            showToast(
              `আপনি ${t.senderName} থেকে ৳${t.amount.toFixed(2)} P2P ব্যালেন্স পেয়েছেন!`,
              'success'
            );
          }
          continue;
        }

        const isLegacyPending = t.status === 'sent' || t.status === 'pending';
        if (isLegacyPending && !claimingP2pIdsRef.current.has(t.id)) {
          claimingP2pIdsRef.current.add(t.id);
          const res = await claimIncomingP2PTransfer(uid, t.id);
          if (res) {
            notifiedP2pIdsRef.current.add(t.id);
            applyUser(res.user);
            showToast(
              `আপনি ${res.transfer.senderName} থেকে ৳${res.transfer.amount.toFixed(2)} P2P ব্যালেন্স পেয়েছেন!`,
              'success'
            );
          }
        }
      }
    });

    return () => {
      unsubP2p();
    };
  }, [user?.id, user?.isBanned, applyUser, showToast]);

  const loginWithGoogle = async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const fbUser = cred.user;
      const loggedInUser = await upsertUserOnSignIn(fbUser);
      setUser(loggedInUser);
      setIsLoginModalOpen(false);

      if (loggedInUser.role === 'admin') {
        showToast(`স্বাগতম অ্যাডমিন ${loggedInUser.name}! আপনার অ্যাডমিন প্যানেল সক্রিয় হয়েছে।`, 'success');
      } else {
        showToast(`স্বাগতম ${loggedInUser.name}! আপনার অ্যাকাউন্টে সফলভাবে প্রবেশ করেছেন।`, 'success');
      }
      return true;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        showToast('গুগল সাইন-ইন বাতিল করা হয়েছে', 'info');
      } else if (code === 'auth/popup-blocked') {
        showToast('ব্রাউজার পপ-আপ ব্লক করেছে! অনুগ্রহ করে পপ-আপ চালু করে আবার চেষ্টা করুন।', 'error');
      } else {
        console.error('Google Sign-In error:', err);
        showToast('গুগল দিয়ে সাইন ইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।', 'error');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      showToast('সফলভাবে লগআউট হয়েছেন', 'info');
    } catch (err) {
      console.error('Logout error:', err);
      showToast('লগআউট করতে সমস্যা হয়েছে', 'error');
    }
  };

  const isAdmin = Boolean(
    user && isAuthorizedAdminEmail(user.email)
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        isLoading,
        settings,
        toasts,
        loginWithGoogle,
        logout,
        refreshUser,
        refreshSettings,
        applySettings,
        applyUser,
        adminEventTick: 0,
        transactionEventTick: 0,
        onlineEmails: [],
        presenceUpdate: null,
        showToast,
        removeToast,
        isLoginModalOpen,
        setIsLoginModalOpen,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
