# 模块10剩余审计项并行开发计划

> 日期：2026-07-18  
> 状态：计划草案，等待用户确认执行顺序  
> 目标：在串行 TDD 门禁约束下，将 REF-10B 剩余项拆成可并行批次，明确依赖、冲突隔离和验证边界。

## 并行开发总原则

1. **主 Agent 串行 TDD**，最多一个独立只读复核 Agent，禁止大规模扇出。
2. 每批次独立 git 提交（若授权），不夹带范围外工作树改动。
3. 每批次独立 `pnpm verify` 门禁，共享 `CARGO_TARGET_DIR=.superpowers/target-check`。
4. 涉及同一文件的批次不得并行；高风险探针先复现再编码。
5. 真机矩阵（RUN-10C）只在对应实现完成后执行，不能与开发并行。

## 剩余 21 项分类

### A. 可并行开发的低风险重构（5 项）

这些不依赖高风险探针，彼此文件边界清晰，可按序或两两并行：

| 批次 | 任务 | 主要文件 | 冲突风险 | 建议并行组 |
|---|---|---|---|---|
| B1 | REF-10B-02 共享主题同步 | `src/lib/theme.ts`（新）、`src/App.tsx`、`src/ai-palette/main.tsx`、`src/settings/main.tsx`、`src/settings/SettingsApp.tsx` | 高：跨三入口 | 单独，不与 B2 并行 |
| B2 | REF-10B-03 轻量拆分 App | `src/App.tsx`、`src/lib/pages.ts`（新）、`src/lib/useIslandSettings.ts`（新）、`src/lib/useIslandEvents.ts`（新） | 高：App.tsx | 单独，不与 B1 并行 |
| B3 | REF-10B-04 SQLite migration | `src-tauri/src/storage.rs`、`src-tauri/src/migrations.rs`（新） | 中：Rust 单文件 | 可与 B1/B2 并行（不同技术栈） |
| B4 | REF-10B-05 日志脱敏轮转 | `src-tauri/src/logging.rs`（新）、`src-tauri/src/lib.rs` | 低 | 可与任何并行 |
| B5 | REF-10B-06 渐进项（拆 4 批） | 各业务页面 | 低 | 见下表拆分 |

**B5 拆分建议：**

- B5a IPC 原始响应校验：`src/lib/ai.ts`、`src/lib/settings.ts`、`src/lib/stock.ts`、`src/lib/weather.ts`
- B5b Weather 请求状态：`src/components/pages/weather/*`
- B5c AiPalette reducer/state machine：`src/ai-palette/*`
- B5d 设置 draft/persisted：`src/settings/*Panel.tsx`

B5a/b/c/d 彼此文件隔离，可全并行。

### B. 必须先复现/设计的高风险候选（6 项）

不能与开发并行；每个先独立做“复现矩阵 + 设计结论”，通过后才派生实现批次：

1. RISK-10C-01 PTY 生命周期
2. RISK-10C-02 语音下载与状态机
3. RISK-10C-03 Provider 拆分
4. RISK-10C-04 AI 动作原子性
5. RISK-10C-05 command 权限与 CSP
6. RISK-10C-06 Composition root

### C. 需要用户决策的产品项（4 项）

不编码，先投票：

1. PROD-10C-01 完整待办范围
2. PROD-10C-02 导航与专注模式
3. PROD-10C-03 通知打断/声音/窗口尺寸
4. PROD-10C-04 AI 历史过期、撤销与确认

### D. 真机矩阵（6 项）

只能在对应实现完成后执行，不能与开发并行：

1. RUN-10C-01 副屏断开/恢复
2. RUN-10C-02 NSIS lucky-notify
3. RUN-10C-03 整窗点击穿透（已决策，待实现）
4. RUN-10C-04 Release 冷启动/资源
5. RUN-10C-05 24h 长跑
6. RUN-10C-06 语音全链路

## 推荐并行启动方案

### 方案一：保守两路并行（推荐）

- 路 A：B3 SQLite migration（Rust）
- 路 B：B4 日志脱敏轮转（Rust）
- 两路文件不冲突，可同开；完成后接 B5a～d。

### 方案二：三路并行（中等风险）

- 路 A：B1 主题同步（前端，独立 App.tsx 改动）
- 路 B：B3 SQLite migration（Rust）
- 路 C：B4 日志（Rust）
- 前提：B1 完成前不动 App.tsx 的其他批次。

### 方案三：最大化并行（高风险，不推荐）

B1～B5 全开后端 + B5a～d 前端，共 7 路。App.tsx 冲突概率高，且违反串行 TDD 原则。

## 每批次标准启动语模板

复制以下任一句给对应批次 Agent 作为 system 上下文：

```
你是 LuckyIsland 模块10并行批次 B{n} 的实现 Agent。当前工作树在 main 分支，已有 AiPalette/useTimeSetting 等 listener 批的未提交改动，你不得覆盖或清理。你的批次文件边界是 {files}，目标 {goal}。遵循 TDD：先写失败测试，再最小实现，再验证。完成后运行 {verify_cmd}，输出精确测试数字。不得提交、不得 push、不得修改范围外文件。若发现范围外阻断，停止并报告，不要绕过。
```

## 并行开发起始语（可直接粘贴使用）

### 方案一：B3+B4 并行

```
启动模块10并行开发：路A为B3 SQLite版本化migration（src-tauri/src/storage.rs + src-tauri/src/migrations.rs），路B为B4日志脱敏轮转（src-tauri/src/logging.rs + src-tauri/src/lib.rs）。两路Rust文件边界隔离，主Agent串行TDD，独立Cargo target验证。先各自写RED测试，再最小实现，完成后分别运行pnpm verify并报告精确测试数。不得提交、不得push、不得夹带范围外改动。
```

### 方案二：B1+B3+B4 并行

```
启动模块10并行开发：路A为B1三窗口共享主题同步（src/lib/theme.ts + 三入口main.tsx + SettingsApp.tsx），路B为B3 SQLite migration（Rust），路C为B4日志（Rust）。B1完成前冻结App.tsx其他改动。主Agent串行TDD，每路独立verify。不得提交、不得push。
```

### 单批次 B5a 启动语（IPC 校验）

```
启动模块10批次B5a：IPC原始响应unknown校验。边界src/lib/ai.ts、settings.ts、stock.ts、weather.ts。先写Zod/手工schema失败测试，再最小实现，verify后报告数字。不得提交。
```

### 单批次 B5b 启动语（Weather 状态机）

```
启动模块10批次B5b：Weather按城市管理pending/error/generation与请求去重。边界src/components/pages/weather/*。先补并发/去重RED测试，再最小实现，verify后报告数字。不得提交。
```

### 单批次 B5c 启动语（AiPalette reducer）

```
启动模块10批次B5c：AiPalette先用reducer/state machine保护取消/晚到响应，再拆Provider/语音/UI。边界src/ai-palette/*。先写状态机RED测试，再最小实现，verify后报告数字。不得提交。
```

### 单批次 B5d 启动语（设置 draft/persisted）

```
启动模块10批次B5d：设置字段分离draft/persisted，按字段debounce/blur并显示保存错误。边界src/settings/*Panel.tsx。先写保存失败/竞态RED测试，再最小实现，verify后报告数字。不得提交。
```

## 下一步动作

请从以下选择一项：

1. 执行方案一（B3+B4 并行）；
2. 执行方案二（B1+B3+B4 并行）；
3. 只做 B5a～d 中的某一项；
4. 先处理 4 个产品决策；
5. 先启动 6 个高风险探针中的某一个复现。

确认后我会生成对应批次的详细 TDD 实施计划。