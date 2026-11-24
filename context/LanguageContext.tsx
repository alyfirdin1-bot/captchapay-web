import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'bn' | 'en';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  bn: {
    siteName: 'CaptchaPay',
    siteTagline: 'ক্যাপচা সমাধান করে সহজে আয় করুন',
    navHome: 'হোম',
    navSolve: 'ক্যাপচা সমাধান',
    navRecharge: 'রিচার্জ',
    navWithdraw: 'উইথড্র',
    navHistory: 'হিস্ট্রি',
    navVip: 'ভিআইপি প্যাকেজ',
    navAdmin: 'অ্যাডমিন প্যানেল',
    loginWithGoogle: 'গুগল দিয়ে লগইন',
    logout: 'লগআউট',
    welcomeBack: 'স্বাগতম',
    adminBadge: 'অ্যাডমিন',
    userBadge: 'মেম্বার',
    balance: 'ব্যালেন্স',
    totalEarned: 'মোট আয়',
    totalWithdrawn: 'মোট উত্তোলন',
    todaySolved: 'আজকের সমাধান',
    solveNow: 'এখনই ক্যাপচা শুরু করুন',
    quickRecharge: 'রিচার্জ করুন',
    quickWithdraw: 'টাকা তুলুন',
    enterAdmin: 'অ্যাডমিন ড্যাশবোর্ড',
  },
  en: {
    siteName: 'CaptchaPay',
    siteTagline: 'Earn Money by Solving Captchas',
    navHome: 'Home',
    navSolve: 'Solve Captcha',
    navRecharge: 'Recharge',
    navWithdraw: 'Withdraw',
    navHistory: 'History',
    navVip: 'VIP Packages',
    navAdmin: 'Admin Panel',
    loginWithGoogle: 'Sign in with Google',
    logout: 'Sign Out',
    welcomeBack: 'Welcome back',
    adminBadge: 'Admin',
    userBadge: 'Member',
    balance: 'Balance',
    totalEarned: 'Total Earned',
    totalWithdrawn: 'Total Withdrawn',
    todaySolved: 'Solved Today',
    solveNow: 'Start Solving Now',
    quickRecharge: 'Recharge Balance',
    quickWithdraw: 'Withdraw Money',
    enterAdmin: 'Admin Dashboard',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    return (localStorage.getItem('captchapay_lang') as Language) || 'bn';
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('captchapay_lang', newLang);
  };

  const toggleLang = () => {
    setLang(lang === 'bn' ? 'en' : 'bn');
  };

  const t = (key: string): string => {
    return translations[lang][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
