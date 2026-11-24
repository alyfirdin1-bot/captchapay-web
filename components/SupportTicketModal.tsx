import React, { useState, useEffect } from 'react';
import { HelpCircle, Send, X, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';

interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: 'open' | 'resolved';
  adminReply?: string;
  createdAt: string;
}

interface SupportTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupportTicketModal: React.FC<SupportTicketModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const userId = user?.id || '';

  useEffect(() => {
    if (!isOpen || !userId) return;
    const q = query(collection(db, 'supportTickets'), where('userId', '==', userId));
    const unsub = onSnapshot(
      q,
      snap => {
        const list = snap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          const createdRaw = data.createdAtIso ?? data.createdAt;
          const createdAt =
            typeof createdRaw === 'string'
              ? createdRaw
              : createdRaw && typeof createdRaw === 'object' && 'toDate' in createdRaw && typeof (createdRaw as { toDate: () => Date }).toDate === 'function'
              ? (createdRaw as { toDate: () => Date }).toDate().toISOString()
              : new Date().toISOString();
          return {
            id: String(data.id || d.id),
            userId: String(data.userId || ''),
            userName: String(data.userName || ''),
            userEmail: String(data.userEmail || ''),
            subject: String(data.subject || ''),
            message: String(data.message || ''),
            status: (data.status === 'resolved' || data.status === 'answered' || data.status === 'closed'
              ? 'resolved'
              : 'open') as 'open' | 'resolved',
            adminReply: typeof data.adminReply === 'string' ? data.adminReply : undefined,
            createdAt,
          };
        });
        setTickets(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      },
      err => handleFirestoreError(err, OperationType.LIST, 'supportTickets')
    );
    return () => unsub();
  }, [isOpen, userId]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setErrorMsg('বিষয় ও বার্তা উভয়ই লিখুন।');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).slice(0, 6)}`;
    const ticketRef = doc(db, 'supportTickets', ticketId);
    const nowIso = new Date().toISOString();

    try {
      await setDoc(ticketRef, {
        id: ticketId,
        userId: user.id,
        userName: user.name.slice(0, 120),
        userEmail: user.email.slice(0, 200),
        subject: subject.trim().slice(0, 150),
        message: message.trim().slice(0, 1000),
        status: 'open',
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg('আপনার সাপোর্ট টিকিট সফলভাবে জমা হয়েছে। অ্যাডমিন শীঘ্রই উত্তর দেবেন।');
      setSubject('');
      setMessage('');
    } catch (err) {
      setErrorMsg('টিকিট জমা দিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="max-w-2xl w-full rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white p-2 rounded-full bg-slate-800/60 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <HelpCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">সাপোর্ট টিকিট ও হেল্প ডেস্ক</h2>
            <p className="text-xs text-slate-400">
              পেমেন্ট বা অ্যাকাউন্ট সংক্রান্ত যে কোনো সমস্যায় টিকিট ওপেন করুন
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* New Ticket Form */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-slate-950/60 p-4 sm:p-5 rounded-2xl border border-slate-800/80">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>নতুন সমস্যা বা অভিযোগ জানান</span>
          </h3>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">সমস্যার বিষয় (Subject)</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="যেমন: উইথড্র টাকা এখনো পাইনি"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">বিস্তারিত বিবরণ (Message)</label>
            <textarea
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="আপনার সমস্যাটি বিস্তারিত লিখুন (সাথে TrxID বা অ্যাকাউন্ট নাম্বার দিলে দ্রুত সমাধান হবে)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmitting ? 'জমা হচ্ছে...' : 'সাপোর্ট টিকিট সাবমিট করুন'}</span>
          </button>
        </form>

        {/* Previous Tickets */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">আপনার জমাকৃত টিকিটসমূহ</h3>
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 bg-slate-950/40 rounded-2xl border border-slate-800/60">
              কোনো সাপোর্ট টিকিট নেই।
            </div>
          ) : (
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {tickets.map(ticket => (
                <div key={ticket.id} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">{ticket.subject}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        ticket.status === 'resolved'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {ticket.status === 'resolved' ? 'সমাধানকৃত' : 'পেন্ডিং / প্রসেসিং'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{ticket.message}</p>
                  {ticket.adminReply && (
                    <div className="mt-2 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200">
                      <strong className="text-emerald-400 block mb-0.5">অ্যাডমিনের উত্তর:</strong>
                      {ticket.adminReply}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 flex items-center gap-1 pt-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(ticket.createdAt).toLocaleString('bn-BD')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
