# LuckyIsland Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在完全独立的 `WebPage/` 目录中构建可迁出建仓、可直接部署至 Tencent EdgeOne Pages 的 LuckyIsland 中英双语静态项目官网。

**Architecture:** Astro 5 在构建期为 `/` 与 `/en/` 生成共享组件的静态 HTML；类型化文案、locale、Release 选择和灵动岛状态映射保持为可单测的纯 TypeScript。原生客户端脚本完成菜单、章节观察与下载渐进增强，`motion` 只用于顶部灵动岛和一次性揭示。

**Tech Stack:** Astro 5.18.2、TypeScript 5.9.3 strict、Tailwind CSS 4.3.2、`@tailwindcss/vite` 4.3.2、motion 12.42.2、lucide-astro 0.556.0、Vitest 4.1.10、Testing Library DOM 10.4.1、Playwright 1.61.1、pnpm 9.15.9、Node.js 20。

## Global Constraints

- 所有官网源码、素材、测试、文档和部署配置必须位于 `WebPage/`；不得修改桌面端 `src/`、`src-tauri/`、根目录依赖或构建配置。
- 中文首页为 `/`，英文首页为 `/en/`；两者均为真实静态输出，不使用 SSR、SPA fallback 或 Edge Function。
- 固定使用 Astro 5 + TypeScript strict + Tailwind CSS v4 + Astro Components；不引入 React、Next.js 或通用 UI 组件库。
- 初始 HTML 的下载地址必须是 `https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest`；API 固定为 `https://api.github.com/repos/thisxiaoyuQAQ/LuckyIsland/releases/latest`，不使用 Token。
- Release 忽略 draft/prerelease，只接受 `.exe` 且名称包含 `setup`、`installer` 或 `x64` 的资源；多个匹配时优先 `setup`。
- 颜色固定为 Cloud `#F7FBFF`、Ice `#E8F4FC`、Deep Ink `#12243A`、Island `#090D14`、Lucky Green `#72BE63`、Slate `#5E7386`、Line `#D7E3EC`、White `#FFFFFF`。
- 本地字体固定为 Noto Sans SC Variable、Sora Variable、IBM Plex Mono；真实截图不得重绘或伪造。
- 视觉实现与最终浏览器验收必须使用 `frontend-design` skill，维持已批准的“昼夜航标 / Daybreak Beacon”方向，不退化为通用 SaaS 渐变或卡片墙。
- 顶部灵动岛是唯一编排式滚动动效；支持 `prefers-reduced-motion`；禁用 JavaScript 后正文、锚点、Latest Release 和 GitHub 仍可用。
- 不接入分析统计、Cookie banner、广告、追踪、后端、数据库、登录、评论、论坛、博客或在线设置同步。
- Lighthouse Performance、Accessibility、Best Practices、SEO 生产目标均不低于 90。
- EdgeOne：Root `WebPage`；Node.js `20`；Install `pnpm install --frozen-lockfile`；Build `pnpm build`；Output `dist`。

## File Map

```text
WebPage/
├─ public/                         # 五张真实截图、favicon、OG 图片、robots
├─ scripts/generate-og.mjs        # 生成 1200×630 分享图
├─ src/components/                # Header、FloatingIsland、九个内容章节、Footer
├─ src/content/messages.ts        # Messages 类型与双语文案
├─ src/layouts/BaseLayout.astro   # SEO、hreflang、JSON-LD
├─ src/lib/                       # locale、release、island-state 纯函数
├─ src/scripts/                   # 下载、菜单、灵动岛客户端逻辑
├─ src/pages/index.astro          # 中文静态页
├─ src/pages/en/index.astro       # 英文静态页
├─ src/styles/global.css          # Tailwind v4 token 与全局样式
├─ tests/                         # Vitest、构建输出、Playwright
├─ astro.config.mjs
├─ playwright.config.ts
├─ vitest.config.ts
├─ tsconfig.json
├─ package.json
├─ pnpm-lock.yaml
└─ README.md
```

---

### Task 1: 建立独立 Astro 工程与语义化素材

**Files:**
- Create: `WebPage/package.json`, `WebPage/astro.config.mjs`, `WebPage/tsconfig.json`
- Create: `WebPage/vitest.config.ts`, `WebPage/playwright.config.ts`, `WebPage/src/env.d.ts`
- Rename: `WebPage/public/UI-收.png` → `WebPage/public/island-compact.png`
- Rename: `WebPage/public/UI-开.png` → `WebPage/public/island-expanded.png`
- Rename: `WebPage/public/UI-待办.png` → `WebPage/public/todo-page.png`
- Rename: `WebPage/public/UI-通知.png` → `WebPage/public/notification-page.png`
- Rename: `WebPage/public/设置.png` → `WebPage/public/settings-window.png`
- Create: `WebPage/pnpm-lock.yaml` through `pnpm install`

**Interfaces:**
- Consumes: 已批准技术栈与五张真实截图。
- Produces: `pnpm dev|build|test|test:build|test:e2e|check`，静态站点配置和路径别名。

- [ ] **Step 1: 运行会失败的工程存在性检查**

```powershell
Set-Location WebPage
@('package.json','astro.config.mjs','tsconfig.json','vitest.config.ts','playwright.config.ts') |
  ForEach-Object { if (-not (Test-Path $_)) { throw "missing $_" } }
```

Expected: 首次以 `missing package.json` 失败。

- [ ] **Step 2: 写入工程配置**

`WebPage/package.json`:

```json
{
  "name": "luckyisland-website",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "engines": { "node": ">=20 <21" },
  "scripts": {
    "dev": "astro dev",
    "check": "astro check",
    "build": "astro check && astro build",
    "preview": "astro preview",
    "test": "vitest run --exclude tests/rendered-pages.test.ts",
    "test:build": "pnpm build && vitest run tests/rendered-pages.test.ts",
    "test:e2e": "playwright test",
    "generate:og": "node scripts/generate-og.mjs"
  },
  "dependencies": {
    "@astrojs/sitemap": "3.7.3",
    "@fontsource-variable/noto-sans-sc": "5.2.10",
    "@fontsource-variable/sora": "5.2.8",
    "@fontsource/ibm-plex-mono": "5.2.7",
    "astro": "5.18.2",
    "lucide-astro": "0.556.0",
    "motion": "12.42.2"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.9",
    "@playwright/test": "1.61.1",
    "@tailwindcss/vite": "4.3.2",
    "@testing-library/dom": "10.4.1",
    "@types/node": "20.19.43",
    "jsdom": "29.1.1",
    "sharp": "0.35.3",
    "tailwindcss": "4.3.2",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

`WebPage/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
const site = process.env.SITE_URL ?? "http://localhost:4321";
export default defineConfig({ site, output: "static", trailingSlash: "always", integrations: [sitemap()], vite: { plugins: [tailwindcss()] } });
```

`WebPage/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strictest",
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] }, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

`WebPage/vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
export default getViteConfig({ test: { environment: "jsdom", include: ["tests/**/*.test.ts"], restoreMocks: true } });
```

`WebPage/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "website.spec.ts", fullyParallel: true, retries: process.env.CI ? 2 : 0, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ],
  webServer: { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:4321", reuseExistingServer: !process.env.CI }
});
```

`WebPage/src/env.d.ts`: `/// <reference types="astro/client" />`

- [ ] **Step 3: 重命名素材并安装依赖**

```powershell
Set-Location WebPage
Move-Item -LiteralPath 'public/UI-收.png' 'public/island-compact.png'
Move-Item -LiteralPath 'public/UI-开.png' 'public/island-expanded.png'
Move-Item -LiteralPath 'public/UI-待办.png' 'public/todo-page.png'
Move-Item -LiteralPath 'public/UI-通知.png' 'public/notification-page.png'
Move-Item -LiteralPath 'public/设置.png' 'public/settings-window.png'
pnpm install
pnpm exec playwright install chromium
```

Expected: 生成 `pnpm-lock.yaml`，五个 ASCII 文件名存在，桌面端目录未改动。

- [ ] **Step 4: 验证并提交**

Run: `pnpm check`
Expected: `astro check` 无错误。

```bash
git add WebPage/package.json WebPage/pnpm-lock.yaml WebPage/astro.config.mjs WebPage/tsconfig.json WebPage/vitest.config.ts WebPage/playwright.config.ts WebPage/src/env.d.ts WebPage/public
git commit -m "chore(web): scaffold Astro website"
```

---

### Task 2: 建立类型化中英文内容与 locale/hash 工具

**Files:**
- Create: `WebPage/src/content/messages.ts`
- Create: `WebPage/src/lib/locale.ts`
- Create: `WebPage/tests/content.test.ts`
- Create: `WebPage/tests/locale.test.ts`

**Interfaces:**
- Consumes: 无前置运行时接口。
- Produces: `Locale = "zh" | "en"`；`Messages`；`messages: Record<Locale, Messages>`；`getMessages(locale): Messages`；`localizedPath(locale, hash?): string`；`switchLocale(url, target): string`。

- [ ] **Step 1: 写内容完整性和 locale 路径失败测试**

`WebPage/tests/content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { messages, type Locale } from "../src/content/messages";
const locales: Locale[] = ["zh", "en"];
describe("localized messages", () => {
  it("keeps identical top-level keys", () => expect(Object.keys(messages.zh).sort()).toEqual(Object.keys(messages.en).sort()));
  it.each(locales)("provides three primary actions for %s", (locale) => {
    expect(messages[locale].actions.download).toBeTruthy();
    expect(messages[locale].actions.releaseNotes).toBeTruthy();
    expect(messages[locale].actions.github).toBeTruthy();
  });
  it.each(locales)("localizes every screenshot alt in %s", (locale) => {
    expect(Object.keys(messages[locale].alt).sort()).toEqual(["compact", "expanded", "notification", "settings", "todo"]);
  });
});
```

`WebPage/tests/locale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localizedPath, switchLocale } from "../src/lib/locale";
describe("locale paths", () => {
  it("uses static locale roots", () => {
    expect(localizedPath("zh")).toBe("/");
    expect(localizedPath("en")).toBe("/en/");
  });
  it("preserves normalized hashes", () => {
    expect(localizedPath("en", "developers")).toBe("/en/#developers");
    expect(switchLocale(new URL("https://example.test/?from=nav#daily"), "zh")).toBe("/#daily");
  });
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `cd WebPage && pnpm vitest run tests/content.test.ts tests/locale.test.ts`
Expected: FAIL，包含 `Failed to resolve import ../src/content/messages`。

- [ ] **Step 3: 实现完整内容合同与中文文案**

先写入 `WebPage/src/content/messages.ts`；本步骤与下一步骤组成同一文件的完整内容：

```ts
export type Locale = "zh" | "en";
type NamedCopy = { title: string; body: string };
type Moment = NamedCopy & { time: "08:30" | "14:00" | "21:30"; icon: "sun" | "terminal" | "moon" };
export interface Messages {
  lang: "zh-CN" | "en";
  localeName: string;
  meta: { title: string; description: string; ogAlt: string };
  nav: { product: string; daily: string; developers: string; openSource: string; menu: string; close: string };
  actions: { download: string; releaseNotes: string; github: string; windowsOnly: string };
  hero: { eyebrow: string; title: string; body: string; availability: string };
  proof: { size: string; cpu: string; windows: string; license: string };
  states: { eyebrow: string; title: string; intro: string; items: [NamedCopy, NamedCopy, NamedCopy] };
  daily: { eyebrow: string; title: string; intro: string; moments: [Moment, Moment, Moment] };
  personalization: { eyebrow: string; title: string; body: string; bullets: [string, string, string, string]; safety: string };
  developer: { eyebrow: string; title: string; body: string; terminal: NamedCopy; ai: NamedCopy; notify: NamedCopy; hooks: NamedCopy; commandLabel: string; command: string };
  trust: { eyebrow: string; title: string; body: string; items: [NamedCopy, NamedCopy, NamedCopy, NamedCopy]; networkNote: string };
  cta: { eyebrow: string; title: string; body: string; versionPending: string; sizePending: string };
  footer: { license: string; disclaimer: string; source: string; language: string };
  island: { hero: string; daily: string; developer: string; download: string; buildDone: string; latest: string };
  alt: { compact: string; expanded: string; todo: string; notification: string; settings: string };
}
const command = `curl -X POST http://127.0.0.1:9753/notify \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"构建完成","body":"lucky-island 发布成功","source":"ci"}'`;
const zh: Messages = {
  lang: "zh-CN", localeName: "简体中文",
  meta: {
    title: "LuckyIsland — Windows 屏幕顶部的灵动岛式桌面助手",
    description: "把时间、天气、待办、行情、终端、通知与 AI 放在 Windows 屏幕顶部，轻量、本地优先、MIT 开源。",
    ogAlt: "LuckyIsland 展开态界面与品牌信息"
  },
  nav: { product: "产品", daily: "日常", developers: "开发者", openSource: "开源", menu: "打开菜单", close: "关闭菜单" },
  actions: { download: "下载 Windows 版", releaseNotes: "查看 Release Notes", github: "GitHub", windowsOnly: "仅支持 Windows 10 / 11" },
  hero: {
    eyebrow: "Windows 桌面 · 灵动岛式助手",
    title: "把重要的事，放在视线正中央。",
    body: "时间、天气、待办、行情、终端与 AI，常驻屏幕顶部；需要时展开，不需要时安静退场。",
    availability: "轻量安装 · 本地优先 · MIT 开源"
  },
  proof: { size: "安装包约 12.5 MB", cpu: "语音关闭时空闲 CPU < 1%", windows: "Windows 10 / 11", license: "MIT 开源许可" },
  states: {
    eyebrow: "一条岛，三种状态", title: "只在你需要的时候占据空间。",
    intro: "隐藏、紧凑、展开之间以克制的 260ms 过渡切换，并记住你的屏幕与位置。",
    items: [
      { title: "隐藏", body: "用 Alt+X 或托盘随时收起，让桌面恢复完整空间。" },
      { title: "紧凑", body: "720×80 单行显示时间与必要信息。" },
      { title: "展开", body: "720×400 画布在日历、天气、待办、终端和通知间秒切。" }
    ]
  },
  daily: {
    eyebrow: "一天中的 LuckyIsland", title: "从第一眼时间，到最后一条通知。", intro: "能力按真实时刻出现，而不是堆成一面功能墙。",
    moments: [
      { time: "08:30", icon: "sun", title: "抬眼看见今天", body: "时间、天气、日历、农历与气象预警，在出发前给你足够信息。" },
      { time: "14:00", icon: "terminal", title: "专注正在发生的事", body: "待办、股票、多标签终端与快捷命令，在同一画布间快速切换。" },
      { time: "21:30", icon: "moon", title: "收好今天的回声", body: "回看通知历史，记录今日心情，或者敲几下电子木鱼。" }
    ]
  },
  personalization: {
    eyebrow: "你的岛，由你安排", title: "从透明度到时间画布，都能精确调整。",
    body: "主题、双轴偏移、页面顺序、时间组件与快捷键集中在独立设置窗口中。",
    bullets: ["9 个时间主题预设", "组件区域与拖拽排序", "多屏位置持久化", "配置导入与导出"],
    safety: "导出采用安全白名单，密钥、token、缓存和运行数据不会被带出。"
  },
  developer: {
    eyebrow: "为终端与 AI 工作流而生", title: "构建结束时，让桌面替你抬头。",
    body: "LuckyIsland 把终端、AI Provider 和本地通知接在同一条轻量工作流上。",
    terminal: { title: "多标签终端", body: "xterm.js + portable-pty，支持快捷命令和 Windows Terminal。" },
    ai: { title: "三种 AI Provider", body: "Claude CLI、Codex CLI 与自定义 Chat API；支持流式回答、联网搜索和取消。" },
    notify: { title: "本地通知端点", body: "向 127.0.0.1:9753/notify 发送请求，写入历史并弹出 Windows toast。" },
    hooks: { title: "Claude / Codex hooks", body: "仓库附带 lucky-notify CLI 与 hook 示例，让完成事件自动抵达岛上。" },
    commandLabel: "发送一条本地构建通知", command
  },
  trust: {
    eyebrow: "本地优先，不夸大边界", title: "轻量，是可以核实的工程结果。", body: "核心数据留在本机，网络能力只在对应功能需要时使用。",
    items: [
      { title: "SQLite 本地持久化", body: "待办、通知历史与应用状态存储在本机。" },
      { title: "约 12.5 MB", body: "Tauri 2、thin LTO 与动态链接控制安装体积。" },
      { title: "CPU < 1%", body: "关闭语音时的空闲基线保持轻量。" },
      { title: "安全导出", body: "密钥和 token 不进入配置导出文件。" }
    ],
    networkNote: "天气、股票、联网搜索和外部 AI Provider 仍需要网络；官网不会把产品描述为完全离线。"
  },
  cta: { eyebrow: "把岛放到屏幕顶部", title: "现在下载 LuckyIsland。", body: "无需账户。安装后从托盘和快捷键开始使用。", versionPending: "正在检查最新版本", sizePending: "前往 Latest Release" },
  footer: { license: "MIT License", disclaimer: "LuckyIsland 是独立开源项目，非 Apple 官方产品。", source: "查看源码", language: "English" },
  island: { hero: "08:30 · 晴 22° · 3 项待办", daily: "14:00 · 终端运行中", developer: "构建完成", download: "LuckyIsland", buildDone: "通知已送达", latest: "最新版本" },
  alt: { compact: "LuckyIsland 紧凑态显示时间与状态", expanded: "LuckyIsland 展开态时间画布", todo: "LuckyIsland 待办页面", notification: "LuckyIsland 通知历史页面", settings: "LuckyIsland 独立设置窗口" }
};
```

- [ ] **Step 4: 在同一文件中追加英文文案与导出**

```ts
const en: Messages = {
  lang: "en", localeName: "English",
  meta: {
    title: "LuckyIsland — a dynamic-island desktop companion for Windows",
    description: "Keep time, weather, tasks, markets, terminal notifications and AI within sight on Windows. Lightweight, local-first and MIT licensed.",
    ogAlt: "LuckyIsland expanded interface and brand message"
  },
  nav: { product: "Product", daily: "Daily flow", developers: "Developers", openSource: "Open source", menu: "Open menu", close: "Close menu" },
  actions: { download: "Download for Windows", releaseNotes: "View release notes", github: "GitHub", windowsOnly: "Windows 10 / 11 only" },
  hero: {
    eyebrow: "A dynamic-island desktop companion for Windows", title: "Keep what matters in sight.",
    body: "Time, weather, tasks, markets, terminal updates and AI stay at the top of your screen—quiet when idle, ready when opened.",
    availability: "Small install · Local-first · MIT licensed"
  },
  proof: { size: "About 12.5 MB installer", cpu: "< 1% idle CPU with voice off", windows: "Windows 10 / 11", license: "MIT licensed" },
  states: {
    eyebrow: "One island, three states", title: "It takes space only when you ask.",
    intro: "Move between hidden, compact and expanded states with a restrained 260ms transition while monitor placement stays remembered.",
    items: [
      { title: "Hidden", body: "Press Alt+X or use the tray to return the whole desktop to your work." },
      { title: "Compact", body: "A 720×80 line keeps time and essential context in view." },
      { title: "Expanded", body: "A 720×400 canvas moves across calendar, weather, tasks, terminal and notifications." }
    ]
  },
  daily: {
    eyebrow: "A day with LuckyIsland", title: "From the first glance to the last notification.", intro: "Features appear as real moments instead of a wall of interchangeable cards.",
    moments: [
      { time: "08:30", icon: "sun", title: "Read the day at a glance", body: "Time, weather, calendar, lunar dates and alerts give you context before you leave." },
      { time: "14:00", icon: "terminal", title: "Stay with the work in progress", body: "Tasks, markets, tabbed terminals and quick commands share one switchable canvas." },
      { time: "21:30", icon: "moon", title: "Collect the day’s echoes", body: "Review notification history, log your mood or tap the digital wooden fish." }
    ]
  },
  personalization: {
    eyebrow: "Make the island yours", title: "Tune the canvas down to its position and opacity.",
    body: "Themes, axis offsets, page order, time widgets and shortcuts live in a focused settings window.",
    bullets: ["9 time themes", "Widget regions and drag order", "Multi-monitor position memory", "Configuration import and export"],
    safety: "Exports use a safe allowlist, so keys, tokens, caches and runtime data stay behind."
  },
  developer: {
    eyebrow: "Built for terminal and AI workflows", title: "Let the desktop look up when the build is done.",
    body: "LuckyIsland connects terminal work, AI providers and local notifications without turning them into a cloud service.",
    terminal: { title: "Tabbed terminal", body: "xterm.js + portable-pty with quick commands and Windows Terminal access." },
    ai: { title: "Three AI providers", body: "Claude CLI, Codex CLI or a custom Chat API with streaming, web search and cancellation." },
    notify: { title: "Local notification endpoint", body: "POST to 127.0.0.1:9753/notify to keep history and raise a Windows toast." },
    hooks: { title: "Claude / Codex hooks", body: "The repository includes lucky-notify and hook examples that route completion events to the island." },
    commandLabel: "Send a local build notification", command
  },
  trust: {
    eyebrow: "Local-first, with honest boundaries", title: "Lightweight is an engineering result you can inspect.", body: "Core records stay on the machine; network access belongs only to features that need it.",
    items: [
      { title: "Local SQLite", body: "Tasks, notification history and application state persist on your PC." },
      { title: "About 12.5 MB", body: "Tauri 2, thin LTO and shared libraries keep the installer compact." },
      { title: "< 1% idle CPU", body: "The baseline remains light with voice features disabled." },
      { title: "Safe exports", body: "Keys and tokens are excluded from configuration exports." }
    ],
    networkNote: "Weather, stocks, web search and external AI providers still need a connection; LuckyIsland is not presented as fully offline."
  },
  cta: { eyebrow: "Put the island at the top", title: "Download LuckyIsland today.", body: "No account required. Start from the tray and keyboard shortcuts after installation.", versionPending: "Checking the latest version", sizePending: "Open Latest Release" },
  footer: { license: "MIT License", disclaimer: "LuckyIsland is an independent open-source project and is not affiliated with Apple.", source: "View source", language: "简体中文" },
  island: { hero: "08:30 · Clear 22° · 3 tasks", daily: "14:00 · Terminal running", developer: "Build complete", download: "LuckyIsland", buildDone: "Notification delivered", latest: "Latest version" },
  alt: { compact: "LuckyIsland compact state with time and status", expanded: "LuckyIsland expanded time canvas", todo: "LuckyIsland task page", notification: "LuckyIsland notification history", settings: "LuckyIsland settings window" }
};
export const messages = { zh, en } satisfies Record<Locale, Messages>;
export function getMessages(locale: Locale): Messages { return messages[locale]; }
```

- [ ] **Step 5: 实现 locale/hash 纯函数**

`WebPage/src/lib/locale.ts`:

```ts
import type { Locale } from "../content/messages";
export function localizedPath(locale: Locale, hash = ""): string {
  const base = locale === "en" ? "/en/" : "/";
  const normalized = hash.replace(/^#/, "");
  return normalized ? `${base}#${normalized}` : base;
}
export function switchLocale(url: URL, target: Locale): string { return localizedPath(target, url.hash); }
```

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm vitest run tests/content.test.ts tests/locale.test.ts`
Expected: 7 tests PASS，TypeScript 不报告中英文键缺失。

```bash
git add WebPage/src/content/messages.ts WebPage/src/lib/locale.ts WebPage/tests/content.test.ts WebPage/tests/locale.test.ts
git commit -m "feat(web): add bilingual content contract"
```

---

### Task 3: 实现 GitHub Latest Release 选择与下载渐进增强

**Files:**
- Create: `WebPage/src/lib/releases.ts`
- Create: `WebPage/src/scripts/download.ts`
- Create: `WebPage/tests/releases.test.ts`

**Interfaces:**
- Consumes: `[data-download-link]`、`[data-release-version]`、`[data-release-size]`、`[data-release-notes]`。
- Produces: `LATEST_RELEASE_URL`、`RELEASE_API_URL`、`GitHubRelease`、`DownloadInfo`、`selectWindowsAsset()`、`toDownloadInfo()`、`enhanceDownload()`。

- [ ] **Step 1: 写 Release 规则与降级失败测试**

`WebPage/tests/releases.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEST_RELEASE_URL, formatBytes, selectWindowsAsset, toDownloadInfo } from "../src/lib/releases";
import { enhanceDownload } from "../src/scripts/download";
const release = {
  draft: false, prerelease: false, tag_name: "v1.4.0", html_url: "https://github.test/v1.4.0",
  assets: [
    { name: "LuckyIsland-x64.exe", browser_download_url: "https://cdn.test/x64.exe", size: 13_000_000 },
    { name: "LuckyIsland-setup.exe", browser_download_url: "https://cdn.test/setup.exe", size: 12_500_000 },
    { name: "LuckyIsland.msi", browser_download_url: "https://cdn.test/app.msi", size: 14_000_000 }
  ]
};
describe("release selection", () => {
  it("prefers setup exe", () => expect(selectWindowsAsset(release)?.name).toBe("LuckyIsland-setup.exe"));
  it("rejects draft, prerelease and unmatched assets", () => {
    expect(toDownloadInfo({ ...release, draft: true })).toBeNull();
    expect(toDownloadInfo({ ...release, prerelease: true })).toBeNull();
    expect(toDownloadInfo({ ...release, assets: release.assets.slice(2) })).toBeNull();
  });
  it("formats binary size", () => expect(formatBytes(12_500_000)).toBe("11.9 MB"));
});
describe("browser enhancement", () => {
  beforeEach(() => { document.body.innerHTML = `<a data-download-link href="${LATEST_RELEASE_URL}">Download</a><span data-release-version>Checking</span><span data-release-size>Latest</span>`; });
  it("updates a valid installer", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 }));
    expect((await enhanceDownload(document, fetchImpl))?.version).toBe("v1.4.0");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("https://cdn.test/setup.exe");
  });
  it("keeps fallback on failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    expect(await enhanceDownload(document, fetchImpl)).toBeNull();
    expect(document.querySelector("a")?.getAttribute("href")).toBe(LATEST_RELEASE_URL);
  });
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `pnpm vitest run tests/releases.test.ts`
Expected: FAIL，包含 `Failed to resolve import ../src/lib/releases`。

- [ ] **Step 3: 实现 Release 选择纯函数**

`WebPage/src/lib/releases.ts`:

```ts
export const REPOSITORY_URL = "https://github.com/thisxiaoyuQAQ/LuckyIsland";
export const LATEST_RELEASE_URL = `${REPOSITORY_URL}/releases/latest`;
export const RELEASE_API_URL = "https://api.github.com/repos/thisxiaoyuQAQ/LuckyIsland/releases/latest";
export interface ReleaseAsset { name: string; browser_download_url: string; size: number }
export interface GitHubRelease { draft: boolean; prerelease: boolean; tag_name: string; html_url: string; assets: ReleaseAsset[] }
export interface DownloadInfo { version: string; url: string; size: string; releaseNotesUrl: string }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
export function isGitHubRelease(value: unknown): value is GitHubRelease {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== "string" || typeof value.html_url !== "string" || !Array.isArray(value.assets)) return false;
  return value.assets.every((a) => isRecord(a) && typeof a.name === "string" && typeof a.browser_download_url === "string" && typeof a.size === "number");
}
export function selectWindowsAsset(release: GitHubRelease): ReleaseAsset | null {
  if (release.draft || release.prerelease) return null;
  const candidates = release.assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".exe") && ["setup", "installer", "x64"].some((token) => name.includes(token));
  });
  return candidates.sort((a, b) => Number(b.name.toLowerCase().includes("setup")) - Number(a.name.toLowerCase().includes("setup")))[0] ?? null;
}
export function formatBytes(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
export function toDownloadInfo(value: unknown): DownloadInfo | null {
  if (!isGitHubRelease(value)) return null;
  const asset = selectWindowsAsset(value);
  return asset ? { version: value.tag_name, url: asset.browser_download_url, size: formatBytes(asset.size), releaseNotesUrl: value.html_url } : null;
}
```

- [ ] **Step 4: 实现浏览器下载增强**

`WebPage/src/scripts/download.ts`:

```ts
import { RELEASE_API_URL, toDownloadInfo, type DownloadInfo } from "../lib/releases";
export async function enhanceDownload(root: ParentNode = document, fetchImpl: typeof fetch = fetch): Promise<DownloadInfo | null> {
  try {
    const response = await fetchImpl(RELEASE_API_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const info = toDownloadInfo(await response.json());
    if (!info) return null;
    root.querySelectorAll<HTMLAnchorElement>("[data-download-link]").forEach((node) => { node.href = info.url; node.setAttribute("download", ""); });
    root.querySelectorAll<HTMLElement>("[data-release-version]").forEach((node) => { node.textContent = info.version; });
    root.querySelectorAll<HTMLElement>("[data-release-size]").forEach((node) => { node.textContent = info.size; });
    root.querySelectorAll<HTMLAnchorElement>("[data-release-notes]").forEach((node) => { node.href = info.releaseNotesUrl; });
    return info;
  } catch { return null; }
}
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/releases.test.ts`
Expected: 5 tests PASS。

```bash
git add WebPage/src/lib/releases.ts WebPage/src/scripts/download.ts WebPage/tests/releases.test.ts
git commit -m "feat(web): resolve latest Windows installer"
```

---

### Task 4: 建立章节到灵动岛状态映射与 Reduced Motion 控制

**Files:**
- Create: `WebPage/src/lib/island-state.ts`
- Create: `WebPage/src/scripts/floating-island.ts`
- Create: `WebPage/tests/island-state.test.ts`

**Interfaces:**
- Consumes: `[data-island-section]`、`[data-floating-island]`、`[data-mode]`、`[data-reveal]`。
- Produces: `SectionId`、`IslandMode`、`islandModeForSection()`、`setupFloatingIsland(root?, win?): () => void`。

- [ ] **Step 1: 写状态映射和 Reduced Motion 失败测试**

`WebPage/tests/island-state.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { islandModeForSection } from "../src/lib/island-state";
import { setupFloatingIsland } from "../src/scripts/floating-island";
describe("island state", () => {
  it.each([
    ["hero", "hero"], ["states", "hero"], ["daily", "daily"], ["personalization", "daily"],
    ["developers", "developer"], ["trust", "developer"], ["download", "download"]
  ] as const)("maps %s to %s", (section, mode) => expect(islandModeForSection(section)).toBe(mode));
  it("keeps direct section switching for reduced motion", () => {
    document.body.innerHTML = `<aside data-floating-island><span data-mode="hero"></span></aside>`;
    const observe = vi.fn();
    const win = { matchMedia: vi.fn(() => ({ matches: true })), IntersectionObserver: vi.fn(() => ({ observe, disconnect: vi.fn() })) } as unknown as Window;
    setupFloatingIsland(document, win);
    expect(document.querySelector("aside")?.getAttribute("data-reduced-motion")).toBe("true");
    expect(observe).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `pnpm vitest run tests/island-state.test.ts`
Expected: FAIL，包含 `Failed to resolve import ../src/lib/island-state`。

- [ ] **Step 3: 实现状态映射**

`WebPage/src/lib/island-state.ts`:

```ts
export type SectionId = "hero" | "states" | "daily" | "personalization" | "developers" | "trust" | "download";
export type IslandMode = "hero" | "daily" | "developer" | "download";
const modes: Record<SectionId, IslandMode> = {
  hero: "hero", states: "hero", daily: "daily", personalization: "daily",
  developers: "developer", trust: "developer", download: "download"
};
export function islandModeForSection(section: SectionId): IslandMode { return modes[section]; }
```

- [ ] **Step 4: 实现章节观察、岛屿切换与一次性截图揭示**

`WebPage/src/scripts/floating-island.ts`:

```ts
import { animate } from "motion";
import { islandModeForSection, type SectionId } from "../lib/island-state";
export function setupFloatingIsland(root: ParentNode = document, win: Window = window): () => void {
  const island = root.querySelector<HTMLElement>("[data-floating-island]");
  if (!island) return () => undefined;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  island.dataset.reducedMotion = String(reduced);
  const setMode = (section: SectionId) => {
    const mode = islandModeForSection(section);
    island.dataset.mode = mode;
    island.querySelectorAll<HTMLElement>("[data-mode]").forEach((node) => { node.hidden = node.dataset.mode !== mode; });
    if (!reduced) animate(island, { scale: [0.985, 1], opacity: [0.88, 1] }, { duration: 0.24, ease: "easeOut" });
  };
  setMode("hero");
  const observer = new win.IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const section = visible?.target.getAttribute("data-island-section") as SectionId | null;
    if (section) setMode(section);
  }, { rootMargin: "-32% 0px -52%", threshold: [0.15, 0.45, 0.75] });
  root.querySelectorAll<HTMLElement>("[data-island-section]").forEach((node) => observer.observe(node));
  if (reduced) {
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => { node.dataset.revealed = "true"; });
    return () => observer.disconnect();
  }
  const revealObserver = new win.IntersectionObserver((entries, current) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      const node = entry.target as HTMLElement;
      node.dataset.revealed = "true";
      animate(node, { y: [18, 0], opacity: [0, 1] }, { duration: 0.45, ease: "easeOut" });
      current.unobserve(node);
    });
  }, { threshold: 0.18 });
  root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => revealObserver.observe(node));
  return () => { observer.disconnect(); revealObserver.disconnect(); };
}
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/island-state.test.ts`
Expected: 8 tests PASS。

```bash
git add WebPage/src/lib/island-state.ts WebPage/src/scripts/floating-island.ts WebPage/tests/island-state.test.ts
git commit -m "feat(web): map sections to island states"
```

---

### Task 5: 建立 BaseLayout、SEO、字体、视觉 token 与分享素材

**Files:**
- Create: `WebPage/src/layouts/BaseLayout.astro`
- Create: `WebPage/src/styles/global.css`
- Create: `WebPage/public/favicon.svg`
- Create: `WebPage/public/robots.txt`
- Create: `WebPage/scripts/generate-og.mjs`
- Create: `WebPage/public/og-image.png` through script
- Create: `WebPage/tests/components.test.ts`

**Interfaces:**
- Consumes: `Locale`、`Messages`、`REPOSITORY_URL`、`LATEST_RELEASE_URL`。
- Produces: `BaseLayout` props `{ locale: Locale; messages: Messages }`；全站 `.shell`、`.section`、`.eyebrow`、`.button-*`、`.image-frame` 样式合同。

- [ ] **Step 1: 写 BaseLayout 元数据失败测试**

`WebPage/tests/components.test.ts`:

```ts
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import BaseLayout from "../src/layouts/BaseLayout.astro";
import { messages } from "../src/content/messages";
describe("BaseLayout", () => {
  it("renders language, canonical, alternates and SoftwareApplication JSON-LD", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(BaseLayout, { props: { locale: "en", messages: messages.en }, slots: { default: "<main>content</main>" } });
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('hreflang="zh-CN"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('"@type":"SoftwareApplication"');
  });
});
```

- [ ] **Step 2: 运行测试确认缺少布局**

Run: `pnpm vitest run tests/components.test.ts`
Expected: FAIL，包含 `Failed to resolve import ../src/layouts/BaseLayout.astro`。

- [ ] **Step 3: 实现 BaseLayout**

`WebPage/src/layouts/BaseLayout.astro`:

```astro
---
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/sora";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "../styles/global.css";
import type { Locale, Messages } from "../content/messages";
import { LATEST_RELEASE_URL, REPOSITORY_URL } from "../lib/releases";
interface Props { locale: Locale; messages: Messages }
const { locale, messages } = Astro.props;
const base = Astro.site ?? new URL("http://localhost:4321");
const path = locale === "en" ? "/en/" : "/";
const canonical = new URL(path, base);
const zh = new URL("/", base);
const en = new URL("/en/", base);
const og = new URL("/og-image.png", base);
const jsonLd = {
  "@context": "https://schema.org", "@type": "SoftwareApplication", name: "LuckyIsland",
  applicationCategory: "UtilitiesApplication", operatingSystem: "Windows 10, Windows 11",
  description: messages.meta.description, downloadUrl: LATEST_RELEASE_URL, codeRepository: REPOSITORY_URL,
  license: "https://opensource.org/license/mit", softwareVersion: "latest", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }
};
---
<!doctype html>
<html lang={messages.lang}>
  <head>
    <meta charset="UTF-8" />
    <script is:inline>document.documentElement.classList.add("js");</script>
    <meta name="viewport" content="width=device-width" />
    <meta name="theme-color" content="#F7FBFF" />
    <meta name="description" content={messages.meta.description} />
    <title>{messages.meta.title}</title>
    <link rel="canonical" href={canonical} />
    <link rel="alternate" hreflang="zh-CN" href={zh} />
    <link rel="alternate" hreflang="en" href={en} />
    <link rel="alternate" hreflang="x-default" href={zh} />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={messages.meta.title} />
    <meta property="og:description" content={messages.meta.description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={og} />
    <meta property="og:image:alt" content={messages.meta.ogAlt} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={messages.meta.title} />
    <meta name="twitter:description" content={messages.meta.description} />
    <meta name="twitter:image" content={og} />
    <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
  </head>
  <body>
    <a class="skip-link" href="#main">{locale === "zh" ? "跳到主要内容" : "Skip to content"}</a>
    <slot />
  </body>
</html>
```

- [ ] **Step 4: 写入 Tailwind v4 token 与全局交互样式**

`WebPage/src/styles/global.css`:

```css
@import "tailwindcss";
@theme {
  --color-cloud: #F7FBFF; --color-ice: #E8F4FC; --color-ink: #12243A; --color-island: #090D14;
  --color-lucky: #72BE63; --color-slate: #5E7386; --color-line: #D7E3EC; --color-white: #FFFFFF;
  --font-sans: "Noto Sans SC Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-display: "Sora Variable", "Noto Sans SC Variable", "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", Consolas, monospace;
}
:root { color-scheme: light; scroll-behavior: smooth; background: var(--color-cloud); color: var(--color-ink); }
* { box-sizing: border-box; }
html { scroll-padding-top: 7.5rem; }
body { margin: 0; min-width: 320px; overflow-x: clip; font-family: var(--font-sans); background: var(--color-cloud); }
a { color: inherit; text-decoration: none; }
button, a { -webkit-tap-highlight-color: transparent; }
:focus-visible { outline: 3px solid #4f963f; outline-offset: 4px; }
.shell { width: min(1200px, calc(100% - 2rem)); margin-inline: auto; }
.section { padding-block: clamp(4rem, 9vw, 8rem); scroll-margin-top: 7rem; }
.eyebrow { margin: 0 0 1rem; color: #3f7935; font: 600 .75rem/1.4 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.display { margin: 0; max-width: 18ch; font-family: var(--font-display); font-size: clamp(2.25rem, 6vw, 5rem); line-height: .98; letter-spacing: -.055em; }
.lede { max-width: 62ch; color: var(--color-slate); font-size: clamp(1rem, 1.8vw, 1.2rem); line-height: 1.8; }
.button-primary, .button-secondary, .button-quiet { display: inline-flex; min-height: 3rem; align-items: center; justify-content: center; gap: .55rem; border-radius: 999px; padding: .75rem 1.15rem; font-weight: 700; }
.button-primary { background: var(--color-lucky); color: #10220d; box-shadow: 0 12px 30px rgb(55 104 46 / .18); }
.button-secondary { border: 1px solid var(--color-line); background: white; }
.button-quiet { color: var(--color-slate); }
.image-frame { border: 1px solid rgb(215 227 236 / .9); border-radius: 1.35rem; background: white; box-shadow: 0 24px 70px rgb(18 36 58 / .12); }
[data-reveal] { opacity: 1; }
.js [data-reveal]:not([data-revealed="true"]) { opacity: 0; }
[data-reveal][data-revealed="true"] { opacity: 1; }
.menu-open { overflow: hidden; }
.skip-link { position: fixed; z-index: 100; left: 1rem; top: -4rem; padding: .75rem 1rem; background: var(--color-island); color: white; }
.skip-link:focus { top: 1rem; }
@media (max-width: 767px) { .shell { width: min(100% - 1.25rem, 1200px); } .section { padding-block: clamp(4rem, 18vw, 5rem); } }
@media (prefers-reduced-motion: reduce) {
  :root { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  [data-reveal] { opacity: 1; transform: none !important; }
}
```

- [ ] **Step 5: 生成品牌图标、robots 与真实截图分享图**

`WebPage/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#090D14"/><rect x="12" y="23" width="40" height="18" rx="9" fill="#72BE63"/><circle cx="44" cy="32" r="4" fill="#F7FBFF"/></svg>
```

`WebPage/public/robots.txt`:

```text
User-agent: *
Allow: /
```

`WebPage/scripts/generate-og.mjs`:

```js
import sharp from "sharp";
const text = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#F7FBFF"/><text x="72" y="128" fill="#12243A" font-family="Segoe UI" font-size="62" font-weight="700">LuckyIsland</text><text x="72" y="190" fill="#5E7386" font-family="Segoe UI" font-size="28">Keep what matters in sight.</text><rect x="70" y="236" width="1060" height="326" rx="32" fill="#E8F4FC"/></svg>`;
const screenshot = await sharp("public/island-expanded.png").resize({ width: 800, withoutEnlargement: true }).png().toBuffer();
await sharp(Buffer.from(text)).composite([{ input: screenshot, left: 330, top: 168 }]).png().toFile("public/og-image.png");
```

Run: `pnpm generate:og`
Expected: `public/og-image.png` 为 1200×630 PNG。

- [ ] **Step 6: 运行布局测试并提交**

Run: `pnpm vitest run tests/components.test.ts && pnpm check`
Expected: BaseLayout 测试 PASS；Astro 类型检查无错误。

```bash
git add WebPage/src/layouts/BaseLayout.astro WebPage/src/styles/global.css WebPage/public/favicon.svg WebPage/public/robots.txt WebPage/public/og-image.png WebPage/scripts/generate-og.mjs WebPage/tests/components.test.ts
git commit -m "feat(web): add visual system and SEO layout"
```

---

### Task 6: 实现 Header、移动菜单、语言切换与 Footer

**Files:**
- Create: `WebPage/src/components/Header.astro`
- Create: `WebPage/src/components/Footer.astro`
- Create: `WebPage/src/scripts/header.ts`
- Modify: `WebPage/tests/components.test.ts`

**Interfaces:**
- Consumes: `{ locale: Locale; messages: Messages }`、`localizedPath()`、`switchLocale()`、`LATEST_RELEASE_URL`、`REPOSITORY_URL`。
- Produces: `Header` 与 `Footer` props `{ locale; messages }`；DOM 合同 `[data-menu-toggle]`、`#mobile-menu`、`[data-menu-overlay]`、`[data-locale-link]`。

- [ ] **Step 1: 向组件测试追加失败断言**

在 `WebPage/tests/components.test.ts` 追加：

```ts
import { getByRole } from "@testing-library/dom";
import Header from "../src/components/Header.astro";
import Footer from "../src/components/Footer.astro";
it("renders accessible navigation and static fallback links", async () => {
  const container = await AstroContainer.create();
  const header = await container.renderToString(Header, { props: { locale: "zh", messages: messages.zh } });
  const footer = await container.renderToString(Footer, { props: { locale: "zh", messages: messages.zh } });
  document.body.innerHTML = header;
  expect(getByRole(document.body, "button", { name: "打开菜单" }).getAttribute("aria-expanded")).toBe("false");
  expect(header).toContain('aria-controls="mobile-menu"');
  expect(header).toContain('aria-expanded="false"');
  expect(header).toContain('href="/en/"');
  expect(header).toContain('href="https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest"');
  expect(footer).toContain("MIT License");
  expect(footer).toContain("非 Apple 官方产品");
});
```

Run: `pnpm vitest run tests/components.test.ts`
Expected: FAIL，缺少 `Header.astro`。

- [ ] **Step 2: 实现移动菜单与 hash 保留脚本**

`WebPage/src/scripts/header.ts`:

```ts
import type { Locale } from "../content/messages";
import { switchLocale } from "../lib/locale";
export function setupHeader(root: Document = document, win: Window = window): () => void {
  const toggle = root.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const menu = root.querySelector<HTMLElement>("#mobile-menu");
  const overlay = root.querySelector<HTMLElement>("[data-menu-overlay]");
  if (!toggle || !menu || !overlay) return () => undefined;
  const firstLink = menu.querySelector<HTMLAnchorElement>("a");
  const close = (restore = false) => {
    toggle.setAttribute("aria-expanded", "false"); menu.hidden = true; overlay.hidden = true;
    root.documentElement.classList.remove("menu-open"); if (restore) toggle.focus();
  };
  const open = () => {
    toggle.setAttribute("aria-expanded", "true"); menu.hidden = false; overlay.hidden = false;
    root.documentElement.classList.add("menu-open"); firstLink?.focus();
  };
  const onToggle = () => toggle.getAttribute("aria-expanded") === "true" ? close() : open();
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !menu.hidden) close(true); };
  toggle.addEventListener("click", onToggle); overlay.addEventListener("click", () => close(true));
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => close()));
  root.addEventListener("keydown", onKey);
  root.querySelectorAll<HTMLAnchorElement>("[data-locale-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = link.dataset.targetLocale as Locale;
      localStorage.setItem("luckyisland-locale", target);
      link.href = switchLocale(new URL(win.location.href), target);
      if (event.defaultPrevented) return;
    });
  });
  return () => { toggle.removeEventListener("click", onToggle); root.removeEventListener("keydown", onKey); };
}
```

- [ ] **Step 3: 实现 Header**

`WebPage/src/components/Header.astro`:

```astro
---
import { Download, Menu } from "lucide-astro";
import type { Locale, Messages } from "../content/messages";
import { localizedPath } from "../lib/locale";
import { LATEST_RELEASE_URL, REPOSITORY_URL } from "../lib/releases";
interface Props { locale: Locale; messages: Messages }
const { locale, messages } = Astro.props;
const target: Locale = locale === "zh" ? "en" : "zh";
const links = [
  [messages.nav.product, "#product"], [messages.nav.daily, "#daily"],
  [messages.nav.developers, "#developers"], [messages.nav.openSource, "#trust"]
];
---
<header class="sticky top-0 z-50 border-b border-line/80 bg-cloud/90 backdrop-blur-xl">
  <div class="shell flex h-18 items-center justify-between gap-4">
    <a class="font-display text-lg font-bold tracking-[-.04em]" href={localizedPath(locale)} aria-label="LuckyIsland home">Lucky<span class="text-[#4f963f]">Island</span></a>
    <nav class="hidden items-center gap-6 text-sm text-slate md:flex" aria-label="Primary">
      {links.map(([label, href], index) => <a class:list={["hover:text-ink", index === 3 && "hidden lg:inline"]} href={href}>{label}</a>)}
      <a href={REPOSITORY_URL}>GitHub</a>
      <a data-locale-link data-target-locale={target} href={localizedPath(target)}>{messages.footer.language}</a>
    </nav>
    <div class="flex items-center gap-2">
      <a data-download-link class="button-primary size-11 p-0 sm:size-auto sm:px-[1.15rem]" aria-label={messages.actions.download} href={LATEST_RELEASE_URL}><Download size={17} /><span class="hidden sm:inline">{messages.actions.download}</span></a>
      <button data-menu-toggle class="inline-grid size-11 place-items-center rounded-full border border-line bg-white md:hidden" type="button" aria-controls="mobile-menu" aria-expanded="false" aria-label={messages.nav.menu}><Menu size={20} /></button>
    </div>
  </div>
  <button data-menu-overlay hidden class="fixed inset-0 top-18 z-40 h-[calc(100dvh-4.5rem)] w-full bg-island/35 md:hidden" aria-label={messages.nav.close}></button>
  <nav id="mobile-menu" hidden class="shell absolute left-1/2 top-[4.75rem] z-50 -translate-x-1/2 rounded-3xl border border-line bg-white p-4 shadow-2xl md:hidden" aria-label="Mobile">
    {links.map(([label, href]) => <a class="block rounded-2xl px-4 py-3 font-semibold hover:bg-ice" href={href}>{label}</a>)}
    <a class="block rounded-2xl px-4 py-3 font-semibold" href={REPOSITORY_URL}>GitHub</a>
    <a data-locale-link data-target-locale={target} class="block rounded-2xl px-4 py-3 font-semibold" href={localizedPath(target)}>{messages.footer.language}</a>
    <a data-download-link class="button-primary mt-3 w-full" href={LATEST_RELEASE_URL}>{messages.actions.download}</a>
  </nav>
</header>
<script>
  import { setupHeader } from "../scripts/header";
  setupHeader();
</script>
```

- [ ] **Step 4: 实现 Footer**

`WebPage/src/components/Footer.astro`:

```astro
---
import type { Locale, Messages } from "../content/messages";
import { localizedPath } from "../lib/locale";
import { REPOSITORY_URL } from "../lib/releases";
interface Props { locale: Locale; messages: Messages }
const { locale, messages } = Astro.props;
const target: Locale = locale === "zh" ? "en" : "zh";
---
<footer class="border-t border-line bg-white py-8 text-sm text-slate">
  <div class="shell flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
    <div><strong class="text-ink">LuckyIsland</strong><p class="mt-1">{messages.footer.disclaimer}</p></div>
    <div class="flex flex-wrap gap-5">
      <a href="https://opensource.org/license/mit">{messages.footer.license}</a>
      <a href={REPOSITORY_URL}>{messages.footer.source}</a>
      <a data-locale-link data-target-locale={target} href={localizedPath(target)}>{messages.footer.language}</a>
    </div>
  </div>
</footer>
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/components.test.ts && pnpm check`
Expected: Header、Footer 与 BaseLayout 测试 PASS。

```bash
git add WebPage/src/components/Header.astro WebPage/src/components/Footer.astro WebPage/src/scripts/header.ts WebPage/tests/components.test.ts
git commit -m "feat(web): add responsive site navigation"
```

---

### Task 7: 实现 FloatingIsland、Hero 与事实证明带

**Files:**
- Create: `WebPage/src/components/FloatingIsland.astro`
- Create: `WebPage/src/components/Hero.astro`
- Create: `WebPage/src/components/ProofStrip.astro`
- Modify: `WebPage/tests/components.test.ts`

**Interfaces:**
- Consumes: `{ messages: Messages }`、下载/仓库常量和 Task 4 的 DOM 合同。
- Produces: `#product[data-island-section="hero"]`、真实 Hero 图片舞台、四项 proof、`[data-floating-island]`。

- [ ] **Step 1: 追加首屏失败测试**

在 `WebPage/tests/components.test.ts` 追加：

```ts
import Hero from "../src/components/Hero.astro";
import ProofStrip from "../src/components/ProofStrip.astro";
it("renders hero actions and real screenshots", async () => {
  const container = await AstroContainer.create();
  const hero = await container.renderToString(Hero, { props: { messages: messages.zh } });
  const proof = await container.renderToString(ProofStrip, { props: { messages: messages.zh } });
  expect(hero).toContain("把重要的事，放在视线正中央。");
  expect(hero).toContain("island-expanded.png");
  expect(hero).toContain("settings-window.png");
  expect((hero.match(/https:\/\/github.com/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(proof).toContain("12.5 MB");
  expect(proof).toContain("CPU &lt; 1%");
});
```

Run: `pnpm vitest run tests/components.test.ts`
Expected: FAIL，缺少 `Hero.astro`。

- [ ] **Step 2: 实现顶部灵动岛**

`WebPage/src/components/FloatingIsland.astro`:

```astro
---
import { Bell, CheckCircle2, CloudSun, Download } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
---
<aside data-floating-island data-mode="hero" class="pointer-events-none fixed left-1/2 top-[5.15rem] z-40 flex min-h-11 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-island px-5 text-sm text-white shadow-2xl" aria-live="polite">
  <span data-mode="hero" class="flex items-center gap-2"><CloudSun size={16} class="text-lucky" />{messages.island.hero}</span>
  <span data-mode="daily" hidden class="flex items-center gap-2"><CheckCircle2 size={16} class="text-lucky" />{messages.island.daily}</span>
  <span data-mode="developer" hidden class="flex items-center gap-2"><Bell size={16} class="text-lucky" />{messages.island.developer} · {messages.island.buildDone}</span>
  <span data-mode="download" hidden class="flex items-center gap-2"><Download size={16} class="text-lucky" />{messages.island.latest} · <b data-release-version>LuckyIsland</b></span>
</aside>
<script>
  import { setupFloatingIsland } from "../scripts/floating-island";
  setupFloatingIsland();
</script>
```

- [ ] **Step 3: 实现 Hero**

`WebPage/src/components/Hero.astro`:

```astro
---
import { ArrowUpRight, Download, Github } from "lucide-astro";
import type { Messages } from "../content/messages";
import { LATEST_RELEASE_URL, REPOSITORY_URL } from "../lib/releases";
interface Props { messages: Messages }
const { messages } = Astro.props;
---
<section id="product" data-island-section="hero" class="section overflow-hidden pt-32 md:pt-40">
  <div class="shell grid items-center gap-10 md:grid-cols-12 lg:gap-14">
    <div class="md:col-span-7">
      <p class="eyebrow">{messages.hero.eyebrow}</p>
      <h1 class="display">{messages.hero.title}</h1>
      <p class="lede mt-7">{messages.hero.body}</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a data-download-link class="button-primary" href={LATEST_RELEASE_URL}><Download size={18} />{messages.actions.download}</a>
        <a data-release-notes class="button-secondary" href={LATEST_RELEASE_URL}>{messages.actions.releaseNotes}<ArrowUpRight size={17} /></a>
        <a class="button-quiet" href={REPOSITORY_URL}><Github size={18} />{messages.actions.github}</a>
      </div>
      <p class="mt-4 text-sm text-slate">{messages.hero.availability}<span class="block sm:hidden">{messages.actions.windowsOnly}</span></p>
    </div>
    <div class="relative grid gap-4 md:col-span-5 md:min-h-[30rem] md:place-items-center lg:min-h-[35rem]" data-reveal>
      <img class="image-frame w-full md:absolute md:left-[-6%] md:top-[16%] md:w-[108%] lg:left-[-10%] lg:w-[112%]" src="/island-expanded.png" alt={messages.alt.expanded} width="720" height="400" fetchpriority="high" />
      <img class="image-frame w-full md:absolute md:left-[-10%] md:top-[4%] md:w-[94%] lg:left-[-18%] lg:top-[2%] lg:w-[92%]" src="/island-compact.png" alt={messages.alt.compact} width="720" height="80" fetchpriority="high" />
      <img class="image-frame w-full md:absolute md:bottom-0 md:right-[-8%] md:w-[62%] lg:right-[-18%] lg:w-[58%]" src="/settings-window.png" alt={messages.alt.settings} width="722" height="672" loading="eager" />
    </div>
  </div>
</section>
```

- [ ] **Step 4: 实现事实证明带**

`WebPage/src/components/ProofStrip.astro`:

```astro
---
import { Cpu, HardDriveDownload, Monitor, Scale } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
const facts = [{ Icon: HardDriveDownload, label: messages.proof.size }, { Icon: Cpu, label: messages.proof.cpu }, { Icon: Monitor, label: messages.proof.windows }, { Icon: Scale, label: messages.proof.license }];
---
<section aria-label="Product facts" class="border-y border-line bg-white">
  <div class="shell grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-4 md:divide-y-0">
    {facts.map(({ Icon, label }) => <div class="flex min-h-28 items-center gap-3 px-4 py-5"><Icon size={20} class="text-[#4f963f]" /><strong class="text-sm">{label}</strong></div>)}
  </div>
</section>
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/components.test.ts && pnpm check`
Expected: Hero、ProofStrip 与既有组件测试 PASS。

```bash
git add WebPage/src/components/FloatingIsland.astro WebPage/src/components/Hero.astro WebPage/src/components/ProofStrip.astro WebPage/tests/components.test.ts
git commit -m "feat(web): build hero and proof strip"
```

---

### Task 8: 实现灵动岛三态、日常旅程与个性化章节

**Files:**
- Create: `WebPage/src/components/IslandStates.astro`
- Create: `WebPage/src/components/DailyJourney.astro`
- Create: `WebPage/src/components/Personalization.astro`
- Modify: `WebPage/tests/components.test.ts`

**Interfaces:**
- Consumes: `Messages.states|daily|personalization|alt` 与三张真实截图。
- Produces: `#states`、`#daily`、`#personalization` 章节；对应 `data-island-section` 值和本地化图片 alt。

- [ ] **Step 1: 追加中段章节失败测试**

在 `WebPage/tests/components.test.ts` 追加：

```ts
import IslandStates from "../src/components/IslandStates.astro";
import DailyJourney from "../src/components/DailyJourney.astro";
import Personalization from "../src/components/Personalization.astro";
it("renders three product states and real daily/settings screenshots", async () => {
  const container = await AstroContainer.create();
  const states = await container.renderToString(IslandStates, { props: { messages: messages.zh } });
  const daily = await container.renderToString(DailyJourney, { props: { messages: messages.zh } });
  const settings = await container.renderToString(Personalization, { props: { messages: messages.zh } });
  expect(states).toContain("隐藏"); expect(states).toContain("紧凑"); expect(states).toContain("展开");
  expect(daily).toContain("08:30"); expect(daily).toContain("14:00"); expect(daily).toContain("21:30");
  expect(daily).toContain("todo-page.png"); expect(settings).toContain("settings-window.png");
});
```

Run: `pnpm vitest run tests/components.test.ts`
Expected: FAIL，缺少 `IslandStates.astro`。

- [ ] **Step 2: 实现三态章节**

`WebPage/src/components/IslandStates.astro`:

```astro
---
import { EyeOff, Maximize2, Minimize2 } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
const icons = [EyeOff, Minimize2, Maximize2];
---
<section id="states" data-island-section="states" class="section bg-ice/60">
  <div class="shell">
    <p class="eyebrow">{messages.states.eyebrow}</p><h2 class="display text-[clamp(2rem,5vw,4rem)]">{messages.states.title}</h2><p class="lede mt-6">{messages.states.intro}</p>
    <div class="mt-12 grid gap-5 md:grid-cols-3">
      {messages.states.items.map((item, index) => { const Icon = icons[index]!; return <article class="border-t border-ink/20 pt-5"><Icon class="text-[#4f963f]" /><h3 class="mt-6 font-display text-2xl font-semibold">{item.title}</h3><p class="mt-3 leading-7 text-slate">{item.body}</p></article>; })}
    </div>
    <div class="mt-12 grid gap-5 lg:grid-cols-[1fr_1.7fr]" data-reveal>
      <img class="image-frame w-full" src="/island-compact.png" alt={messages.alt.compact} width="720" height="80" loading="lazy" />
      <img class="image-frame w-full" src="/island-expanded.png" alt={messages.alt.expanded} width="720" height="400" loading="lazy" />
    </div>
  </div>
</section>
```

- [ ] **Step 3: 实现一天中的使用旅程**

`WebPage/src/components/DailyJourney.astro`:

```astro
---
import { MoonStar, SunMedium, TerminalSquare } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
const icons = { sun: SunMedium, terminal: TerminalSquare, moon: MoonStar };
---
<section id="daily" data-island-section="daily" class="section">
  <div class="shell">
    <p class="eyebrow">{messages.daily.eyebrow}</p><h2 class="display text-[clamp(2rem,5vw,4rem)]">{messages.daily.title}</h2><p class="lede mt-6">{messages.daily.intro}</p>
    <div class="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {messages.daily.moments.map((moment) => { const Icon = icons[moment.icon]; return <article class="relative border-t border-line pt-6"><time class="font-mono text-sm font-semibold text-[#3f7935]">{moment.time}</time><Icon class="absolute right-0 top-5 text-slate" /><h3 class="mt-8 font-display text-2xl font-semibold">{moment.title}</h3><p class="mt-3 leading-7 text-slate">{moment.body}</p></article>; })}
    </div>
    <figure class="mt-14" data-reveal><img class="image-frame mx-auto w-full max-w-4xl" src="/todo-page.png" alt={messages.alt.todo} width="720" height="400" loading="lazy" /></figure>
  </div>
</section>
```

- [ ] **Step 4: 实现个性化章节**

`WebPage/src/components/Personalization.astro`:

```astro
---
import { Check, ShieldCheck } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
---
<section id="personalization" data-island-section="personalization" class="section bg-white">
  <div class="shell grid items-center gap-12 lg:grid-cols-12">
    <div class="lg:col-span-5"><p class="eyebrow">{messages.personalization.eyebrow}</p><h2 class="display text-[clamp(2rem,5vw,4rem)]">{messages.personalization.title}</h2><p class="lede mt-6">{messages.personalization.body}</p>
      <ul class="mt-7 grid gap-3 sm:grid-cols-2">{messages.personalization.bullets.map((item) => <li class="flex gap-2"><Check size={18} class="mt-1 shrink-0 text-[#4f963f]" />{item}</li>)}</ul>
      <p class="mt-7 flex gap-3 rounded-2xl bg-ice p-4 text-sm leading-6 text-slate"><ShieldCheck class="shrink-0 text-[#3f7935]" />{messages.personalization.safety}</p>
    </div>
    <div class="md:col-span-7" data-reveal><img class="image-frame mx-auto w-full max-w-[45rem]" src="/settings-window.png" alt={messages.alt.settings} width="722" height="672" loading="lazy" /></div>
  </div>
</section>
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/components.test.ts && pnpm check`
Expected: 新增三个章节测试 PASS。

```bash
git add WebPage/src/components/IslandStates.astro WebPage/src/components/DailyJourney.astro WebPage/src/components/Personalization.astro WebPage/tests/components.test.ts
git commit -m "feat(web): add daily product journey"
```

---

### Task 9: 实现开发者、本地优先、下载 CTA 章节

**Files:**
- Create: `WebPage/src/components/DeveloperSection.astro`
- Create: `WebPage/src/components/TrustSection.astro`
- Create: `WebPage/src/components/DownloadCta.astro`
- Modify: `WebPage/tests/components.test.ts`

**Interfaces:**
- Consumes: `Messages.developer|trust|cta|actions|alt`、Release/GitHub 常量。
- Produces: `#developers`、`#trust`、`#download`；可验证 curl；最终三个行动入口；下载版本/大小更新节点。

- [ ] **Step 1: 追加深色章节与最终 CTA 失败测试**

在 `WebPage/tests/components.test.ts` 追加：

```ts
import DeveloperSection from "../src/components/DeveloperSection.astro";
import TrustSection from "../src/components/TrustSection.astro";
import DownloadCta from "../src/components/DownloadCta.astro";
it("renders developer command, honest network boundary and final actions", async () => {
  const container = await AstroContainer.create();
  const developer = await container.renderToString(DeveloperSection, { props: { messages: messages.zh } });
  const trust = await container.renderToString(TrustSection, { props: { messages: messages.zh } });
  const cta = await container.renderToString(DownloadCta, { props: { messages: messages.zh } });
  expect(developer).toContain("127.0.0.1:9753/notify"); expect(developer).toContain("notification-page.png");
  expect(trust).toContain("仍需要网络");
  expect(cta).toContain("data-download-link"); expect(cta).toContain("data-release-notes"); expect(cta).toContain("GitHub");
});
```

Run: `pnpm vitest run tests/components.test.ts`
Expected: FAIL，缺少 `DeveloperSection.astro`。

- [ ] **Step 2: 实现深色开发者章节**

`WebPage/src/components/DeveloperSection.astro`:

```astro
---
import { BellRing, Bot, Code2, TerminalSquare } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
const features = [{ Icon: TerminalSquare, item: messages.developer.terminal }, { Icon: Bot, item: messages.developer.ai }, { Icon: BellRing, item: messages.developer.notify }, { Icon: Code2, item: messages.developer.hooks }];
---
<section id="developers" data-island-section="developers" class="section bg-ink text-white">
  <div class="shell">
    <p class="eyebrow !text-lucky">{messages.developer.eyebrow}</p><h2 class="display text-[clamp(2rem,5vw,4rem)]">{messages.developer.title}</h2><p class="lede mt-6 !text-white/65">{messages.developer.body}</p>
    <div class="mt-12 grid gap-8 lg:grid-cols-2">
      <div class="grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2">{features.map(({ Icon, item }) => <article class="bg-island p-6"><Icon class="text-lucky" /><h3 class="mt-5 font-display text-xl font-semibold">{item.title}</h3><p class="mt-3 leading-7 text-white/60">{item.body}</p></article>)}</div>
      <div class="space-y-5" data-reveal><img class="w-full rounded-3xl border border-white/10 shadow-2xl" src="/notification-page.png" alt={messages.alt.notification} width="720" height="400" loading="lazy" /><div class="rounded-3xl border border-white/10 bg-island p-5"><p class="mb-4 font-mono text-xs text-lucky">{messages.developer.commandLabel}</p><pre class="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-white/75"><code>{messages.developer.command}</code></pre></div></div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: 实现本地优先与性能章节**

`WebPage/src/components/TrustSection.astro`:

```astro
---
import { Database, Gauge, PackageCheck, ShieldCheck } from "lucide-astro";
import type { Messages } from "../content/messages";
interface Props { messages: Messages }
const { messages } = Astro.props;
const icons = [Database, PackageCheck, Gauge, ShieldCheck];
---
<section id="trust" data-island-section="trust" class="section bg-ice/55">
  <div class="shell"><p class="eyebrow">{messages.trust.eyebrow}</p><h2 class="display text-[clamp(2rem,5vw,4rem)]">{messages.trust.title}</h2><p class="lede mt-6">{messages.trust.body}</p>
    <div class="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{messages.trust.items.map((item, index) => { const Icon = icons[index]!; return <article class="rounded-3xl border border-line bg-white p-6"><Icon class="text-[#4f963f]" /><h3 class="mt-5 font-display text-xl font-semibold">{item.title}</h3><p class="mt-3 leading-7 text-slate">{item.body}</p></article>; })}</div>
    <p class="mt-7 max-w-4xl border-l-2 border-lucky pl-4 text-sm leading-7 text-slate">{messages.trust.networkNote}</p>
  </div>
</section>
```

- [ ] **Step 4: 实现最终下载 CTA**

`WebPage/src/components/DownloadCta.astro`:

```astro
---
import { ArrowUpRight, Download, Github } from "lucide-astro";
import type { Messages } from "../content/messages";
import { LATEST_RELEASE_URL, REPOSITORY_URL } from "../lib/releases";
interface Props { messages: Messages }
const { messages } = Astro.props;
---
<section id="download" data-island-section="download" class="section bg-island text-white">
  <div class="shell text-center"><p class="eyebrow !text-lucky">{messages.cta.eyebrow}</p><h2 class="mx-auto max-w-3xl font-display text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-[.98] tracking-[-.055em]">{messages.cta.title}</h2><p class="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">{messages.cta.body}</p>
    <div class="mt-8 flex flex-wrap justify-center gap-3"><a data-download-link class="button-primary" href={LATEST_RELEASE_URL}><Download size={18} />{messages.actions.download}</a><a data-release-notes class="button-secondary !border-white/15 !bg-white/10 !text-white" href={LATEST_RELEASE_URL}>{messages.actions.releaseNotes}<ArrowUpRight size={17} /></a><a class="button-quiet !text-white" href={REPOSITORY_URL}><Github size={18} />{messages.actions.github}</a></div>
    <p class="mt-5 font-mono text-xs text-white/55"><span data-release-version>{messages.cta.versionPending}</span> · <span data-release-size>{messages.cta.sizePending}</span></p>
  </div>
</section>
```

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm vitest run tests/components.test.ts && pnpm check`
Expected: 开发者、信任与 CTA 测试 PASS。

```bash
git add WebPage/src/components/DeveloperSection.astro WebPage/src/components/TrustSection.astro WebPage/src/components/DownloadCta.astro WebPage/tests/components.test.ts
git commit -m "feat(web): add developer and download sections"
```

---

### Task 10: 组装中英文静态页面并验证构建输出

**Files:**
- Create: `WebPage/src/pages/index.astro`
- Create: `WebPage/src/pages/en/index.astro`
- Modify: `WebPage/src/layouts/BaseLayout.astro`
- Create: `WebPage/tests/rendered-pages.test.ts`

**Interfaces:**
- Consumes: 所有组件、`messages`、`enhanceDownload()`。
- Produces: `/index.html`、`/en/index.html`、`sitemap-index.xml` 或 `sitemap-0.xml`；每页三类主要行动入口和正确 SEO。

- [ ] **Step 1: 写静态构建输出失败测试**

`WebPage/tests/rendered-pages.test.ts`:

```ts
import { readFile, access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
async function html(path: string) { return readFile(new URL(path, import.meta.url), "utf8"); }
describe("static output", () => {
  it.each([["zh", "../dist/index.html", "zh-CN"], ["en", "../dist/en/index.html", "en"]])("renders %s page", async (_, file, lang) => {
    const output = await html(file);
    expect(output).toContain(`<html lang="${lang}"`);
    expect((output.match(/data-download-link/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((output.match(/data-release-notes/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(output).toContain("https://github.com/thisxiaoyuQAQ/LuckyIsland");
    expect(output).toContain('rel="canonical"');
    expect(output).toContain('hreflang="zh-CN"');
    expect(output).toContain('hreflang="en"');
  });
  it("emits both locale files and a sitemap", async () => {
    await expect(access(new URL("../dist/index.html", import.meta.url))).resolves.toBeUndefined();
    await expect(access(new URL("../dist/en/index.html", import.meta.url))).resolves.toBeUndefined();
    const sitemapIndex = access(new URL("../dist/sitemap-index.xml", import.meta.url));
    const sitemapSingle = access(new URL("../dist/sitemap-0.xml", import.meta.url));
    await expect(Promise.any([sitemapIndex, sitemapSingle])).resolves.toBeUndefined();
  });
});
```

Run: `pnpm vitest run tests/rendered-pages.test.ts`
Expected: FAIL，`dist/index.html` 不存在。

- [ ] **Step 2: 创建中文静态页面**

`WebPage/src/pages/index.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Header from "../components/Header.astro";
import FloatingIsland from "../components/FloatingIsland.astro";
import Hero from "../components/Hero.astro";
import ProofStrip from "../components/ProofStrip.astro";
import IslandStates from "../components/IslandStates.astro";
import DailyJourney from "../components/DailyJourney.astro";
import Personalization from "../components/Personalization.astro";
import DeveloperSection from "../components/DeveloperSection.astro";
import TrustSection from "../components/TrustSection.astro";
import DownloadCta from "../components/DownloadCta.astro";
import Footer from "../components/Footer.astro";
import { messages } from "../content/messages";
const locale = "zh" as const;
const copy = messages[locale];
---
<BaseLayout {locale} messages={copy}>
  <Header {locale} messages={copy} />
  <FloatingIsland messages={copy} />
  <main id="main">
    <Hero messages={copy} /><ProofStrip messages={copy} /><IslandStates messages={copy} />
    <DailyJourney messages={copy} /><Personalization messages={copy} />
    <DeveloperSection messages={copy} /><TrustSection messages={copy} /><DownloadCta messages={copy} />
  </main>
  <Footer {locale} messages={copy} />
</BaseLayout>
```

- [ ] **Step 3: 创建英文静态页面**

`WebPage/src/pages/en/index.astro`:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import Header from "../../components/Header.astro";
import FloatingIsland from "../../components/FloatingIsland.astro";
import Hero from "../../components/Hero.astro";
import ProofStrip from "../../components/ProofStrip.astro";
import IslandStates from "../../components/IslandStates.astro";
import DailyJourney from "../../components/DailyJourney.astro";
import Personalization from "../../components/Personalization.astro";
import DeveloperSection from "../../components/DeveloperSection.astro";
import TrustSection from "../../components/TrustSection.astro";
import DownloadCta from "../../components/DownloadCta.astro";
import Footer from "../../components/Footer.astro";
import { messages } from "../../content/messages";
const locale = "en" as const;
const copy = messages[locale];
---
<BaseLayout {locale} messages={copy}>
  <Header {locale} messages={copy} />
  <FloatingIsland messages={copy} />
  <main id="main">
    <Hero messages={copy} /><ProofStrip messages={copy} /><IslandStates messages={copy} />
    <DailyJourney messages={copy} /><Personalization messages={copy} />
    <DeveloperSection messages={copy} /><TrustSection messages={copy} /><DownloadCta messages={copy} />
  </main>
  <Footer {locale} messages={copy} />
</BaseLayout>
```

- [ ] **Step 4: 在布局尾部启动下载渐进增强**

在 `WebPage/src/layouts/BaseLayout.astro` 的 `</body>` 前加入：

```astro
<script>
  import { enhanceDownload } from "../scripts/download";
  enhanceDownload();
</script>
```

- [ ] **Step 5: 构建并运行输出测试**

Run (PowerShell): `$env:SITE_URL='http://localhost:4321'; pnpm test:build`
Expected: `astro check` 0 errors；生成中文与英文静态 HTML；`rendered-pages.test.ts` 全部 PASS。

- [ ] **Step 6: 提交页面组装**

```bash
git add WebPage/src/pages WebPage/src/layouts/BaseLayout.astro WebPage/tests/rendered-pages.test.ts
git commit -m "feat(web): assemble bilingual static pages"
```

---

### Task 11: 覆盖导航、语言、下载、移动菜单与 Reduced Motion 关键路径

**Files:**
- Create: `WebPage/tests/website.spec.ts`

**Interfaces:**
- Consumes: 完整静态页面与 Task 3/4/6 的 DOM 合同。
- Produces: desktop Chromium 与 Pixel 7 两套 Playwright 验收证据。

- [ ] **Step 1: 写端到端关键路径测试**

`WebPage/tests/website.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
const fallback = "https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest";
const api = "https://api.github.com/repos/thisxiaoyuQAQ/LuckyIsland/releases/latest";
test("desktop anchors and locale switch preserve the current section", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "开发者", exact: true }).click();
  await expect(page).toHaveURL(/#developers$/);
  await page.getByRole("link", { name: "English", exact: true }).first().click();
  await expect(page).toHaveURL(/\/en\/#developers$/);
});
test("valid GitHub response upgrades all download links", async ({ page }) => {
  await page.route(api, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    draft: false, prerelease: false, tag_name: "v9.9.9", html_url: "https://github.test/release",
    assets: [{ name: "LuckyIsland-setup-x64.exe", browser_download_url: "https://cdn.test/LuckyIsland.exe", size: 12_500_000 }]
  }) }));
  await page.goto("/");
  await expect(page.locator("[data-download-link]").first()).toHaveAttribute("href", "https://cdn.test/LuckyIsland.exe");
  await expect(page.locator("[data-release-version]").last()).toHaveText("v9.9.9");
});
test("failed GitHub response keeps the static Latest Release fallback", async ({ page }) => {
  await page.route(api, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("[data-download-link]").first()).toHaveAttribute("href", fallback);
});
test.describe("mobile menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("closes from Escape, link and overlay without horizontal overflow", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("[data-menu-toggle]");
    await toggle.click(); await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape"); await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click(); await page.locator("#mobile-menu a[href='#daily']").click();
    await expect(page).toHaveURL(/#daily$/); await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click(); await page.locator("[data-menu-overlay]").click({ position: { x: 10, y: 100 } });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
test("content and fallback actions work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "把重要的事，放在视线正中央。" })).toBeVisible();
  await expect(page.locator("[data-reveal]").first()).toBeVisible();
  await expect(page.locator("[data-download-link]").first()).toHaveAttribute("href", fallback);
  await expect(page.locator("a[href='#developers']").first()).toBeVisible();
  await context.close();
});
test("reduced motion skips scroll displacement animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("[data-floating-island]")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("[data-reveal]").first()).toHaveAttribute("data-revealed", "true");
});
```

- [ ] **Step 2: 运行 desktop 关键路径**

Run: `pnpm test:e2e --project=desktop-chromium`
Expected: hash 保留、Release 成功/失败、无 JavaScript 降级和 Reduced Motion 测试全部 PASS。

- [ ] **Step 3: 运行全部 Playwright 项目**

Run: `pnpm test:e2e`
Expected: desktop-chromium 与 mobile-chromium 全部 PASS；trace 仅在失败时保留。

- [ ] **Step 4: 提交端到端测试**

```bash
git add WebPage/tests/website.spec.ts
git commit -m "test(web): cover website critical paths"
```

---

### Task 12: EdgeOne 部署文档、响应式视觉验收与最终证据

**Files:**
- Create: `WebPage/README.md`
- Create: `WebPage/.gitignore`

**Interfaces:**
- Consumes: 所有构建、测试和静态输出命令。
- Produces: 可迁出仓库的本地开发说明、EdgeOne 参数、`SITE_URL` 合同、验收记录和干净工作树。

- [ ] **Step 1: 写部署文档存在性失败检查**

```powershell
Set-Location WebPage
if (-not (Test-Path README.md)) { throw 'missing standalone website README' }
if (-not (Select-String -Path README.md -Pattern 'pnpm install --frozen-lockfile' -Quiet)) { throw 'missing EdgeOne install command' }
if (-not (Select-String -Path README.md -Pattern 'SITE_URL' -Quiet)) { throw 'missing canonical URL contract' }
```

Expected: 首次以 `missing standalone website README` 失败。

- [ ] **Step 2: 写入可独立迁出的 README**

`WebPage/README.md`:

```md
# LuckyIsland Website

LuckyIsland 的中英双语静态官网。中文页面为 `/`，英文页面为 `/en/`。

## Local development

要求 Node.js 20 与 pnpm 9.15.9。

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm test:build
pnpm test:e2e
```

本地未设置 `SITE_URL` 时，canonical 与 sitemap 使用 `http://localhost:4321`。

## Tencent EdgeOne Pages

| Setting | Value |
|---|---|
| Root directory | `WebPage`（迁出独立建仓后使用仓库根目录） |
| Node.js | `20` |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Output directory | `dist` |

在 EdgeOne 项目环境变量中创建 `SITE_URL`，其值使用 EdgeOne 控制台当前项目显示的 HTTPS Production URL，且不包含尾部斜杠。绑定自定义域名后同步更新该变量并重新部署，以刷新 canonical、hreflang 与 sitemap。

项目为 Astro 静态输出，不启用 SSR adapter、SPA fallback 或 Edge Function。下载按钮直接请求 GitHub 公共 Latest Release API；请求失败时保留 Latest Release 页面链接。

在 EdgeOne 控制台配置缓存规则：`/_astro/*` 缓存 31536000 秒并启用 immutable；`/*.png`、`/favicon.svg` 缓存 31536000 秒；`/`、`/en/` 与 `/*.html` 使用浏览器 0 秒、边缘节点重新验证。HTML 内容更新后执行一次缓存刷新。

## Privacy

官网不使用分析统计、Cookie、广告或第三方追踪脚本。
```

`WebPage/.gitignore`:

```gitignore
node_modules/
dist/
.astro/
playwright-report/
test-results/
.artifacts/
```

- [ ] **Step 3: 运行全量静态质量门**

```powershell
Set-Location WebPage
pnpm test
pnpm test:build
pnpm test:e2e
```

Expected: Vitest 单元/组件测试、Astro strict 检查、静态构建测试、desktop/mobile Playwright 全部退出码 0；`dist/index.html` 与 `dist/en/index.html` 存在。

- [ ] **Step 4: 用生产预览完成三档视觉验收**

在一个终端运行：

```powershell
Set-Location WebPage
$env:SITE_URL='http://127.0.0.1:4321'
pnpm build
pnpm preview --host 127.0.0.1
```

在另一终端运行：

```powershell
Set-Location WebPage
New-Item -ItemType Directory -Force .artifacts | Out-Null
pnpm exec playwright screenshot --viewport-size="1440,1000" --full-page http://127.0.0.1:4321 .artifacts/home-desktop.png
pnpm exec playwright screenshot --viewport-size="900,1100" --full-page http://127.0.0.1:4321 .artifacts/home-tablet.png
pnpm exec playwright screenshot --viewport-size="390,844" --full-page http://127.0.0.1:4321 .artifacts/home-mobile.png
```

逐张检查：无横向溢出、文本遮挡、岛屿覆盖锚点、Hero 移动端叠压、低对比文字、图片失真；中文和 `/en/` 均检查首屏、开发者深色章节与最终 CTA。若发现视觉缺陷，回到对应组件或 `global.css` 添加能复现问题的 Playwright 断言，再按失败→最小修复→通过的顺序修复。

- [ ] **Step 5: 运行 Lighthouse 四项门槛**

保持 preview 运行并执行：

```powershell
pnpm dlx lighthouse@13.4.0 http://127.0.0.1:4321 --quiet --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=.artifacts/lighthouse.json
node -e "const r=require('./.artifacts/lighthouse.json'); const s=r.categories; for(const k of ['performance','accessibility','best-practices','seo']){const n=Math.round(s[k].score*100); console.log(k,n); if(n<90) process.exitCode=1}"
```

Expected: 四项均输出不低于 90，命令退出码 0。

- [ ] **Step 6: 验证迁移边界和生产依赖**

```powershell
Set-Location ..
git diff --name-only HEAD -- src src-tauri package.json pnpm-lock.yaml
Set-Location WebPage
pnpm install --frozen-lockfile
pnpm build
```

Expected: 第一条命令无输出；锁文件安装与构建成功；所有新增官网文件都在 `WebPage/`。

- [ ] **Step 7: 提交部署文档与最终验收调整**

```bash
git add WebPage/README.md WebPage/.gitignore WebPage/src WebPage/tests WebPage/public WebPage/package.json WebPage/pnpm-lock.yaml WebPage/astro.config.mjs WebPage/tsconfig.json WebPage/vitest.config.ts WebPage/playwright.config.ts WebPage/scripts
git commit -m "docs(web): document EdgeOne deployment"
```

---

## Plan Self-Review Record

- **规格覆盖：** Task 1 覆盖独立目录、技术栈、真实素材与锁定依赖；Task 2 覆盖完整双语内容和 hash；Task 3 覆盖 Release 成功/失败；Task 4 覆盖章节状态、motion 和 Reduced Motion；Task 5 覆盖视觉 token、字体、SEO、JSON-LD、sitemap、robots、OG；Task 6 覆盖键盘导航、移动菜单、语言切换与 Footer；Task 7–9 覆盖全部单页章节和真实截图；Task 10 覆盖双静态路径；Task 11 覆盖端到端关键路径；Task 12 覆盖 EdgeOne、Lighthouse、响应式和迁移边界。
- **范围检查：** 不创建后端、SSR、SPA、React、分析追踪、博客、账户或桌面端改动；未发现超出规格的子系统。
- **接口一致性：** 页面统一消费 `Messages`；locale 统一使用 `Locale`；下载节点统一使用四个 `data-release-*` 合同；灵动岛章节值完整落在 `SectionId` 联合类型中。
- **执行顺序：** 每个后续任务只消费前序已声明接口；每个提交都形成可独立审查的边界。
