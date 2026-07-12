const THURSDAY = [
  "木鱼一敲，烦恼清零。今天周四，V 我 50 看看实力。",
  "功德已经到账，炸鸡仍在路上。",
  "施主今日与佛有缘，也与疯狂星期四有缘。",
  "再敲五十下，不一定大彻大悟，但可能想吃炸鸡。",
  "心静自然凉，周四自然香。",
];

export function thursdayLine(): string {
  return THURSDAY[Math.floor(Math.random() * THURSDAY.length)];
}
