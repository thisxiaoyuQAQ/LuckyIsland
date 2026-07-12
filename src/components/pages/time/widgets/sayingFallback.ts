const FALLBACK = [
  "把今天过好，就是对昨天最好的交代。",
  "慢一点，也是一种前进。",
  "愿你眼里有光，心里有数。",
  "保持热爱，奔赴山海。",
  "凡心所向，素履以往。",
];

export function fallbackSaying(): string {
  return FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
}
