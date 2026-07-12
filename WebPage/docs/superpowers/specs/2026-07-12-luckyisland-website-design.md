# LuckyIsland 项目官网设计规格

**日期：** 2026-07-12
**状态：** 已完成设计讨论与自审，待用户复核
**项目目录：** `WebPage/`
**部署目标：** Tencent EdgeOne Pages

## 1. 目标与边界

为 LuckyIsland 创建一个可以整体迁出、独立建仓和直接部署的中英双语项目官网。官网的两个同等目标是：

1. 帮助 Windows 用户理解产品并直接下载最新安装包。
2. 帮助开发者访问 GitHub、阅读 Release Notes 并了解开源与集成能力。

官网采用单页滚动结构，每种语言生成一份静态页面。所有官网源码、素材、测试、文档和部署配置必须位于仓库根目录 `WebPage/` 内。实现不得修改 LuckyIsland 桌面端的 `src/`、`src-tauri/`、根目录依赖或构建配置。

页面不承担完整文档、账户注册、在线服务、博客、论坛或应用内在线演示。

## 2. 成功标准

- 中文首页位于 `/`，英文首页位于 `/en/`。
- 首屏同时提供“直接下载 Windows 版”“查看 Release Notes”和“GitHub”入口。
- 真实展示 LuckyIsland 的紧凑态、展开态、待办、通知和设置界面。
- 访客能理解产品形态、日常功能、开发者能力、本地优先特性和性能优势。
- GitHub Latest Release API 可用时，下载按钮指向最新 NSIS `.exe`；失败时降级到 Latest Release 页面。
- 静态构建输出到 `WebPage/dist/`，可直接部署到 EdgeOne Pages。
- 桌面、平板和移动端均可用，支持键盘与 `prefers-reduced-motion`。
- 构建、单元测试、组件测试和端到端关键路径测试通过。

## 3. 受众与页面任务

主要受众：

- 希望在 Windows 桌面快速查看时间、天气、待办、股票和通知的普通用户。
- 使用 Claude、Codex、终端和自动化脚本的开发者。
- 希望审阅源码、Release Notes 或参与贡献的开源用户。

页面的单一任务是：让访客在理解“Windows 屏幕顶部的灵动岛式桌面助手”后，选择下载应用或查看 GitHub。

## 4. 设计方向：昼夜航标

**英文名称：Daybreak Beacon**

页面像 Windows 桌面在清晨亮起时的一束冷日光。大面积冰蓝和白色创造轻盈空间，墨蓝负责信息层级，黑色灵动岛是唯一高对比主角，LuckyIsland 绿只用于下载、成功和生命感。

设计原则：

- 使用真实产品内容，不使用与产品无关的抽象 3D 装饰。
- 避免通用 SaaS 渐变 Hero、无意义编号和同质化 Bento 卡片堆叠。
- 日常能力按照一天中的真实使用时刻组织；开发者能力集中为独立章节。
- 把视觉风险集中在顶部黑色灵动岛的章节变形上。
- 其他动画保持克制，截图只执行一次轻微纵向揭示。

## 5. 视觉系统

### 5.1 颜色

| 名称 | 色值 | 用途 |
|---|---:|---|
| Cloud | `#F7FBFF` | 页面主背景 |
| Ice | `#E8F4FC` | 章节分区、截图舞台 |
| Deep Ink | `#12243A` | 主文本、深色章节 |
| Island | `#090D14` | 灵动岛与终端背景 |
| Lucky Green | `#72BE63` | 下载按钮、成功状态、重点提示 |
| Slate | `#5E7386` | 次级正文 |
| Line | `#D7E3EC` | 边框与分隔线 |
| White | `#FFFFFF` | 卡片与反色文字 |

正文与背景组合必须达到 WCAG AA。Lucky Green 不作为小字号正文颜色。

### 5.2 字体

- 中文展示与正文：`Noto Sans SC Variable`，本地 WOFF2。
- 英文标题与品牌数字：`Sora Variable`，本地 WOFF2。
- 性能指标、命令与标签：`IBM Plex Mono`，只加载实际字重。
- 回退字体：`Microsoft YaHei UI`、`Segoe UI`、系统无衬线字体。

标题通过字重、紧凑字距和有意换行塑造辨识度，不使用大段全大写或装饰性斜体。

### 5.3 布局

- 桌面最大内容宽度 `1200px`，12 列网格。
- Hero 使用约 7:5 的文案与产品舞台比例。
- 桌面章节垂直间距 `96–128px`；移动端 `64–80px`。
- 截图只在 Hero 中错层，常规功能章节保持平直、可比较。
- 圆角用于灵动岛、按钮、截图舞台和状态容器，不给所有章节套同一种大圆角卡片。

## 6. 素材

现有素材位于 `WebPage/public/`。实现时改为语义清晰的 ASCII 文件名：

| 当前文件 | 目标文件 | 用途 |
|---|---|---|
| `UI-收.png` | `island-compact.png` | Hero 紧凑态与三态介绍 |
| `UI-开.png` | `island-expanded.png` | Hero 主展示与展开态介绍 |
| `UI-待办.png` | `todo-page.png` | 日常功能章节 |
| `UI-通知.png` | `notification-page.png` | 开发者通知章节 |
| `设置.png` | `settings-window.png` | 个性化章节 |

素材保持真实 UI，不重绘界面元素，不伪造应用中不存在的按钮或数据。官网只统一裁切、边框、阴影、替代文本和响应式尺寸。

桌面 Hero 中，`island-compact.png` 悬浮在 `island-expanded.png` 上方，`settings-window.png` 作为右下角辅助层。移动端取消叠压，图片按阅读顺序独立展示。

## 7. 单页信息架构

### 7.1 顶部导航

内容：Logo、产品、日常、开发者、开源、语言切换、下载按钮。

- 桌面端使用轻量吸顶导航。
- 移动端显示 Logo、下载按钮和菜单触发器。
- 锚点链接更新 URL hash。
- 语言切换保留当前 hash，例如从 `/#developers` 切换到 `/en/#developers`。

### 7.2 Hero

中文主标题：**把重要的事，放在视线正中央。**
英文主标题：**Keep what matters in sight.**

支持文案说明时间、天气、待办、行情、终端与 AI 都能在屏幕顶部随叫随到。

行动入口：

1. 直接下载 Windows 版。
2. 查看 Release Notes。
3. GitHub。

首屏产品舞台使用真实紧凑态、展开态和设置截图。顶部中央呈现可变形的黑色灵动岛。

### 7.3 事实证明带

展示四项可核实信息：

- 安装包约 `12.5 MB`。
- 语音关闭时空闲 CPU `< 1%`。
- 支持 Windows 10 / 11。
- MIT 开源许可。

### 7.4 灵动岛三态

解释隐藏、紧凑和展开三种窗口状态，以及毛玻璃、多屏定位、快捷键和个性化能力。使用 `island-compact.png` 与 `island-expanded.png`。

### 7.5 一天中的 LuckyIsland

时间点表达真实使用场景，不作为装饰编号：

- `08:30`：时间、天气、日历和农历。
- `14:00`：待办、股票和终端。
- `21:30`：通知历史、今日心情与电子木鱼。

待办场景使用 `todo-page.png`。缺少截图的能力使用简洁文字和图标，不制作虚假截图。

### 7.6 个性化

展示主题、透明度、页面管理、时间组件和快捷键配置。使用 `settings-window.png`，说明配置可导入导出且敏感信息不会被导出。

### 7.7 开发者章节

背景切换为 Deep Ink / Island，集中介绍：

- xterm.js 多标签终端与快捷命令。
- Claude CLI、Codex CLI 和自定义 Chat API。
- `127.0.0.1:9753/notify` 本地通知端点。
- `lucky-notify` CLI、Claude/Codex hooks 与 Windows toast。

使用 `notification-page.png` 和项目中可验证的 curl 示例。

### 7.8 本地优先与性能

说明 SQLite 本地持久化、密钥不随配置导出、轻量安装包和空闲性能。不得声称完全离线：天气、股票、联网搜索和外部 AI Provider 仍需要网络。

### 7.9 最终行动区与 Footer

再次提供直接下载、Release Notes 和 GitHub。Footer 包含 MIT License、仓库链接、语言切换和“非 Apple 官方产品”说明，不使用 Apple 商标暗示隶属关系。

## 8. 签名交互：顶部灵动岛

灵动岛是全页唯一编排式动效：

- Hero：时间、天气和待办摘要。
- 日常章节：天气或待办状态。
- 开发者章节：“构建完成”通知。
- 下载章节：最新版本与下载状态。

实现使用 CSS transform、opacity 和尺寸变量；章节状态由 IntersectionObserver 驱动。岛屿不得遮挡导航、标题、锚点目标或键盘焦点。

在 `prefers-reduced-motion: reduce` 下：

- 禁止尺寸补间、视差和滚动揭示。
- 岛屿内容直接切换，不使用位移动画。
- 所有内容在没有 JavaScript 时仍可阅读和访问。

## 9. 响应式

### 桌面端（≥ 1024px）

- 保留 12 列布局、错层 Hero 和岛屿变形。
- 日常时间轴横向排列。
- 开发者章节使用终端与通知双栏。

### 平板端（768–1023px）

- Hero 保持双栏但降低图片错层幅度。
- 时间轴允许两列换行。
- 导航减少次级链接，保留下载与语言切换。

### 移动端（< 768px）

- 主要内容改为单列。
- 灵动岛缩小到安全宽度并位于导航下方。
- 设置截图不再与展开态截图叠压。
- 下载按钮显示“仅支持 Windows”。
- 菜单打开时锁定背景滚动；Escape、链接和遮罩都可关闭菜单。

## 10. 中英双语

Astro 在构建时生成：

```text
/       简体中文
/en/    English
```

- 两种语言共享 Astro 组件和类型化文案字典。
- 每个文案键同时提供 `zh` 与 `en`，TypeScript 检查缺失键。
- 两种语言分别生成 `lang`、标题、描述、Open Graph、canonical 和 `hreflang`。
- 英文按英语产品表达重写，不逐字翻译中文。
- 语言切换不依赖 Cookie；可用 `localStorage` 记录偏好，但首次访问不自动重定向。

## 11. 最新版本与下载

仓库：`https://github.com/thisxiaoyuQAQ/LuckyIsland`
Latest Release：`https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest`
API：`https://api.github.com/repos/thisxiaoyuQAQ/LuckyIsland/releases/latest`

选择规则：

1. 忽略 draft 和 prerelease。
2. 从 `assets` 中选择名称以 `.exe` 结尾且包含 `setup`、`installer` 或 `x64` 的资源。
3. 多个资源匹配时，优先包含 `setup` 的 NSIS 安装包。
4. 成功时更新版本号、文件大小和直接下载 URL。
5. 请求失败、响应无效或没有匹配资源时，下载按钮保留 Latest Release 链接。

初始静态 HTML 的下载链接必须已经指向 Latest Release，确保 JavaScript 未执行时仍有效。请求不使用 Token、不经过 EdgeOne Function、不采集下载信息。

## 12. 技术架构

### 12.1 技术栈

- Astro 5
- TypeScript 严格模式
- Tailwind CSS v4
- Astro Components
- `motion` 12，仅用于编排式交互
- Lucide 图标
- Vitest + Testing Library
- Playwright 关键路径测试
- pnpm 锁定依赖

React 不作为运行时依赖。当前设计可以由 Astro 和少量客户端脚本完成。

### 12.2 目录

```text
WebPage/
├─ public/
│  ├─ island-compact.png
│  ├─ island-expanded.png
│  ├─ todo-page.png
│  ├─ notification-page.png
│  ├─ settings-window.png
│  ├─ fonts/
│  ├─ favicon.svg
│  ├─ og-image.png
│  └─ robots.txt
├─ src/
│  ├─ components/
│  │  ├─ Header.astro
│  │  ├─ FloatingIsland.astro
│  │  ├─ Hero.astro
│  │  ├─ ProofStrip.astro
│  │  ├─ IslandStates.astro
│  │  ├─ DailyJourney.astro
│  │  ├─ Personalization.astro
│  │  ├─ DeveloperSection.astro
│  │  ├─ TrustSection.astro
│  │  ├─ DownloadCta.astro
│  │  └─ Footer.astro
│  ├─ content/messages.ts
│  ├─ layouts/BaseLayout.astro
│  ├─ lib/releases.ts
│  ├─ lib/locale.ts
│  ├─ lib/island-state.ts
│  ├─ pages/index.astro
│  ├─ pages/en/index.astro
│  └─ styles/global.css
├─ tests/
│  ├─ releases.test.ts
│  ├─ locale.test.ts
│  ├─ content.test.ts
│  └─ website.spec.ts
├─ astro.config.mjs
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
└─ README.md
```

## 13. SEO、分享与缓存

- 中英文页面生成独立 title、description、canonical、Open Graph 和 Twitter Card 元数据。
- 生成 `sitemap.xml` 与 `robots.txt`。
- 添加 `SoftwareApplication` JSON-LD，描述 Windows、MIT、版本与下载页面。
- Open Graph 图片使用 LuckyIsland Logo 与真实展开态界面。
- HTML 使用可重新验证的缓存策略；内容哈希资源、字体和不变图片使用长期缓存。
- 不接入分析统计、Cookie banner、广告或第三方追踪脚本。

## 14. EdgeOne Pages

```text
Root directory: WebPage
Node.js: 20
Install command: pnpm install --frozen-lockfile
Build command: pnpm build
Output directory: dist
```

站点使用 Astro 静态输出，不需要 SSR 适配器、SPA fallback 或 Edge Function。`/en/` 是真实静态路径。只有需要显式缓存头或重定向时才添加 `edgeone.json`。

## 15. 可访问性与质量

- 所有交互支持键盘和可见焦点。
- 移动菜单提供 `aria-expanded`、`aria-controls` 和焦点管理。
- 产品图片使用与页面语言一致的替代文本。
- 动画不阻止阅读，Reduced Motion 模式可用。
- 不仅依靠颜色表达状态。
- JavaScript 禁用时仍能阅读、使用锚点并访问 Latest Release 与 GitHub。
- 目标 Lighthouse：Performance、Accessibility、Best Practices、SEO 四项在生产构建中均不低于 90。

## 16. 测试范围

### 单元测试

- Release 资源选择与失败降级。
- 中英文路径及 hash 保留。
- 文案键完整性。
- 灵动岛章节状态映射。

### 组件与构建测试

- 中英文页面均包含三个主要行动入口。
- 元数据、`lang`、canonical 和 `hreflang` 正确。
- 静态构建输出 `/index.html` 与 `/en/index.html`。

### 端到端测试

- 桌面导航锚点可用。
- 语言切换保留章节。
- API 成功时下载链接更新。
- API 失败时保留 Latest Release 降级链接。
- 移动菜单可由按钮、Escape 和链接关闭。
- Reduced Motion 模式下不执行滚动位移动画。

## 17. 明确不做

- 不创建后端、数据库、登录、评论、论坛或在线设置同步。
- 不复制完整 README 到多个页面。
- 不添加博客、更新日志页面或应用内在线演示。
- 不引入 Next.js、SSR、React SPA 或通用 UI 组件库。
- 不接入未经后续明确批准的分析和追踪服务。
- 不修改 LuckyIsland 桌面端源码与构建流程。

## 18. 验收清单

- [ ] 所有官网文件位于 `WebPage/`。
- [ ] 中英文静态页面内容完整且可切换。
- [ ] 真实素材使用语义文件名，未伪造界面。
- [ ] 顶部灵动岛与 Reduced Motion 降级可用。
- [ ] 直接下载与 GitHub 双目标同等清晰。
- [ ] Release API 成功与失败路径均经过测试。
- [ ] 桌面、平板和移动端无横向溢出或遮挡。
- [ ] 键盘、焦点、对比度、替代文本和语义结构满足要求。
- [ ] `pnpm test`、`pnpm build` 和 Playwright 关键路径测试通过。
- [ ] EdgeOne Pages 可按文档设置直接部署 `dist/`。