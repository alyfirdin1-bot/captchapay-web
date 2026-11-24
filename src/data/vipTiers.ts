import { TierInfo } from '../types';

export const VIP_TIERS: TierInfo[] = [
  {
    tier: 'free',
    nameEn: 'Free Starter',
    nameBn: 'ফ্রি স্টার্টার',
    price: 0,
    dailyLimit: 25,
    rateMultiplier: 1.0,
    ratePerCaptcha: 2.5,
    featuresBn: [
      'দৈনিক নির্ধারিত ফ্রি ক্যাপচা',
      'প্রতি ক্যাপচায় নির্ধারিত বেস আয়',
      'সাধারণ উইথড্র প্রসেসিং (১২-২৪ ঘন্টা)',
      '২৪/৭ কমিউনিটি সাপোর্ট'
    ],
    featuresEn: [
      'Standard daily free captchas',
      'Standard base rate per captcha',
      'Standard withdrawal (12-24h)',
      'Community support'
    ]
  },
  {
    tier: 'silver',
    nameEn: 'Silver VIP',
    nameBn: 'সিলভার ভিআইপি',
    price: 100,
    dailyLimit: 60,
    rateMultiplier: 1.4,
    ratePerCaptcha: 3.5,
    featuresBn: [
      'মাত্র ৳১০০ টাকা থেকে ভিআইপি শুরু',
      'দৈনিক সর্বোচ্চ ৬০টি ক্যাপচা সুবিধা',
      'ফাস্ট উইথড্র প্রসেসিং (৬-১২ ঘন্টা)',
      'প্রিমিয়াম সাপোর্ট চ্যাট'
    ],
    featuresEn: [
      'Starts at ৳100',
      'Max 60 captchas / day',
      'Fast withdrawal (6-12h)',
      'Premium support chat'
    ]
  },
  {
    tier: 'gold',
    nameEn: 'Gold VIP',
    nameBn: 'গোল্ড ভিআইপি',
    price: 500,
    dailyLimit: 150,
    rateMultiplier: 2.0,
    ratePerCaptcha: 5.0,
    popular: true,
    featuresBn: [
      'দৈনিক সর্বোচ্চ ১৫০টি ক্যাপচা সুবিধা',
      'সুপারফাস্ট উইথড্র (২-৪ ঘন্টা)',
      'ম্যাথ ও স্লাইডার ক্যাপচায় প্রায়োরিটি',
      'প্রিমিয়াম হেল্পলাইন সাপোর্ট'
    ],
    featuresEn: [
      'Max 150 captchas / day',
      'Superfast withdrawal (2-4h)',
      'Priority math & slider access',
      'Priority support'
    ]
  },
  {
    tier: 'diamond',
    nameEn: 'Diamond Pro VIP',
    nameBn: 'ডায়মন্ড প্রো ভিআইপি',
    price: 1000,
    dailyLimit: 9999,
    rateMultiplier: 3.2,
    ratePerCaptcha: 8.0,
    featuresBn: [
      'সীমাহীন আনলিমিটেড ক্যাপচা সমাধান',
      'তাত্ক্ষণিক প্রায়োরিটি উইথড্র (৫-৩০ মিনিট)',
      'কোনো দৈনিক ক্যাপচা লিমিট নেই',
      'ভিআইপি টেলিগ্রাম ও হোয়াটসঅ্যাপ সাপোর্ট'
    ],
    featuresEn: [
      'Unlimited daily captchas',
      'Instant priority payout (5-30m)',
      'No daily quota restrictions',
      'VIP Telegram & WhatsApp manager'
    ]
  }
];
