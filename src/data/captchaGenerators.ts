import { CaptchaChallenge, CaptchaType } from '../types';

export interface GridTile {
  id: number;
  label: string;
  category: 'vehicle' | 'nature' | 'device' | 'food';
  icon: string; // SVG icon type
}

const GRID_TILES_POOL: GridTile[] = [
  { id: 1, label: 'Car', category: 'vehicle', icon: 'car' },
  { id: 2, label: 'Tree', category: 'nature', icon: 'tree' },
  { id: 3, label: 'Bus', category: 'vehicle', icon: 'bus' },
  { id: 4, label: 'Laptop', category: 'device', icon: 'laptop' },
  { id: 5, label: 'Truck', category: 'vehicle', icon: 'truck' },
  { id: 6, label: 'Flower', category: 'nature', icon: 'flower' },
  { id: 7, label: 'Bicycle', category: 'vehicle', icon: 'bike' },
  { id: 8, label: 'Burger', category: 'food', icon: 'burger' },
  { id: 9, label: 'Phone', category: 'device', icon: 'phone' },
  { id: 10, label: 'Motorcycle', category: 'vehicle', icon: 'motorcycle' },
  { id: 11, label: 'Apple', category: 'food', icon: 'apple' },
  { id: 12, label: 'Mountain', category: 'nature', icon: 'mountain' },
];

export function generateTextCaptcha(): CaptchaChallenge {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const length = 6;
  let text = '';
  for (let i = 0; i < length; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return {
    id: 'c-text-' + Math.random().toString(36).substring(2, 9),
    type: 'text',
    question: 'নিচের ঝাপসা ছবি থেকে ৬টি অক্ষর মনোযোগ দিয়ে পড়ে লিখুন:',
    solution: text,
    reward: 2.5,
    timeLimitSeconds: 35,
    hint: 'অক্ষরগুলো অনেকটা ঝাপসা — মনোযোগ দিয়ে তাকালে চেনা যাবে',
    noiseLevel: 'high'
  };
}

export function generateMathCaptcha(): CaptchaChallenge {
  const patterns = ['mul_add', 'mul_sub', 'two_digit_sub', 'two_digit_mul'] as const;
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  let expression = '';
  let answer = 0;

  if (pattern === 'mul_add') {
    const a = Math.floor(Math.random() * 11) + 4;
    const b = Math.floor(Math.random() * 8) + 3;
    const c = Math.floor(Math.random() * 25) + 7;
    expression = `${a}×${b}+${c}`;
    answer = a * b + c;
  } else if (pattern === 'mul_sub') {
    const a = Math.floor(Math.random() * 11) + 6;
    const b = Math.floor(Math.random() * 8) + 4;
    const c = Math.floor(Math.random() * 15) + 3;
    expression = `${a}×${b}-${c}`;
    answer = a * b - c;
  } else if (pattern === 'two_digit_sub') {
    const a = Math.floor(Math.random() * 140) + 85;
    const b = Math.floor(Math.random() * 55) + 19;
    expression = `${a}-${b}`;
    answer = a - b;
  } else {
    const a = Math.floor(Math.random() * 16) + 12;
    const b = Math.floor(Math.random() * 7) + 4;
    expression = `${a}×${b}`;
    answer = a * b;
  }

  return {
    id: 'c-math-' + Math.random().toString(36).substring(2, 9),
    type: 'math',
    question: 'নিচের ঝাপসা ছবির ভেতর লুকানো অঙ্কটি পড়ে সমাধান করুন:',
    expression: `${expression}=?`,
    solution: answer.toString(),
    reward: 3.0,
    timeLimitSeconds: 30,
    hint: 'ছবিটি ঝাপসা — সঠিক সংখ্যা ও চিহ্ন (+, -, ×) খেয়াল করে হিসাব করুন',
    noiseLevel: 'high'
  };
}

export function generateGridCaptcha(): CaptchaChallenge & { tiles: GridTile[] } {
  // Target: Vehicles
  // Pick 3 or 4 vehicles and fill rest with non-vehicles
  const vehicles = GRID_TILES_POOL.filter(t => t.category === 'vehicle');
  const others = GRID_TILES_POOL.filter(t => t.category !== 'vehicle');

  const shuffledVehicles = [...vehicles].sort(() => Math.random() - 0.5);
  const shuffledOthers = [...others].sort(() => Math.random() - 0.5);

  const numVehicles = Math.floor(Math.random() * 2) + 3; // 3 or 4
  const selectedVehicles = shuffledVehicles.slice(0, numVehicles);
  const selectedOthers = shuffledOthers.slice(0, 9 - numVehicles);

  const allTiles = [...selectedVehicles, ...selectedOthers].sort(() => Math.random() - 0.5);
  const correctIndices = allTiles
    .map((tile, idx) => tile.category === 'vehicle' ? idx : -1)
    .filter(idx => idx !== -1);

  return {
    id: 'c-grid-' + Math.random().toString(36).substring(2, 9),
    type: 'image_grid',
    question: 'ঝাপসা ছবিগুলো থেকে শুধুমাত্র যানবাহন (গাড়ি, বাস, বাইক, ট্রাক) চিহ্নিত করুন:',
    solution: correctIndices.sort().join(','),
    correctIndices,
    reward: 4.0,
    timeLimitSeconds: 40,
    hint: 'ঝাপসা ও বাঁকানো আইকনগুলোর ভেতর থেকে সঠিক যানবাহনগুলো বেছে নিন',
    noiseLevel: 'high',
    tiles: allTiles
  };
}

export function generateSliderCaptcha(): CaptchaChallenge & { targetPositionPercent: number } {
  // Target position between 22% and 84%
  const target = Math.floor(Math.random() * 62) + 22;

  return {
    id: 'c-slider-' + Math.random().toString(36).substring(2, 9),
    type: 'slider',
    question: 'ঝাপসা ব্যাকগ্রাউন্ডের ভেতর লুকানো খালি স্থানে স্লাইডারটি নিখুঁতভাবে বসান:',
    solution: target.toString(),
    targetPositionPercent: target,
    reward: 5.0,
    timeLimitSeconds: 30,
    hint: 'টার্গেট বক্সটি অস্পষ্ট — খুব সাবধানে মিলিয়ে দিন',
    noiseLevel: 'high'
  };
}

export function getRandomCaptcha(preferredType?: CaptchaType) {
  const types: CaptchaType[] = ['text', 'math', 'image_grid', 'slider'];
  const type = preferredType || types[Math.floor(Math.random() * types.length)];

  switch (type) {
    case 'text':
      return generateTextCaptcha();
    case 'math':
      return generateMathCaptcha();
    case 'image_grid':
      return generateGridCaptcha();
    case 'slider':
      return generateSliderCaptcha();
    default:
      return generateTextCaptcha();
  }
}
