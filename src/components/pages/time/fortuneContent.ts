export interface Fortune {
  date: string;
  level: string;
  blessing: string;
  stars: number;
  luckyNumber: number;
  luckyColor: { name: string; hex: string };
}

const LEVELS = ["大吉", "中吉", "小吉", "平", "末小吉"];

const BLESSINGS = [
  "今日诸事顺遂，宜放手去做。",
  "静水流深，沉着应对自有转机。",
  "小有波折，但贵人就在身旁。",
  "宜整理旧事，清出新的空间。",
  "专注一处，胜过四处出击。",
  "今日宜独处片刻，理清思绪。",
  "付出终有回响，不必急于一时。",
  "宜坦诚沟通，误会自消。",
];

const COLORS = [
  { name: "竹青", hex: "#6c9a8b" },
  { name: "黛蓝", hex: "#4a6fa5" },
  { name: "赭石", hex: "#b06a4a" },
  { name: "藕荷", hex: "#9b6a9e" },
  { name: "鸦青", hex: "#3a4a5a" },
  { name: "缃色", hex: "#d4a84a" },
  { name: "月白", hex: "#cfe0e8" },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFortune(today: string): Fortune {
  return {
    date: today,
    level: pick(LEVELS),
    blessing: pick(BLESSINGS),
    stars: 1 + Math.floor(Math.random() * 5),
    luckyNumber: Math.floor(Math.random() * 10),
    luckyColor: pick(COLORS),
  };
}

export function ensureTodayFortune(stored: Fortune | null, today: string): Fortune {
  return stored && stored.date === today ? stored : generateFortune(today);
}
