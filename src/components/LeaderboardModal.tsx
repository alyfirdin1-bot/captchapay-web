import React, { useState, useEffect } from 'react';
import { Trophy, X, Crown, Award, Coins } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import type { User } from '../types';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({ isOpen, onClose }) => {
  const [topUsers, setTopUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const fetchTopUsers = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'users'), orderBy('totalEarned', 'desc'), limit(15));
        const snap = await getDocs(q);
        const users = snap.docs.map(d => {
          const raw = d.data();
          return {
            id: d.id,
            name: String(raw.name || 'User'),
            email: String(raw.email || ''),
            avatar: String(raw.avatar || ''),
            totalEarned: Number(raw.totalEarned) || 0,
            vipTier: raw.vipTier || 'free',
            totalCaptchasSolved: Number(raw.totalCaptchasSolved) || 0,
          } as User;
        });
        setTopUsers(users);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'users');
      } finally {
        setLoading(false);
      }
    };
    fetchTopUsers();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="max-w-md w-full rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-2 rounded-full bg-slate-800/60 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">টপ আর্নার্স লিডারবোর্ড</h2>
            <p className="text-xs text-slate-400">সবচেয়ে বেশি আয়কারী সেরা উপার্জনকারীগণ</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-xs text-slate-400">লিডারবোর্ড লোড হচ্ছে...</div>
        ) : topUsers.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500">কোনো ইউজার পাওয়া যায়নি।</div>
        ) : (
          <div className="space-y-3">
            {topUsers.map((u, idx) => {
              const rank = idx + 1;
              const isTop3 = rank <= 3;
              return (
                <div
                  key={u.id}
                  className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                    rank === 1
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-200 shadow-lg'
                      : rank === 2
                      ? 'bg-slate-300/10 border-slate-300/30 text-slate-200'
                      : rank === 3
                      ? 'bg-amber-700/10 border-amber-700/35 text-amber-300'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                        rank === 1
                          ? 'bg-amber-500 text-slate-950 shadow-md'
                          : rank === 2
                          ? 'bg-slate-300 text-slate-950'
                          : rank === 3
                          ? 'bg-amber-700 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {rank === 1 ? <Crown className="w-4 h-4" /> : rank}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={u.avatar}
                        alt={u.name}
                        className="w-9 h-9 rounded-full bg-slate-800 object-cover border border-slate-700"
                      />
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>{u.name}</span>
                          {u.vipTier !== 'free' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {u.vipTier}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {u.totalCaptchasSolved || 0} টি ক্যাপচা সমাধান
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-black font-mono text-emerald-400 flex items-center justify-end gap-1">
                      <span>৳{u.totalEarned.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
