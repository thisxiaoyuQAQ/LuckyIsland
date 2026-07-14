# LuckyIsland 更新、窗口策略与七日天气 Implementation Plan

> **执行状态：** 模块 11 是当前唯一入口；Task 1 更新插件接入已由提交 `7485835` 完成，Phase 1 / Task 2 纯归约器已完成并通过独立审查；Task 3 自动化实现与验证已完成，当前等待 Step 9 Windows 真机 smoke test，未开始 Task 4。
> **For agentic workers:** 恢复执行后使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施。Steps use checkbox (`- [ ]`) syntax for tracking；已完成步骤以 `- [x]` 标记。

**Goal:** 在保持旧配置、旧通知请求和现有页面兼容的前提下，交付需求 1、2、3、5、6 及 DOC-10A-03 确认的多屏恢复契约：关于/稳定更新、统一窗口策略、整窗鼠标穿透、同屏真正全屏隐藏、悬停展开、未来七日天气，以及副屏恢复后主动移回已保存副屏。

**Architecture:** 先把 `lib.rs` 中分散的 show/hide/resize/focus 逻辑收敛到 Rust `WindowPolicy`，以纯归约器区分用户期望状态和环境抑制/临时覆盖，再让热键、悬停、全屏探测与通知只提交输入。关于/更新由独立前端状态机调用 Tauri 官方 updater 插件（Windows 安装器负责退出与重启）；天气由 Rust 供应商适配器、规范化地点和按地点缓存合成统一 `WeatherBundle`，React 只渲染 DTO 并用 request ID 防旧响应覆盖。

**Tech Stack:** Tauri 2.11、Rust 1.92 stable-msvc、React 19、TypeScript 5.8、Vite 7、Tailwind CSS v4、Vitest 4、rusqlite 0.32、reqwest 0.12、Windows API、Tauri updater v2、GitHub Actions、Open-Meteo（探针通过后使用）。

## Global Constraints

- 只实施需求 1、2、3、5、6，以及 DOC-10A-03 新增的需求 7（副屏恢复后主动移回已保存副屏）；需求 4 的插件系统、公开市场、语音/问答插件化和真正卸载仅引用 `docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md`，不得新增插件目录、Host/Bridge、manifest、市场 API、卸载入口，也不得移动/删除 `src-tauri/src/ai/*`、`src-tauri/src/voice/*`、sherpa-onnx 依赖或 DLL。
- 当前本地 `main` 基线（计划编写时）为 `df0fbc2`，包含规格提交 `d5dcd89`；当时 `origin/main` 为 `1f80ea5`。执行前必须再次 `git fetch origin` 并确认远端没有分叉；不得假设领先提交数仍不变，且未经用户授权不得为了“同步”自动 push/rebase/reset。规格已在本地 `main` 提交中，不依赖未跟踪文件。
- 当前分支固定为用户指定的 `main` 线性开发；每个可独立验收功能一次提交。不得覆盖、暂存或提交任务启动前已有的用户改动；每次 `git add` 只列本任务路径。未经明确授权不得 push、打 tag、创建 Release 或删除/改写历史。
- 灵动岛逻辑尺寸保持 720×80（紧凑）和 720×400（展开）；React 内容容器仍为最大 700px、展开内容 380px。悬停延迟固定为 enter 180ms / leave 300ms，不新增数值配置。
- 设置真源仍是 SQLite `settings(key,value)`；新增默认：`window:click_through=false`、`window:hover_expand=false`、`window:hide_in_fullscreen=false`、`update:auto_check=true`、`hotkeys:toggle_click_through=""`。`window:*`、`update:auto_check` 和 `hotkeys:*` 是 portable settings；`weather:cache:*`、更新运行态、全屏输入态和通知临时覆盖不得导出。
- 所有岛窗口 show/hide/resize/focus/ignore-cursor 效果必须经 `WindowPolicy`；AI 面板和设置窗口不是岛窗口，保留自身窗口控制。窗口 API 与异步等待不得跨 `Mutex` guard；相同有效状态不得重复应用。
- Windows 全屏检测仅支持 Windows 10/11，只看岛所在显示器的前台真正全屏窗口；普通最大化不算。非 Windows 编译必须安全 no-op，不能阻塞启动。
- 通知 `level=info|success|warn|error` 与 `priority=normal|high|critical` 分离；缺 `priority` 默认 `normal`，非法值拒绝，不能从 `level=error` 推导高优先级。
- 更新只接受 GitHub 非 draft、非 prerelease 的 stable Release；自动检查默认开，启动稳定后约 10 秒且每进程最多一次，不自动下载、不抢焦点。Tauri updater 签名失败绝不绕过；它不等同 Windows Authenticode，文档不得声称消除 SmartScreen。
- 官方 JS updater v2 当前 `Update.downloadAndInstall(onEvent, options)` 没有 AbortSignal 或正式取消 API；本轮 UI 不显示伪取消按钮。离开关于页不取消下载，状态由模块级 store 保持，等待成功或失败。
- 更新公钥写配置内容而非路径；私钥只从 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 读取，不进仓库、`.env`、日志、Artifact 或 Release。配置中的公钥占位符必须在启用发布前替换为真实公钥；占位状态允许开发构建，但发布预检必须失败。
- Windows 上锁定的 updater v2 `install_inner` 会在启动 NSIS/MSI 后执行 `std::process::exit(0)`，安装器以 `/UPDATE` 流程负责后续启动；因此 Windows 成功安装路径不再调用 JS `relaunch()`，本轮不引入 process 插件。Updater Builder 必须配置 `on_before_exit`，复用正常退出的终端/语音清理，不能依赖被 `std::process::exit` 绕过的 Tauri `RunEvent::Exit`。
- 七日预报第一步必须真实探针北京、无锡和一个区县级地点，确认中文匹配、歧义、字段、timezone、许可和中国区域可用性；若探针失败，只替换供应商适配层，不改前端 DTO。初步证据：北京/无锡和 daily forecast 成功；`滨湖区`全名无结果，`滨湖`多歧义，因此计划包含候选选择和省/市约束，不能静默选第一项。
- Weather `forecast` 允许 1..=7 天，绝不伪造缺日；日期按地点 timezone；降雨概率缺失时隐藏而非显示 0%；缓存绝不跨地点回退。
- 前端测试继续使用现有 Vitest `environment: node`，优先测试纯 TS reducer/store/helpers，不引入组件测试库；Rust 测纯逻辑和 SQLite 迁移。
- Rust 验证用独立 target 避免与用户 `pnpm tauri dev` 抢锁：以 `CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe` 为命令前缀，各任务给出完整子命令。GUI、窗口焦点、多屏、Toast 和真实安装升级由用户真机验证。
- 每次声称完成前运行该任务定向测试、相关回归、`pnpm exec tsc --noEmit`（前端任务）、`git diff --check`；若环境阻断，记录真实原因，不宣称通过。

---

## File Structure

### New files

- `src-tauri/src/window_policy.rs` — 领域状态、纯归约器、串行平台效果应用、Tauri commands/events、重要通知 generation。
- `src-tauri/src/fullscreen/mod.rs` — 500ms 生命周期、双采样稳定器、跨平台入口。
- `src-tauri/src/fullscreen/windows.rs` — Win32 前台 HWND/矩形/显示器探测；只产生布尔样本。
- `src/lib/window-policy.ts` — Rust 快照/事件类型、invoke 封装和 hover reducer。
- `src/lib/__tests__/window-policy.test.ts` — hover generation、防抖和 TS 快照契约测试。
- `src/settings/AboutPanel.tsx` — 关于、诊断、更新状态和操作 UI。
- `src/lib/update-store.ts` — 模块级 updater 状态机、每进程一次自动检查和下载进度；Windows 安装器负责退出/重启。
- `src/lib/__tests__/update-store.test.ts` — reducer、自动检查门和错误脱敏纯逻辑测试。
- `src-tauri/src/about.rs` — 非敏感诊断 DTO；单项失败降级“未知”。
- `.github/workflows/release.yml` — `v*` stable Windows 发布主路径。
- `scripts/check-version.mjs` — 校验 tag 与三处版本。
- `scripts/validate-updater-assets.mjs` — 校验 `latest.json`、NSIS、`.sig`、URL/版本/平台资产集合。
- `scripts/release-local.ps1` — 干净 main 的本机备用发布入口；默认 dry-run，显式 `-Publish` 才外发。
- `scripts/__tests__/release-scripts.test.ts` — 版本与 updater 清单 fixture 测试。
- `docs/releasing.md` — 密钥生成/备份、CI secrets、本机备用、SmartScreen 边界和故障恢复。
- `src-tauri/src/data/weather/model.rs` — `Location`、`WeatherDay`、`WeatherSourceInfo`、`WeatherBundle`。
- `src-tauri/src/data/weather/open_meteo.rs` — geocoding/forecast 原始 DTO、候选排序、WMO 映射与供应商探针。
- `src-tauri/src/data/weather/cache.rs` — location key、按地点分片缓存、旧键同地点迁移、部分降级合成。
- `src/components/pages/weather/model.ts` — 前端 DTO、星期标签、横向滚轮纯 helper。
- `src/components/pages/weather/__tests__/model.test.ts` — 天气展示 helper 与旧 request 丢弃测试。

### Existing files to modify

- `src-tauri/src/lib.rs` — 托管策略/全屏状态，注册命令，迁移岛窗口入口，注册 updater 插件和自动检查信号。
- `src-tauri/src/hotkeys.rs` — `ToggleClickThrough` 与 `Option<HotKey>` 空绑定语义。
- `src-tauri/src/monitor.rs` — 暴露岛当前物理显示器几何；副屏断开回退与恢复主动移回均保留保存选择/偏移，并在完成定位后提交策略重应用而非直接聚焦。
- `src-tauri/src/notify/mod.rs`, `src-tauri/src/notify/server.rs`, `src-tauri/src/bin/lucky-notify.rs` — priority、迁移后查询和策略展示请求。
- `src-tauri/src/storage/mod.rs` — 幂等通知列迁移、portable update key、天气缓存不导出测试。
- `src-tauri/src/data/weather/mod.rs` — 把旧单文件天气入口变成分层 module facade，保留命令名。
- `src-tauri/src/data/mod.rs` — 继续导出 `weather` module；转换后路径不变、通常无需语义修改，仅在编译需要时调整。
- `src-tauri/src/settings_window.rs` — 导入完成后重新应用窗口策略/全屏/热键；运行时设置不导入。
- `src/App.tsx` — 消费结构化快照、报告 hover、移除通知直接展开裁决。
- `src/lib/settings.ts` — 新 keys/defaults、window-policy wrappers、热键文档与空默认。
- `src/settings/GeneralPanel.tsx` — 三个窗口策略 Switch、错误回滚和平台说明。
- `src/settings/HotkeysPanel.tsx` — 空默认的正确显示/单项恢复。
- `src/settings/SettingsApp.tsx`, `src/settings/shared.tsx` — 可滚动侧栏、底部 About、共享表单行。
- `src/components/pages/notify/NotifyCard.tsx`, `src/components/pages/notify/NotifyPage.tsx` — priority 类型与展示；通知页不再裁决窗口。
- `src/components/pages/weather/WeatherPage.tsx`, `src/settings/WeatherPanel.tsx` — `WeatherBundle`、候选地点、request ID、横向七日卡。
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`, `pnpm-lock.yaml` — updater 依赖和 Windows API features。
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/settings.json` — updater artifacts、stable endpoint、公钥和最小权限；`src-tauri/capabilities/default.json` 保持不授予 updater。
- `README.md`, `docs/Claude-Codex-hook配置.md`, `docs/开发进度.md`, `项目备忘录.md`, `vault/11-更新窗口策略与七日天气.md` — 用户文档、priority 示例、验收状态与稳定边界。

---

## Phase 0: Baseline and guarded dependencies

### Task 1: Capture baseline and add the updater dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/settings.json`
- Test: existing Rust/TS suites

**Interfaces:**
- Produces: registered updater plugin from `setup` using `tauri_plugin_updater::Builder::new().on_before_exit(cleanup).build()`, shared `cleanup_runtime_resources`, JS package `@tauri-apps/plugin-updater`, and settings-window permission `updater:default`.
- The process plugin is not required for the Windows path because updater installation exits into NSIS; do not add `@tauri-apps/plugin-process`, `tauri-plugin-process`, or `process:allow-restart` unless a separately tested non-Windows path is later implemented.
- Does not yet produce UI, update checks, `createUpdaterArtifacts`, real public key, or release output.

- [x] **Step 1: Capture the pre-feature baseline without modifying code**

Run:

```bash
git fetch origin
git log --oneline --left-right origin/main...HEAD
git status --short
pnpm test
pnpm exec tsc --noEmit
pnpm build
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: `origin/main...HEAD` shows only known local specification/gallery commits on the right and no unexpected remote-only commits on the left; do not hard-code their count because origin may advance before execution. Preserve the initial `git status` path list separately. Vitest/tsc/build/Rust lib tests pass. If remote-only commits appear, stop and ask how to reconcile main. If a command is blocked by the known mirror or an active `tauri dev`, record it before continuing and do not treat it as a product regression.

- [x] **Step 2: Add pinned-to-major official dependencies**

Run:

```bash
pnpm add @tauri-apps/plugin-updater@^2
```

Add under `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
tauri-plugin-updater = "2"
```

Expected: package/lock and Cargo/lock pairs change; no process or plugin-market dependency appears.

- [x] **Step 3: Register the Rust updater plugin with pre-exit cleanup**

Add one shared helper in `src-tauri/src/lib.rs` and use it from both updater installation and normal exit:

```rust
fn cleanup_runtime_resources(app: &tauri::AppHandle) {
    if let Some(registry) = app.try_state::<TerminalRegistry>() {
        terminal::cleanup_all(registry.inner());
    }
    if let Some(state) = app.try_state::<VoiceState>() {
        let _ = voice_stop_listening(state);
    }
}
```

Register the updater during `.setup(...)` so its Windows `std::process::exit(0)` path cannot bypass terminal/voice cleanup:

```rust
let updater_app = app.handle().clone();
app.handle().plugin(
    tauri_plugin_updater::Builder::new()
        .on_before_exit(move || cleanup_runtime_resources(&updater_app))
        .build(),
)?;
```

The existing `RunEvent::Exit` branch calls the same helper. Do not call the updater yet.

- [x] **Step 4: Grant the settings window minimum update permissions**

Change `src-tauri/capabilities/settings.json` permissions to include:

```json
[
  "core:default",
  "dialog:default",
  "opener:default",
  "updater:default"
]
```

`default.json` (island) does not get updater permission.

- [x] **Step 5: Keep updater config disabled until the real key task**

Do not add a dummy `pubkey` or enable `createUpdaterArtifacts` here. Add only a plan comment in the commit body if needed; `tauri.conf.json` remains valid and release-incapable until Task 11.

- [x] **Step 6: Verify dependency registration**

Run:

```bash
pnpm exec tsc --noEmit
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe check --manifest-path src-tauri/Cargo.toml --lib
git diff --check
```

Expected: all pass; `git diff --name-only` contains only Task 1 paths plus pre-existing user paths (which remain unstaged).

- [x] **Step 7: Commit only dependency/setup files**

```bash
git add package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/settings.json
git commit -m "chore(update): 接入 Tauri 更新插件"
```

Task 1 completion evidence: commit `7485835` (`chore(update): 接入 Tauri 更新插件`).

---

## Phase 1: Unified window policy

### Task 2: Implement the pure window-policy reducer

**Files:**
- Create: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/window_policy.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: no Tauri window; pure reducer is platform-independent.
- Produces:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState { Hidden, Compact, Expanded }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusIntent { Preserve, Focus }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowPolicyInputs {
    pub desired_state: IslandState,
    pub hover_expand: bool,
    pub hovered: bool,
    pub click_through: bool,
    pub hide_in_fullscreen: bool,
    pub fullscreen_block: bool,
    pub priority_override_generation: u64,
    pub priority_override_active: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowDecision {
    pub effective_state: IslandState,
    pub focus: FocusIntent,
}

pub fn reduce(inputs: WindowPolicyInputs, focus: FocusIntent) -> WindowDecision;
```

- [x] **Step 1: Write failing reducer tests**

Add tests before implementation:

```rust
#[test]
fn user_hidden_beats_priority_override() {
    let decision = reduce(inputs(IslandState::Hidden, true, true), FocusIntent::Preserve);
    assert_eq!(decision.effective_state, IslandState::Hidden);
}

#[test]
fn priority_override_beats_fullscreen_without_focus() {
    let decision = reduce(inputs(IslandState::Compact, true, true), FocusIntent::Focus);
    assert_eq!(decision, WindowDecision {
        effective_state: IslandState::Expanded,
        focus: FocusIntent::Preserve,
    });
}

#[test]
fn fullscreen_hides_normal_state() {
    let decision = reduce(inputs(IslandState::Compact, true, false), FocusIntent::Focus);
    assert_eq!(decision.effective_state, IslandState::Hidden);
}

#[test]
fn hover_only_expands_compact_non_click_through() {
    let mut i = inputs(IslandState::Compact, false, false);
    i.fullscreen_block = false;
    i.hover_expand = true;
    i.hovered = true;
    assert_eq!(reduce(i, FocusIntent::Preserve).effective_state, IslandState::Expanded);
    i.click_through = true;
    assert_eq!(reduce(i, FocusIntent::Preserve).effective_state, IslandState::Compact);
}

#[test]
fn pointer_leave_never_collapses_explicit_expanded() {
    let mut i = inputs(IslandState::Expanded, false, false);
    i.fullscreen_block = false;
    assert_eq!(reduce(i, FocusIntent::Preserve).effective_state, IslandState::Expanded);
}
```

The test helper `inputs(desired, fullscreen_block, override_active)` returns defaults for all unspecified fields.

- [x] **Step 2: Run the tests and confirm failure**

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
```

Expected: FAIL because `window_policy` and reducer types do not exist.

- [x] **Step 3: Implement the reducer exactly in priority order**

Core body:

```rust
pub fn reduce(inputs: WindowPolicyInputs, requested_focus: FocusIntent) -> WindowDecision {
    if inputs.desired_state == IslandState::Hidden {
        return WindowDecision { effective_state: IslandState::Hidden, focus: FocusIntent::Preserve };
    }
    if inputs.priority_override_active {
        return WindowDecision { effective_state: IslandState::Expanded, focus: FocusIntent::Preserve };
    }
    if inputs.hide_in_fullscreen && inputs.fullscreen_block {
        return WindowDecision { effective_state: IslandState::Hidden, focus: FocusIntent::Preserve };
    }
    if inputs.desired_state == IslandState::Compact
        && inputs.hover_expand
        && inputs.hovered
        && !inputs.click_through
    {
        return WindowDecision { effective_state: IslandState::Expanded, focus: FocusIntent::Preserve };
    }
    WindowDecision { effective_state: inputs.desired_state, focus: requested_focus }
}
```

- [x] **Step 4: Register the module and run tests**

Add `mod window_policy;` in `src-tauri/src/lib.rs`, then run the Task 2 command.

Expected: all new reducer tests pass.

- [ ] **Step 5: Commit the pure domain layer**

> 2026-07-14：实现与验证已完成；因用户明确要求本轮不 commit，本步骤有意保留未勾选，不影响 Task 3 继续在当前工作树实施。

```bash
git add src-tauri/src/window_policy.rs src-tauri/src/lib.rs
git commit -m "feat(window): 建立统一窗口策略归约器"
```

Task 2 completion evidence (2026-07-14): RED confirmed missing reducer symbols; focused reducer 6/6 and full Rust lib 54/54 passed; `cargo check --lib`, targeted `rustfmt --check`, and `git diff --check` passed. Five expected `dead_code` warnings remain until Task 3 consumes the pure domain API. No Tauri/window/effect/event/persistence code exists in `window_policy.rs`.

### Task 3: Apply policy effects and migrate all existing island entry points

**Files:**
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/monitor.rs`
- Create: `src/lib/window-policy.ts`
- Modify: `src/App.tsx`
- Test: `src-tauri/src/window_policy.rs`

**Interfaces:**
- Consumes: Task 2 reducer.
- Produces:

```rust
pub struct WindowPolicy(Mutex<WindowPolicyRuntime>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicySnapshot {
    pub desired_state: IslandState,
    pub effective_state: IslandState,
    pub should_focus: bool,
    pub click_through: bool,
    pub hover_expand: bool,
    pub hovered: bool,
    pub hide_in_fullscreen: bool,
    pub fullscreen_supported: bool,
    pub fullscreen_block: bool,
    pub priority_override_active: bool,
    pub priority_override_generation: u64,
}

pub fn set_desired_state(app: &AppHandle, state: IslandState, focus: FocusIntent) -> Result<WindowPolicySnapshot, String>;
pub fn toggle_visibility(app: &AppHandle) -> Result<WindowPolicySnapshot, String>;
pub fn reapply(app: &AppHandle) -> Result<WindowPolicySnapshot, String>;
pub fn reload_persisted_settings(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String>;
#[tauri::command]
pub fn window_policy_get(app: AppHandle, policy: State<'_, WindowPolicy>) -> Result<WindowPolicySnapshot, String>;
#[tauri::command]
pub fn set_island_state(app: AppHandle, policy: State<'_, WindowPolicy>, state: String) -> Result<WindowPolicySnapshot, String>;
```

TypeScript mirrors the camelCase snapshot and exports `windowPolicyGet()` / `setIslandState(state)`.

- [x] **Step 1: Add failing state-transition and dedup tests**

Extract a testable `EffectPlan::between(previous, next)` and test:

```rust
#[test]
fn identical_effective_decision_has_no_platform_effects() {
    assert_eq!(EffectPlan::between(decision(IslandState::Compact), decision(IslandState::Compact)), EffectPlan::default());
}

#[test]
fn hidden_to_expanded_orders_resize_show_then_focus() {
    assert_eq!(EffectPlan::between(decision(IslandState::Hidden), focused(IslandState::Expanded)).ops,
        vec![WindowOp::ResizeExpanded, WindowOp::Show, WindowOp::Focus]);
}

#[test]
fn focus_is_not_repeated_when_only_non_visual_inputs_change() {
    let mut next = focused(IslandState::Compact);
    next.focus = FocusIntent::Preserve;
    assert!(EffectPlan::between(focused(IslandState::Compact), next).ops.is_empty());
}
```

- [x] **Step 2: Verify failure**

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
```

> 2026-07-14 RED 已确认：全套 `window_policy::tests` 9/10；`explicit_focus_applies_when_state_is_already_visible` 期望 `[Focus]`、实际 `[]`。同时 `rustfmt --check` 指出该预备测试格式待修。下一执行者从 Step 3 修复开始，不得重建 Step 1/2。

- [x] **Step 3: Implement short-lock snapshot/update/apply**

Required ordering:

```rust
let (previous, inputs, generation) = {
    let mut runtime = policy.0.lock().map_err(|e| e.to_string())?;
    let previous = runtime.last_applied;
    mutate(&mut runtime.inputs);
    runtime.operation_generation += 1;
    (previous, runtime.inputs, runtime.operation_generation)
}; // lock released
let decision = reduce(inputs, focus);
apply_effects(&window, previous, decision)?;
let snapshot = {
    let mut runtime = policy.0.lock().map_err(|e| e.to_string())?;
    if runtime.operation_generation != generation {
        drop(runtime);
        return reapply(app);
    }
    runtime.last_applied = Some(decision);
    snapshot(&runtime)
};
emit_snapshot(app, &snapshot)?;
```

Use 720×80/720×400. Only an explicit user action gets `FocusIntent::Focus`; priority/fullscreen/hover use `Preserve`. Do not persist a value until the platform effect succeeds.

- [x] **Step 4: Emit only structured events**

Use:

```text
window://state-changed  -> WindowPolicySnapshot
window://policy-changed -> WindowPolicySnapshot
```

Both may carry the same snapshot during migration. Remove free-string emitters from `lib.rs` now. `notify/mod.rs` still emits the legacy string only until Task 8 migrates notification presentation; add an explicit temporary compatibility test, then remove it in Task 8. After Task 8 only `window_policy` may emit these names.

- [x] **Step 5: Migrate entry points in `lib.rs`**

Replace `apply_state`, `set_state_and_emit`, and old `toggle_visibility` with policy calls:

- single-instance callback → desired `Compact`, focus user-visible;
- global `ToggleIsland` → `window_policy::toggle_visibility`;
- tray item and left-click → same toggle;
- startup → read validated settings into `WindowPolicyInputs`, build `WindowPolicy::new(inputs)`, `app.manage(policy)`, then call `reapply`;
- `set_island_state` command remains the public command name but parses strictly and returns error for unknown strings.

Do not alter AI palette or settings window behavior.

- [x] **Step 6: Make monitor recovery policy-aware and restore reconnected selections**

In `monitor.rs`, replace `recover_island_to_monitor`'s unconditional `show()+set_focus()` with size/unminimize/position recovery followed by `window_policy::reapply(app)`. `monitor_select` still only moves position. When a saved concrete secondary display becomes available after a fallback cycle, resolve that saved display, move the island back with the persisted offsets, and only then emit `monitor://changed(fallback=false)`; if movement fails, keep the fallback state and retry on a later watch iteration instead of broadcasting a false recovery. Add regression tests for the disconnect/reconnect state transition and for the recovery helper not encoding a focus operation.

- [x] **Step 7: Add TypeScript contract wrappers and migrate `App.tsx`**

`src/lib/window-policy.ts`:

```ts
export type IslandState = "hidden" | "compact" | "expanded";
export interface WindowPolicySnapshot {
  desiredState: IslandState;
  effectiveState: IslandState;
  shouldFocus: boolean;
  clickThrough: boolean;
  hoverExpand: boolean;
  hovered: boolean;
  hideInFullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenBlock: boolean;
  priorityOverrideActive: boolean;
  priorityOverrideGeneration: number;
}
```

In `App.tsx`:

- render/animate from `snapshot.effectiveState`;
- explicit buttons call `setIslandState` but do not optimistically overwrite state before success;
- keep the 280ms compact shrink animation, but after the delay call policy command and accept returned snapshot;
- listener payload is `WindowPolicySnapshot`, not string;
- notification listener only switches page; remove `setState("expanded")` because backend policy owns display.

- [x] **Step 8: Run focused and compatibility verification**

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml monitor::tests -- --nocapture
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: pass. Before Task 8, grep may find the one documented legacy notification string emit in `notify/mod.rs`; all other `window://state-changed` emits are in `window_policy.rs`, and no island `show/hide/set_focus` remains in `lib.rs`. Task 8 removes the notification exception and its direct show/focus calls.

- [x] **Step 9: User smoke-test the legacy contract**

2026-07-14 用户确认修复已通过 Windows 真机验证：Alt+X、托盘、显式展开/收起、Escape、单实例唤醒、显示器切换以及副屏断开/重连恢复契约均可继续；Task 3 自动化与真机门禁完成。

Ask user to verify: Alt+X, tray click, explicit expand/collapse, Escape collapse, single-instance wake and monitor switching still work; disconnecting the selected secondary display falls back to primary, reconnecting it actively returns the island to the saved display with offsets preserved, and automatic monitor recovery does not unexpectedly steal focus.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/window_policy.rs src-tauri/src/lib.rs src-tauri/src/monitor.rs src/lib/window-policy.ts src/App.tsx
git commit -m "refactor(window): 统一灵动岛窗口状态入口"
```

---

## Phase 2: Click-through and hover

### Task 4: Support explicit unbound values in the hotkey domain

**Files:**
- Modify: `src-tauri/src/hotkeys.rs`
- Modify: `src/lib/settings.ts`
- Modify: `src/settings/HotkeysPanel.tsx`
- Test: `src-tauri/src/hotkeys.rs`

**Interfaces:**
- Produces `Action::default_binding() -> Option<&'static str>` and `current_binding(db, action) -> Option<HotKey>` while preserving UI serialization as `binding: string`, `default: string`, where `""` means unbound. Task 5 uses this domain support when it adds `ToggleClickThrough`.

- [x] **Step 1: Write failing explicit-unbound tests**

```rust
#[test]
fn explicit_empty_value_is_valid_unbound_not_default_fallback() {
    assert_eq!(binding_from_stored(Some(""), Action::ToggleIsland), None);
}

#[test]
fn missing_value_still_uses_existing_defaults() {
    assert_eq!(binding_from_stored(None, Action::ToggleIsland).unwrap().into_string(), "alt+KeyX");
    assert_eq!(binding_from_stored(None, Action::ToggleAi).unwrap().into_string(), "alt+Space");
}

#[test]
fn existing_default_collision_check_only_counts_bound_defaults() {
    let ids = default_hotkey_ids();
    assert_eq!(ids.len(), 2);
}
```

- [x] **Step 2: Verify failure**

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml hotkeys::tests -- --nocapture
```

2026-07-14 RED 已确认：`binding_from_stored` 与 `default_hotkey_ids` 尚不存在，`hotkeys::tests` 因 4 个 E0425 编译错误失败。

Expected: FAIL because the domain currently turns empty into an invalid value and falls back to a default.

- [x] **Step 3: Implement Option semantics without adding the new action yet**

Rules:

- missing DB key → action default (`Some` for the two existing actions);
- explicit empty DB value → `None`;
- non-empty invalid stored value → fall back to default on startup/list, but `hotkeys_apply` returns the parse error for newly submitted invalid text;
- `apply` skips `None`, returns `{ok:true,binding:"",error:null}`, and does not put it in `HotkeyMap`;
- reset deletes keys and restores each action's optional default;
- conflicts/default collision sets contain only bound IDs.

- [x] **Step 4: Update TypeScript documentation/UI for empty defaults**

Document empty current/default bindings in `HotkeyEntry`. In `HotkeysPanel`, render `默认：未设置`; “恢复默认” may set `""`; saving an empty draft is valid and shows no error. Existing actions still have non-empty defaults until Task 5.

- [x] **Step 5: Verify**

2026-07-14：`hotkeys::tests` 9/9、`pnpm exec tsc --noEmit`、`rustfmt --check src-tauri/src/hotkeys.rs` 与 Task 4 文件 `git diff --check` 通过；仅有既有 LF→CRLF 提示。显式空值现在保持未绑定，缺失/非法存量按可选默认规则处理，未加入 Task 5 的新动作。

Run the Task 4 Rust command, `pnpm exec tsc --noEmit`, and `git diff --check`.

Expected: tests pass; explicitly clearing an existing action persists as unbound instead of falling back.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/hotkeys.rs src/lib/settings.ts src/settings/HotkeysPanel.tsx
git commit -m "feat(hotkeys): 支持显式未绑定状态"
```

### Task 5: Implement click-through persistence, setting and global action

**Files:**
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/hotkeys.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/settings_window.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/window-policy.ts`
- Modify: `src/lib/settings.ts`
- Modify: `src/settings/GeneralPanel.tsx`
- Modify: `src/settings/HotkeysPanel.tsx`
- Test: `src-tauri/src/window_policy.rs`, `src-tauri/src/hotkeys.rs`, storage portable tests

**Interfaces:**
- Produces:

```rust
pub const CLICK_THROUGH_KEY: &str = "window:click_through";
#[tauri::command]
pub fn window_click_through_set(app: AppHandle, db: State<Db>, enabled: bool) -> Result<WindowPolicySnapshot, String>;
pub fn toggle_click_through(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String>;

// hotkeys.rs
Action::ToggleClickThrough
// id: toggle_click_through; label: 开启/关闭鼠标穿透; default_binding: None
```

- JS: `windowClickThroughSet(enabled): Promise<WindowPolicySnapshot>`.

- [x] **Step 1: Write failing transaction-order tests**

Introduce a small mockable `PlatformEffects`/`SettingsWriter` seam and test:

```rust
#[test]
fn enabling_click_through_clears_hover_before_reduce() {
    let snapshot = apply_click_through(&mut harness(), true).unwrap();
    assert!(!snapshot.hovered);
    assert!(snapshot.click_through);
}

#[test]
fn failed_ignore_cursor_does_not_persist_or_publish_enabled() {
    let mut h = harness();
    h.platform.fail_ignore_cursor = true;
    assert!(apply_click_through(&mut h, true).is_err());
    assert_eq!(h.settings.get(CLICK_THROUGH_KEY), None);
    assert!(h.emitted.is_empty());
}

#[test]
fn startup_restore_failure_falls_back_to_false_snapshot() {
    let mut h = harness_with_setting(CLICK_THROUGH_KEY, "true");
    h.platform.fail_ignore_cursor = true;
    let snapshot = restore_click_through(&mut h).unwrap();
    assert!(!snapshot.click_through);
}
```

- [x] **Step 2: Verify failure**

2026-07-14 RED 已确认：事务函数尚不存在，首次编译出现对应 E0425；最小实现后启动恢复失败用例继续以实际错误失败，证明安全回退分支尚未实现。

Run the window-policy Rust test command. Expected: FAIL.

- [x] **Step 3: Implement apply-first, persist-second semantics**

For explicit setting:

1. capture previous input;
2. call `island.set_ignore_cursor_events(enabled)` without holding lock;
3. if it fails, restore previous inputs and return structured string error;
4. when enabling, set `hovered=false` in the same policy update;
5. persist `window:click_through` only after platform success;
6. emit actual snapshot.

At startup, read bool and attempt platform restore. If restore fails, keep runtime `false`; attempt to write `false`; emit actual state. The settings window itself is never modified. Both `window_click_through_set` and the global-action path call one shared `set_click_through(app, db, enabled)` transaction; the hotkey computes `enabled = !snapshot.click_through`, avoiding duplicate effect/persistence code.

- [x] **Step 4: Add and dispatch the default-unbound global action**

Extend `ALL_ACTIONS`, id/label parsing/list serialization and tests with `ToggleClickThrough`; its default is `None`, so reset leaves it unbound and startup still registers only the two historical defaults. Dispatch through the same persistent policy transaction:

```rust
hotkeys::Action::ToggleClickThrough => {
    let db = app.state::<Db>();
    if let Err(error) = window_policy::toggle_click_through(app, db.inner()) {
        eprintln!("[window-policy] 切换鼠标穿透失败：{error}");
    }
}
```

Add action roundtrip/default-unbound/conflict tests and extend the portable-setting test for `hotkeys:toggle_click_through`.

- [x] **Step 5: Reapply imported settings, then add wrappers and UI**

In `settings_window::config_import`, detect `window:click_through`, `window:hover_expand`, `window:hide_in_fullscreen`, `update:auto_check` among old/new keys. After DB transaction, spawn a worker that calls a single `window_policy::reload_persisted_settings(&app, &db)` and full-screen controller reconciliation. The existing per-key `settings://changed` events handle `update:auto_check` in the frontend store. Do not call Tauri main-thread APIs synchronously under SQLite lock. `reload_persisted_settings` applies click-through first; if that platform effect fails it forces/persists false, while independent hover/fullscreen values still load and the failure is emitted/logged as actual state rather than leaving UI/data divergence.

Add keys/defaults in `src/lib/settings.ts`, expose `windowClickThroughSet`, update `HotkeysPanel` comments/list expectations for the third action, then add the GeneralPanel row:

```tsx
<Row label="鼠标穿透" desc="整座灵动岛不再接收鼠标；可从本设置页或已绑定全局热键恢复">
  <Switch checked={clickThrough} onCheckedChange={toggleClickThrough} />
</Row>
```

Optimistically set UI only if desired, but on command failure query `windowPolicyGet()` and roll back to snapshot value; show an inline error, not only `console.error`.

- [x] **Step 6: Verify and user-test**

2026-07-14 自动化通过：`window_policy::tests` 17/17、`hotkeys::tests` 10/10、`storage::portable_tests` 2/2、TypeScript、三入口 build 与 Task 5 diff check；build 仅有既有主 chunk >500 kB 警告。用户确认 Windows 真机正常运行，覆盖设置开关、整窗点击落到后方窗口、重启持久化、设置页恢复、默认空热键及绑定后跨应用切换。

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml hotkeys::tests -- --nocapture
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml storage::portable_tests -- --nocapture
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

User verifies clicks reach the window behind the island; restart preserves; settings window remains clickable and can turn it off; bound shortcut works from another app; empty shortcut is valid.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/window_policy.rs src-tauri/src/hotkeys.rs src-tauri/src/storage/mod.rs src-tauri/src/settings_window.rs src-tauri/src/lib.rs src/lib/window-policy.ts src/lib/settings.ts src/settings/GeneralPanel.tsx src/settings/HotkeysPanel.tsx
git commit -m "feat(window): 增加持久化整窗鼠标穿透"
```

### Task 6: Add debounced hover expansion

**Files:**
- Modify: `src/lib/window-policy.ts`
- Create: `src/lib/__tests__/window-policy.test.ts`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src/settings/GeneralPanel.tsx`
- Test: TS and Rust policy tests

**Interfaces:**
- Produces Rust commands `window_hover_set(hovered)` and `window_hover_expand_set(app, db, enabled) -> WindowPolicySnapshot`; TypeScript wrappers `windowHoverSet(hovered)` / `windowHoverExpandSet(enabled)` and `createHoverController({enterDelay:180, leaveDelay:300, submit})` with `enter()`, `leave()`, `disable()`, `dispose()`.

- [x] **Step 1: Write fake-timer hover tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHoverController } from "../window-policy";

afterEach(() => vi.useRealTimers());

it("quick pass never submits true", () => {
  vi.useFakeTimers(); const submit = vi.fn();
  const h = createHoverController({ enterDelay: 180, leaveDelay: 300, submit });
  h.enter(); vi.advanceTimersByTime(100); h.leave(); vi.advanceTimersByTime(400);
  expect(submit).not.toHaveBeenCalledWith(true);
});

it("opposite events invalidate stale generations", () => {
  vi.useFakeTimers(); const submit = vi.fn();
  const h = createHoverController({ enterDelay: 180, leaveDelay: 300, submit });
  h.enter(); vi.advanceTimersByTime(180);
  h.leave(); vi.advanceTimersByTime(100);
  h.enter(); vi.advanceTimersByTime(300);
  expect(submit.mock.calls).toEqual([[true], [true]]);
});

it("disable and dispose clear timers and submit false once", () => {
  vi.useFakeTimers(); const submit = vi.fn();
  const h = createHoverController({ enterDelay: 180, leaveDelay: 300, submit });
  h.enter(); vi.advanceTimersByTime(180);
  h.disable(); h.dispose(); vi.runAllTimers();
  expect(submit.mock.calls).toEqual([[true], [false]]);
});
```

- [x] **Step 2: Verify failure**

2026-07-14 RED 已确认：三个 fake-timer 用例因 `createHoverController` 不存在而失败（3 failed / 3 existing passed）；后端 hover 规则测试因 `apply_hover_report` / `apply_hover_expand_setting` 缺失产生 4 个 E0425。

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
```

Expected: FAIL because controller does not exist.

- [x] **Step 3: Implement generation-based controller**

Use a monotonically increasing `generation` and one timeout. Each callback captures generation and exits if stale. `disable()`/`dispose()` clear timeout; `disable()` submits false if active. No React imports in this pure module.

- [x] **Step 4: Add backend hover command**

`window_hover_set` updates only `hovered`; if `hover_expand=false` or `click_through=true`, coerce false. It uses `FocusIntent::Preserve` and never persists transient hovered state. Add reducer transition tests. Both hover commands are registered in `generate_handler!`, and `src/lib/window-policy.ts` invokes them with Tauri camelCase arguments.

- [x] **Step 5: Wire the island outer container**

Attach `onPointerEnter`/`onPointerLeave` to the outer `motion.div`. On mount load policy snapshot; enable controller only when `hoverExpand && !clickThrough`; react to policy events. Cleanup must call `dispose()` and submit false. Frontend must not call `setIslandState("expanded")` from hover.

- [x] **Step 6: Add persistent hover setting with rollback**

Add `window:hover_expand` Switch, default false. `window_hover_expand_set` updates policy, persists only after policy reapply succeeds, emits the actual snapshot, and clears `hovered` immediately when disabling. GeneralPanel calls this dedicated command—not generic `setting_set_and_emit`—and rolls back to the returned/queried snapshot on failure. Turning click-through on also disables the controller through the emitted snapshot.

- [ ] **Step 7: Verify and user-test**

Run TS fake-timer test, Rust window-policy tests, tsc/build/diff-check. User verifies: quick pass stays compact; 180ms enter expands; 300ms leave collapses only a hover expansion; manual expanded remains expanded; click-through pauses hover.

- [ ] **Step 8: Commit**

```bash
git add src/lib/window-policy.ts src/lib/__tests__/window-policy.test.ts src/App.tsx src-tauri/src/window_policy.rs src/settings/GeneralPanel.tsx
git commit -m "feat(window): 增加可配置悬停展开"
```

---

## Phase 3: Fullscreen suppression and notification priority

### Task 7: Detect true fullscreen on the island monitor

**Files:**
- Create: `src-tauri/src/fullscreen/mod.rs`
- Create: `src-tauri/src/fullscreen/windows.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src/lib/settings.ts`
- Modify: `src/settings/GeneralPanel.tsx`
- Test: `src-tauri/src/fullscreen/mod.rs`

**Interfaces:**
- Consumes `monitor::island_monitor_rect(app)` and produces:

```rust
pub fn set_fullscreen_block(app: &AppHandle, blocked: bool) -> Result<WindowPolicySnapshot, String>;
// When blocked changes true -> false, this function atomically clears priority_override_active
// and increments priority_override_generation before reducing/applying the new decision.
pub const HIDE_IN_FULLSCREEN_KEY: &str = "window:hide_in_fullscreen";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
pub fn covers_monitor(window: PhysicalRect, monitor: PhysicalRect, tolerance: i32) -> bool;
pub struct FullscreenController { enabled: AtomicBool, shutdown: AtomicBool }
pub fn start(app: AppHandle);
pub fn set_enabled(&self, enabled: bool);
#[tauri::command]
pub fn window_hide_in_fullscreen_set(app: AppHandle, db: State<'_, Db>, enabled: bool) -> Result<WindowPolicySnapshot, String>;
```

- [ ] **Step 1: Add required Windows features**

Extend the existing `windows = { version="0.61", features=["Win32_Media_Speech", "Win32_System_Com"] }` dependency with:

```toml
"Win32_Foundation",
"Win32_Graphics_Gdi",
"Win32_UI_WindowsAndMessaging"
```

Do not add another Windows crate version.

- [ ] **Step 2: Write pure geometry/stability tests**

Cover exact monitor, ±2px tolerance, work-area maximized (taskbar gap => false), different monitor, minimized/invisible filtered sample, and two-consecutive-sample debouncer:

```rust
assert!(covers_monitor(rect(0,0,1920,1080), rect(0,0,1920,1080), 2));
assert!(!covers_monitor(rect(0,0,1920,1040), rect(0,0,1920,1080), 2));
assert_eq!(StableSample::default().push(true), None);
assert_eq!(sample.push(true), Some(true));
```

- [ ] **Step 3: Verify failure and implement pure logic**

Run the exact full-screen test command:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml fullscreen::tests -- --nocapture
```

Expected initial FAIL, then PASS after pure implementation. Centralize tolerance as `FULLSCREEN_EDGE_TOLERANCE_PX: i32 = 2` and interval 500ms.

- [ ] **Step 4: Implement Win32 sampling behind `#[cfg(windows)]`**

Use exact locked APIs:

```text
GetForegroundWindow
GetDesktopWindow / GetShellWindow
IsWindowVisible / IsIconic
GetWindowRect
MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
GetMonitorInfoW
island.hwnd()
```

Exclude null HWND, island/settings/AI HWNDs, desktop/shell, invisible, iconic, invalid/non-positive rect. Compare foreground `HMONITOR` to the island's current `HMONITOR`; use `MONITORINFO.rcMonitor`, not `rcWork`. On any API failure return `Sample::Unknown`; caller retains last reliable result.

- [ ] **Step 5: Implement non-Windows no-op and lifecycle**

The loop sleeps while disabled; enabling begins samples; disabling clears stable state and calls `set_fullscreen_block(false)` exactly once. `RunEvent::Exit` sets shutdown. Never hold policy or DB locks during Win32 calls/sleep.

- [ ] **Step 6: Persist setting through a command**

Add `window_hide_in_fullscreen_set(enabled)` that writes only after controller state/policy reconciliation succeeds, then emits the actual snapshot; GeneralPanel calls this dedicated command rather than generic `setting_set_and_emit` and rolls back on failure. Add `window:hide_in_fullscreen` default false and Switch. Set snapshot `fullscreenSupported=cfg!(windows)`; on non-Windows disable the control and show “当前仅支持 Windows 10/11”; Windows build enables it. Register the command in `generate_handler!` and add its TypeScript wrapper.

- [ ] **Step 7: Verify and user-test**

Run fullscreen/window-policy/monitor tests, cargo check, tsc/build/diff-check. User tests browser F11/video, PowerPoint, borderless game, normal maximize, Alt+Tab, two displays, fullscreen on non-island monitor, and display disconnect.

Expected: only true fullscreen on island screen hides after two stable samples; normal maximize and other monitor do not; exit restores latest desired state.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/fullscreen src-tauri/src/lib.rs src-tauri/src/monitor.rs src-tauri/src/window_policy.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src/lib/settings.ts src/settings/GeneralPanel.tsx
git commit -m "feat(window): 同屏全屏时自动隐藏灵动岛"
```

### Task 8: Add notification priority and policy-controlled delivery

**Files:**
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/notify/mod.rs`
- Modify: `src-tauri/src/notify/server.rs`
- Modify: `src-tauri/src/bin/lucky-notify.rs`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src/components/pages/notify/NotifyCard.tsx`
- Modify: `src/components/pages/notify/NotifyPage.tsx`
- Modify: `docs/Claude-Codex-hook配置.md`
- Test: Rust storage/notify/window-policy tests

**Interfaces:**
- Produces:

```rust
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NotifyPriority { Normal, High, Critical }
impl Default for NotifyPriority { Normal }

NotifyInput {
    title: String,
    body: Option<String>,
    source: String,
    level: String,
    priority: NotifyPriority,
    action: Option<NotifyAction>,
}
Notification {
    id: String,
    title: String,
    body: Option<String>,
    source: String,
    level: String,
    priority: NotifyPriority,
    created_at: i64,
    read: bool,
    action: Option<NotifyAction>,
}

pub fn present_notification(app: &AppHandle, priority: NotifyPriority) -> Result<WindowPolicySnapshot, String>;
```

CLI adds `--priority normal|high|critical` default `normal`.

- [ ] **Step 1: Write migration and validation tests**

Use an in-memory SQLite helper that calls the extracted `init_schema(&mut Connection)`/`migrate_notifications(&Connection)` functions used by `Db::init`; do not require a Tauri `AppHandle` in storage tests. Start with the old notifications table, run migration twice, then assert `PRAGMA table_info` contains exactly one `priority TEXT NOT NULL DEFAULT 'normal'` column and an old row reads normal. Add tests for default deserialization, high/critical acceptance, illegal priority rejection, and no `level=error` inference.

- [ ] **Step 2: Verify failure**

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml notify:: -- --nocapture
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml storage:: -- --nocapture
```

Expected: FAIL because priority/migration are absent.

- [ ] **Step 3: Add idempotent inline migration**

After `CREATE TABLE IF NOT EXISTS`, inspect `PRAGMA table_info(notifications)` and execute exactly once when absent:

```sql
ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
```

New table DDL includes the column. Do not introduce a versioned migration system in this task.

- [ ] **Step 4: Thread priority through every adapter**

Update INSERT/SELECT column ordering, HTTP JSON, Tauri command DTO, CLI clap enum/payload, TypeScript notification item/card and hook docs examples. Keep old payloads valid through serde default.

- [ ] **Step 5: Move display effects into policy**

`dispatch_notification` order remains:

1. validate;
2. insert;
3. emit `notify://incoming`;
4. ask policy to present;
5. independently issue Windows Toast if enabled.

Define presentation intent explicitly: first snapshot the policy. If `desired_state=Hidden`, every notification leaves the island hidden. Otherwise, a non-fullscreen notification requests `desired_state=Expanded` with `FocusIntent::Preserve`, preserving existing auto-open behavior without focus theft. A fullscreen-normal notification does not mutate desired state; a fullscreen-high/critical notification uses only the temporary override. This avoids a hidden desired-state mutation unexpectedly expanding after fullscreen exit.

- desired hidden → no island display;
- fullscreen + normal → no window effect;
- fullscreen + high/critical → `priority_override_active=true`, increment generation, effective Expanded, never focus, schedule 6s clear;
- a new high/critical increments generation and restarts 6s;
- old timer only clears if generation matches;
- exiting fullscreen must atomically clear `priority_override_active` and increment/invalidate its generation before reducing to desired state; an old 6-second timer can no longer affect the new non-fullscreen state;
- user hidden always wins.

- [ ] **Step 6: Add generation tests using paused Tokio time or extracted pure expiry predicate**

Test user hidden, normal fullscreen, high fullscreen no-focus, second high invalidates first timer, user hides during override, and fullscreen exit. No wall-clock 6-second sleeps in tests.

- [ ] **Step 7: Verify and user-test**

Run notify/storage/window-policy tests, `cargo check`, tsc/build/diff-check. Send legacy HTTP payload without priority, then CLI normal/high/critical. In fullscreen verify normal only stores+Toast, high/critical expands about 6s without stealing focus, explicit user hidden is never overridden.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/storage/mod.rs src-tauri/src/notify/mod.rs src-tauri/src/notify/server.rs src-tauri/src/bin/lucky-notify.rs src-tauri/src/window_policy.rs src/components/pages/notify/NotifyCard.tsx src/components/pages/notify/NotifyPage.tsx docs/Claude-Codex-hook配置.md
git commit -m "feat(notify): 增加全屏感知通知优先级"
```

---

## Phase 4: About and stable updater

### Task 9: Add safe diagnostics and About navigation

**Files:**
- Create: `src-tauri/src/about.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src/settings/AboutPanel.tsx`
- Modify: `src/settings/SettingsApp.tsx`
- Modify: `src/settings/shared.tsx`
- Modify: `src-tauri/capabilities/settings.json`
- Test: `src-tauri/src/about.rs`

**Interfaces:**
- Produces:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticInfo {
    pub app_version: String,
    pub os: String,
    pub architecture: String,
    pub webview2: String,
    pub update_channel: String,
}
#[tauri::command]
pub fn about_diagnostics(app: AppHandle) -> DiagnosticInfo;
pub fn diagnostic_text(info: &DiagnosticInfo) -> String;
```

- [ ] **Step 1: Correct package author metadata**

Change `authors = ["you"]` to `authors = ["thisxiaoyuQAQ"]` in `src-tauri/Cargo.toml`.

- [ ] **Step 2: Write failing pure formatting/redaction tests**

Test `diagnostic_text(&info)` exact five-line output and assert it contains none of representative secrets/paths/usernames. `DiagnosticInfo` should derive `Clone` for the test/helper boundary. Test missing OS/WebView2 becomes `未知` without failing the command.

- [ ] **Step 3: Implement diagnostics from stable/local APIs**

Use `app.package_info().version`, `std::env::consts::ARCH`, `tauri::webview_version().unwrap_or("未知")`, and Windows version via a direct `windows-version = "0.1"` dependency (`OsVersion::current()` gives major/minor/build); non-Windows returns platform family/version if available or `未知`. Do not read settings, DB, env secrets, user paths or notification tokens.

- [ ] **Step 4: Build the About panel and navigation**

The frontend invokes `about_diagnostics`, formats exactly the same five fields for display/copy, and treats individual `未知` values as normal data. The panel shows logo/name/version/author/MIT/repo/Issue, diagnostic text and copy button. Reserve the final section with a concrete neutral message `更新检查将在后续任务接入` plus a disabled check button; Task 10 replaces this entire section. Open external URLs using `@tauri-apps/plugin-opener`; do not navigate the WebView.

Refactor settings layout:

```tsx
<nav className="flex w-44 shrink-0 flex-col border-r border-border/60 bg-card/40 p-3">
  <header className="mb-3 flex shrink-0 items-center gap-2 px-2">
    <img src="/logo.png" alt="LuckyIsland" className="h-7 w-7 rounded-md object-cover" />
    <span className="text-sm font-semibold">LuckyIsland 设置</span>
  </header>
  <div className="min-h-0 flex-1 overflow-y-auto">{TABS.map(renderTab)}</div>
  <button className="mt-2 shrink-0 rounded-md px-3 py-1.5 text-left text-sm">关于</button>
</nav>
```

Add `about` to `Tab` but not the scrolling normal `TABS` list. Fix existing fallback ternary so `voice` is explicit and unknown tabs do not silently render Voice.

- [ ] **Step 5: Verify**

Run about tests, cargo check, tsc/build/diff-check. User verifies About remains reachable at 560×480 min settings size, links open system browser, copy text has only five safe fields.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/about.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src/settings/AboutPanel.tsx src/settings/SettingsApp.tsx src/settings/shared.tsx src-tauri/capabilities/settings.json
git commit -m "feat(about): 增加关于页与脱敏诊断信息"
```

### Task 10: Implement the updater state machine and quiet automatic checks

**Files:**
- Create: `src/lib/update-store.ts`
- Create: `src/lib/__tests__/update-store.test.ts`
- Modify: `src/settings/AboutPanel.tsx`
- Modify: `src/settings/SettingsApp.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/settings.ts`
- Modify: `src/settings/GeneralPanel.tsx`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/settings_window.rs`
- Test: update-store tests

**Interfaces:**
- Produces:

```ts
export type UpdatePhase = "idle" | "checking" | "up_to_date" | "available" | "downloading" | "installing" | "error";
export interface UpdateState { phase: UpdatePhase; currentVersion: string; latestVersion?: string; title?: string; date?: string; notes?: string; releaseUrl: string; downloaded: number; total?: number; error?: string; }
export function subscribeUpdate(listener: () => void): () => void;
export function getUpdateSnapshot(): UpdateState;
export async function checkForUpdate(origin: "auto" | "manual"): Promise<void>;
export async function installAvailableUpdate(): Promise<void>; // Windows install exits into NSIS; no reachable relaunch
export function scheduleAutoCheck(enabled: boolean): () => void;
```

- [ ] **Step 1: Write failing reducer/gate tests**

Test valid transitions, accumulated chunk progress, unknown content length, stale request completion ignored, manual-check-during-download preserving the active `Update`, resource close on replacement/error, error redaction (`Authorization`, private key markers and absolute home path), the trusted Release URL fallback/host allowlist, and `AutoCheckGate` permitting only one auto attempt per process after 10 seconds even across two schedule/unsubscribe cycles. Also test disabling before fire cancels, re-enabling before the first attempt schedules once, and manual checks remain unlimited outside download/install.

- [ ] **Step 2: Verify failure**

```bash
pnpm test src/lib/__tests__/update-store.test.ts
```

Expected: FAIL because store is absent.

- [ ] **Step 3: Implement a module-level external store**

Use `useSyncExternalStore` consumers so closing/reopening About does not reset active download. `check()` returns `null` for up-to-date. Store the live `Update` resource privately; before replacing it call `close()`, and also close it on no-longer-needed error/up-to-date paths when a resource exists. A manual check while `downloading`/`installing` returns the current state rather than replacing the active resource. Do not treat `rawJson` as containing a guaranteed GitHub `html_url`: the static Tauri `latest.json` does not require one. The Release button therefore uses the known stable URL `https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest`; if a future manifest adds a release URL, accept it only after parsing as HTTPS and verifying host `github.com` plus path prefix `/thisxiaoyuQAQ/LuckyIsland/releases/`. Render notes as plain text only.

- [ ] **Step 4: Implement download/install without fake cancel or unreachable Windows relaunch**

Use official API, set `downloading` before the call, and set `installing` on `Finished` before the plugin enters the installer path:

```ts
await update.downloadAndInstall((event) => {
  if (event.event === "Started") setTotal(event.data.contentLength);
  if (event.event === "Progress") addDownloaded(event.data.chunkLength);
  if (event.event === "Finished") setPhase("installing");
});
```

On Windows, successful `install()` launches the installer and exits the current process inside the plugin, so code after this await is not a reliable/reachable completion step. Do not unconditionally call `relaunch()` on Windows. If a later non-Windows build reuses this store, isolate the post-install strategy behind `UpdaterAdapter.finishInstall()` and test per platform.

There is no Cancel button. The UI text during download says “可关闭关于页，下载会继续；安装完成后应用将重新启动”. Retry is offered only after failure.

- [ ] **Step 5: Add automatic check and full-screen-aware notice**

`App.tsx` reads `update:auto_check` default true, listens to `settings://changed` (including the events emitted by configuration import), and calls the module-level `scheduleAutoCheck(enabled)`. The store owns the single process-wide gate and 10,000ms timer; React StrictMode/remounts may subscribe/unsubscribe but cannot create a second automatic attempt. Turning the setting off before the timer fires cancels it; turning it back on schedules only if the process gate has not attempted. On available:

- do not download;
- do not focus/show the island;
- if not full-screen-suppressed, show an in-island non-modal update badge/button near the existing settings control; if full-screen-blocked, keep `pendingAvailable=true` in the update store and reveal the same badge only after a policy event says `fullscreenBlock=false`;
- never use notification priority override for update availability.

Because the island cannot open a settings tab directly today, change the Rust command to `open_settings(app, tab: Option<String>)`; after show/focus, emit `settings://navigate { tab }` only for an allowlisted settings tab (including `about`). The existing frontend `openSettings()` sends `{tab:null}` and remains behavior-compatible; the update badge calls `openSettings("about")`. `SettingsApp` listens, validates against its `Tab` union and selects About. Add a pure allowlist test or TS navigation parser test so arbitrary event payloads cannot select an undefined fallback panel.

- [ ] **Step 6: Finish About update UI and setting**

About displays current/latest version, date/title/plain-text notes, progress, “安全更新并重启”, “查看 Release”, retry and copy-safe-error. `GeneralPanel` adds “启动后自动检查更新” Switch default true with write rollback.

- [ ] **Step 7: Verify in development with a mocked adapter**

Keep `UpdaterAdapter` injectable in tests; exercise no-update, update, progress, network error, signature/install error and late request. Run update tests, all Vitest, tsc/build/diff-check. Development build may return endpoint/config errors until Task 11; those must be rendered safely, not crash.

- [ ] **Step 8: Commit**

```bash
git add src/lib/update-store.ts src/lib/__tests__/update-store.test.ts src/settings/AboutPanel.tsx src/settings/SettingsApp.tsx src/App.tsx src/lib/settings.ts src/settings/GeneralPanel.tsx src-tauri/src/window_policy.rs src-tauri/src/settings_window.rs
git commit -m "feat(update): 增加稳定更新检查与安全安装状态机"
```

---

## Phase 5: Signed release paths

### Task 11: Configure signed updater artifacts and release validation scripts

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `scripts/check-version.mjs`
- Create: `scripts/validate-updater-assets.mjs`
- Create: `scripts/__tests__/release-scripts.test.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Test: release-scripts tests

**Interfaces:**
- Produces `pnpm release:check-version -- --tag vX.Y.Z` and `pnpm release:validate-assets -- --dir PATH --version X.Y.Z --tag vX.Y.Z`. Optional remote checks add `--remote-base URL`; GitHub release-state checks add `--release-metadata PATH --expected-draft true|false`.

- [ ] **Step 1: Write failing fixture tests**

Create temp fixtures in the test file and cover:

- three versions equal + matching tag passes;
- any mismatch fails with all four values;
- missing NSIS/setup `.exe`, `.sig`, `latest.json` fails;
- manifest fixture whose `url` points at `/releases/download/vX.Y.Z/` passes; `releases/latest`, another repository/host, wrong tag, empty signature or wrong platform fails. Draft/prerelease state is a GitHub Release API property—not part of standard `latest.json`—so test `--release-metadata` with matching tag and both phases: draft metadata passes only with `--expected-draft true`; published metadata passes only with `--expected-draft false`; any prerelease fails;
- no secret file content is logged by errors.

Update `vitest.config.ts` include to `['src/**/*.test.ts', 'scripts/**/*.test.ts']`.

- [ ] **Step 2: Implement exact version validation**

Read `package.json.version`, Cargo TOML package version (strict regex within `[package]`), and `tauri.conf.json.version`; normalize tag by stripping exactly one leading `v`; output one-line success or nonzero detailed mismatch.

- [ ] **Step 3: Implement asset manifest validation**

Parse `latest.json`, require exact `version`, `platforms["windows-x86_64"].url`, non-empty `signature`, HTTPS host `github.com`, repository path `/thisxiaoyuQAQ/LuckyIsland/releases/download/<tag>/`, and matching local NSIS executable/`.sig`. If `--release-metadata PATH` is provided, parse the GitHub API response and require matching `tag_name`, `prerelease=false`, and `draft` equal to `--expected-draft true|false`; omit both metadata flags for local pre-upload validation. Do not invent a `tauri signer verify` command—the locked CLI only supports `generate` and `sign`; cryptographic rejection is validated by the installed app in Task 16.

- [ ] **Step 4: Add scripts**

```json
"release:check-version": "node scripts/check-version.mjs",
"release:validate-assets": "node scripts/validate-updater-assets.mjs"
```

- [ ] **Step 5: Enable Tauri updater config only with a real public key**

Before editing config, generate/obtain the maintainer updater key outside the repository:

```powershell
pnpm tauri signer generate -w "$HOME\.tauri\luckyisland.key"
```

This step is a user security gate: the public key content may be committed; private key/password remain outside the repo. Then configure:

```json
"bundle": {
  "createUpdaterArtifacts": true
},
"plugins": {
  "updater": {
    "pubkey": "CONTENT_FROM_PUBLICKEY_PEM",
    "endpoints": [
      "https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest/download/latest.json"
    ],
    "windows": { "installMode": "passive" }
  }
}
```

If the user is not ready to provide/generate the key, split safely: finish and commit only the validator scripts/tests/package/vitest changes, leave `tauri.conf.json` unchanged, mark the signing-config substep blocked in `docs/开发进度.md`, and do not run/commit any release workflow or publication path. Resume Task 11 Step 5 later with the real public key before Task 12.

- [ ] **Step 6: Verify**

```bash
pnpm test scripts/__tests__/release-scripts.test.ts
pnpm release:check-version -- --tag v0.2.1
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: fixture tests pass and current `v0.2.1` versions align. Tauri build with `createUpdaterArtifacts=true` requires private signing env; regular frontend build does not.

- [ ] **Step 7: Commit public config and validators only**

```bash
git add src-tauri/tauri.conf.json scripts/check-version.mjs scripts/validate-updater-assets.mjs scripts/__tests__/release-scripts.test.ts vitest.config.ts package.json pnpm-lock.yaml
git commit -m "build(release): 配置签名更新资产校验"
```

### Task 12: Add the GitHub Actions main release path and local fallback

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/release-local.ps1`
- Create: `docs/releasing.md`
- Modify: `README.md`
- Modify/Test: `scripts/__tests__/release-scripts.test.ts` — workflow safety assertions
- Test: local script dry-run

**Interfaces:**
- Precondition: Task 11 Step 5 completed with a real committed public key and `createUpdaterArtifacts=true`; otherwise Task 12 is blocked.
- CI trigger: pushed tag `v*` only; `contents: write`; Windows x86_64 stable release.
- Local script: `./scripts/release-local.ps1 -Tag vX.Y.Z` dry-run; `-Publish` is outward-facing and requires separate user authorization.

- [ ] **Step 1: Write the workflow with pinned action commits**

Use exact commits recorded 2026-07-13:

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  release-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with: { version: 10.15.0 }
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30
        with: { toolchain: 1.92.0, targets: x86_64-pc-windows-msvc }
      - uses: Swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
        with: { workspaces: "./src-tauri -> target" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm release:check-version -- --tag $env:GITHUB_REF_NAME
      - run: pnpm test
      - run: pnpm exec tsc --noEmit
      - run: pnpm build
      - run: cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
      - uses: tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f # v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: LuckyIsland v__VERSION__
          generateReleaseNotes: true
          releaseDraft: true
          prerelease: false
          uploadUpdaterJson: true
          uploadUpdaterSignatures: true
          updaterJsonPreferNsis: true
```

After tauri-action, use its `releaseId`/`artifactPaths` outputs or `gh release download "$env:GITHUB_REF_NAME" --dir release-assets`. Save `gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$env:GITHUB_REF_NAME"` to `release-metadata.json`, then run `pnpm release:validate-assets -- --dir release-assets --version <validated-version> --tag "$env:GITHUB_REF_NAME" --release-metadata release-metadata.json`. The workflow is unconditionally draft-first: keep `releaseDraft: true`; while validating the draft, the metadata validator expects `draft=true, prerelease=false` in a dedicated `--expected-draft true` mode, then `gh release edit ... --draft=false --latest`; fetch metadata again and rerun with `--expected-draft false`. Any failed test, signing step, upload or pre-publish validator leaves a draft rather than publishing an incomplete stable Release.

- [ ] **Step 2: Add a static workflow safety test**

Extend `scripts/__tests__/release-scripts.test.ts` to read `.github/workflows/release.yml` as text and assert it contains secret references but no literal private key, `releaseDraft: true`, `prerelease: false`, only a `v*` tag trigger, asset validation before `gh release edit`, and no branch/workflow-dispatch publication trigger. Missing secrets naturally fail Tauri signing; do not add fallbacks.

- [ ] **Step 3: Implement local fallback with safe default**

`release-local.ps1` must:

1. reject non-Windows, non-`main`, dirty tree, missing/incorrect `v*` tag, or missing signing env;
2. call the same version/test/tsc/build/cargo test commands;
3. run `pnpm tauri build -- --target x86_64-pc-windows-msvc`;
4. locate NSIS + `.sig`; generate/upload `latest.json` using the same tauri-action-compatible schema (prefer invoking a checked-in helper rather than hand-building in PowerShell);
5. validate before any GitHub write;
6. print intended `gh release create --draft ...` in dry-run;
7. only with `-Publish`, and only after a separate user approval, create draft, upload complete asset set, re-download/validate, then publish.

Same tag existing, any incomplete asset, or failing validation aborts; do not overwrite a release silently.

- [ ] **Step 4: Document key operations and trust boundaries**

`docs/releasing.md` covers public/private key roles, encrypted offline backup, GitHub Secrets names, rotation requiring a separate migration design, CI primary/local emergency fallback, no concurrent publication, SmartScreen/AuthentiCode distinction, and rollback/no partial release behavior.

- [ ] **Step 5: Verify without publishing**

```powershell
./scripts/release-local.ps1 -Tag v0.2.1
```

Expected: dry-run reaches checks and prints intended operations; if the working tree is dirty because implementation is uncommitted, it must stop with a precise message (unit-test helpers separately with fixture repo state). Do not pass `-Publish` in implementation verification.

Also run YAML parser/static checks, all tests, diff-check.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml scripts/release-local.ps1 scripts/__tests__/release-scripts.test.ts docs/releasing.md README.md
git commit -m "ci(release): 增加稳定更新双发布流程"
```

---

## Phase 6: Seven-day weather

### Task 13: Probe and lock the forecast supplier contract

**Files:**
- Create: `src-tauri/src/data/weather/model.rs`
- Create: `src-tauri/src/data/weather/open_meteo.rs`
- Modify: `src-tauri/src/data/weather.rs` (convert to `src-tauri/src/data/weather/mod.rs` only after `git mv`)
- Modify: `src-tauri/src/data/mod.rs`
- Test: `src-tauri/src/data/weather/open_meteo.rs`
- Modify: `docs/开发进度.md` (record probe evidence only after completion)

**Interfaces:**
- Produces:

```rust
pub struct WeatherLocation {
    pub query_name: String, pub display_name: String, pub province: Option<String>,
    pub country: String, pub latitude: f64, pub longitude: f64,
    pub timezone: String, pub provider_id: String,
}
pub struct WeatherDay { pub date: String, pub weather: String, pub weather_icon: String,
    pub temp_min: f64, pub temp_max: f64, pub precipitation_probability: Option<f64> }
pub struct WeatherSourceInfo {
    pub current: String,
    pub forecast: String,
    pub attribution: Option<String>,
    pub attribution_url: Option<String>,
    pub license: Option<String>,
}
pub struct WeatherBundle {
    pub now: WeatherNow,
    pub forecast: Vec<WeatherDay>,
    pub source: WeatherSourceInfo,
    pub location: WeatherLocation,
    pub timezone: String,
    pub offline: bool,
    pub partial: bool,
    pub fetched_at: i64,
}
```

- [ ] **Step 1: Run reproducible real probes and save only conclusions, not response dumps**

Probe:

```text
GET https://geocoding-api.open-meteo.com/v1/search?name=北京&count=10&language=zh&format=json
GET https://geocoding-api.open-meteo.com/v1/search?name=无锡&count=10&language=zh&format=json
GET https://geocoding-api.open-meteo.com/v1/search?name=滨湖&count=10&language=zh&format=json        # district ambiguity case
GET https://api.open-meteo.com/v1/forecast?latitude=39.9075&longitude=116.39723&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7
```

Acceptance: Beijing/Wuxi correct CN/admin/timezone; district can be disambiguated by candidate province/admin2 rather than silently first; seven aligned daily arrays; HTTPS. Record the exact supplier terms in `WeatherSourceInfo`: Open-Meteo forecast attribution text/link plus licence (currently CC BY 4.0), and geocoding attribution including GeoNames as required by the live docs. If the live terms or data do not meet the product, stop and select another no-key supplier behind the same interfaces.

- [ ] **Step 2: Write failing raw-response mapping tests with local JSON fixtures**

Test no results, ambiguous candidates, province/country filtering, arrays of unequal length (truncate to shortest, max 7), duplicate/out-of-order dates (sort/dedup), absent precipitation array (`None`), invalid timezone, and WMO code mapping.

- [ ] **Step 3: Convert weather into a module without changing public commands**

Use `git mv src-tauri/src/data/weather.rs src-tauri/src/data/weather/mod.rs`. Keep `weather_get`, city CRUD, locate and constants exported from `mod.rs`; add `pub mod model; mod open_meteo;`.

- [ ] **Step 4: Implement geocoding and forecast requests**

Exact forecast query:

```rust
.query(&[
  ("latitude", location.latitude.to_string()),
  ("longitude", location.longitude.to_string()),
  ("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max".into()),
  ("timezone", "auto".into()),
  ("forecast_days", "7".into()),
])
```

Geocoding returns all plausible CN candidates; exact display/province/admin match ranks first, but multiple plausible results remain candidates. `provider_id` uses Open-Meteo result numeric ID string where available. Do not expose provider raw DTO to React.

- [ ] **Step 5: Verify mapping and real probe**

Run weather unit tests with:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml data::weather::open_meteo::tests -- --nocapture
```

Add a temporary ignored/manual probe test named `probes_target_cities`, then run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml probes_target_cities -- --ignored --nocapture
```

Expected: unit tests deterministic; real probe returns seven or fewer honest days and records supplier/date only.

- [ ] **Step 6: Commit supplier/model boundary**

```bash
git add src-tauri/src/data/weather src-tauri/src/data/mod.rs docs/开发进度.md
git commit -m "feat(weather): 建立七日预报供应商与统一模型"
```

### Task 14: Add normalized-location cache and partial degradation

**Files:**
- Create: `src-tauri/src/data/weather/cache.rs`
- Modify: `src-tauri/src/data/weather/mod.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: weather cache tests

**Interfaces:**
- Produces existing command name with new return type:

```rust
#[tauri::command]
pub async fn weather_get(
    city: Option<String>,
    location: Option<WeatherLocation>,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<WeatherBundle, WeatherCommandError>;
#[tauri::command]
pub async fn weather_location_search(
    query: String,
    http: State<'_, reqwest::Client>,
) -> Result<Vec<WeatherLocation>, WeatherCommandError>;

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum WeatherCommandError {
    AmbiguousLocation { message: String, candidates: Vec<WeatherLocation> },
    NotFound { message: String },
    Unavailable { message: String },
}
impl std::fmt::Display for WeatherCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AmbiguousLocation { message, .. }
            | Self::NotFound { message }
            | Self::Unavailable { message } => f.write_str(message),
        }
    }
}
impl std::error::Error for WeatherCommandError {}
```

Old callers sending only `{city}` remain accepted; response shape intentionally expands to `WeatherBundle` and frontend changes in Task 15.

- [ ] **Step 1: Write a ten-case cache matrix test**

Use a pure `merge_weather(now_result, forecast_result, cached_same_location)` and assert:

1. both fresh => online/full;
2. fresh now + cached forecast => partial;
3. fresh forecast + cached now => partial;
4. both failed + complete same cache => offline;
5. fresh now + failed forecast + no forecast cache => retryable error (DTO requires 1..=7 honest forecast days);
6. fresh forecast + failed current + no current cache => retryable error (`WeatherBundle.now` is required; do not fabricate current weather);
7. both failed + no cache => retryable error;
8. other-location cache never used;
9. old `weather:last` migrates only when cached city matches normalized target;
10. fewer-than-seven non-empty forecast remains fewer-than-seven.

This explicitly resolves symmetric partial success: a fresh side may combine only with same-location cache for the failed required side. Without that cache the command errors rather than fabricating data or returning an unrepresentable bundle.

- [ ] **Step 2: Implement stable location keys**

Use a safe hash/slug from provider + provider_id + rounded lat/lon, e.g. `weather:cache:open-meteo:<id>`; never embed arbitrary user text directly in SQL. Cache serializes current and forecast timestamps separately so one fresh side does not falsely mark stale side fresh.

- [ ] **Step 3: Fetch current and forecast concurrently**

Resolve location first, then use `tokio::join!(try_fetch_current(...), try_fetch_forecast(...))`. uapis current city query and Open-Meteo forecast errors remain separate. Mark bundle `partial` when one required side is fresh and the other comes from same-location cache; `offline` only when both required sides are cached. If either required side fails with no same-location cache, return `WeatherCommandError::Unavailable`. Preserve current warning alerts.

- [ ] **Step 4: Guard ambiguous names**

If plain city maps uniquely, continue. If multiple plausible candidates cannot be disambiguated using existing city string/province, return `WeatherCommandError::AmbiguousLocation { message, candidates }`; Tauri serializes this structured error for the frontend candidate picker. Do not convert it to a JSON string inside a generic string error, and do not silently pick. A selected `WeatherLocation` must have the expected provider ID, finite in-range coordinates, non-empty display/country/timezone, and match one candidate returned for the query; then persist the validated city→location mapping under `weather:location:<normalized-city>` as JSON. This user configuration is portable, but `weather:cache:*` is not.

- [ ] **Step 5: Update portable settings exclusions/tests**

Ensure `weather:location:*` can migrate only if it contains no secrets/machine path; `weather:cache:*` and `weather:last` remain excluded. Add tests.

- [ ] **Step 6: Verify**

Run weather/storage tests, cargo check and diff-check. Simulate each side failing with injected suppliers, not live network.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/data/weather src-tauri/src/storage/mod.rs src-tauri/src/lib.rs
git commit -m "feat(weather): 增加按地点缓存与部分降级"
```

### Task 15: Render seven-day cards and prevent stale city responses

**Files:**
- Create: `src/components/pages/weather/model.ts`
- Create: `src/components/pages/weather/__tests__/model.test.ts`
- Modify: `src/components/pages/weather/WeatherPage.tsx`
- Modify: `src/settings/WeatherPanel.tsx`
- Modify: `src/lib/settings.ts`
- Test: weather model tests

**Interfaces:**
- Consumes `WeatherBundle`, `weather_location_search`, existing city CRUD.
- Produces `weatherDayLabel(date, timezone, todayDate): string`, `wheelDeltaToHorizontal(deltaX, deltaY): number`, `RequestGate.next()/isCurrent(id)`. `todayDate` is the `YYYY-MM-DD` date derived once for the bundle timezone; helpers compare ISO date strings and never feed a date-only string through host-local `new Date("YYYY-MM-DD")`.

- [ ] **Step 1: Write failing pure frontend tests**

Cover today/tomorrow/weekday labels in Asia/Shanghai, missing precipitation hidden, 1/7-day arrays unchanged, wheel vertical to horizontal delta, native horizontal preferred, and request gate rejecting city A after B starts.

- [ ] **Step 2: Verify failure and implement model helpers**

```bash
pnpm test src/components/pages/weather/__tests__/model.test.ts
```

Expected initial FAIL, then PASS after helper implementation. Do not compare dates via host UTC; format using bundle timezone.

- [ ] **Step 3: Replace per-city `WeatherNow` cache with `WeatherBundle` and request gate**

`fetchWeather(city)` captures request ID; only current ID may set `loading`, `error`, active bundle or candidate prompt. A compact-city background request must use its own keyed gate so it cannot clear active-city loading. Switching city immediately shows loading while retaining prior city data only if clearly labeled, never writes old result under new city.

- [ ] **Step 4: Add candidate selection UI**

When backend reports ambiguity, show a compact list of `displayName / province / country`; selecting calls `weather_get` with the exact returned `WeatherLocation` object (Tauri camelCase argument `location`) so the backend can validate provider/id/coordinates and persist the mapping without a second ambiguous lookup. Add city validation in both WeatherPage and WeatherPanel; arbitrary text is allowed but must resolve before being considered configured.

- [ ] **Step 5: Build the fixed-height forecast strip**

Keep current weather top visual. Under it render 1–7 cards:

- label Today/Tomorrow/weekday;
- icon, weather, `max° / min°`;
- precipitation only when non-null;
- first card emphasized;
- `overflow-x-auto snap-x`, cards `snap-start shrink-0`;
- `tabIndex=0`, ArrowLeft/ArrowRight call `scrollBy`;
- `onWheel` maps vertical wheel to horizontal only within forecast strip and prevents default only when horizontal scrolling is possible;
- no autoplay or pagination dots;
- compact mode remains current weather only.

Fit within existing 380px content without changing Tauri window size.

- [ ] **Step 6: Show cache/source status accurately**

Show `离线`, `部分数据`, last update time and provider attribution. Do not render raw HTML or external response errors. Alerts remain available; if height competes, make alerts a bounded scroll/collapsible section without hiding forecast.

- [ ] **Step 7: Verify and user-test**

Run weather frontend test, all Vitest, tsc/build/diff-check. User tests Beijing/Wuxi/district candidate, seven-day order/high-low/rain, touchpad/wheel/keyboard, rapid city A→B, offline full cache, current-only failure, forecast-only failure and no-cache error.

- [ ] **Step 8: Commit**

```bash
git add src/components/pages/weather/model.ts src/components/pages/weather/__tests__/model.test.ts src/components/pages/weather/WeatherPage.tsx src/settings/WeatherPanel.tsx src/lib/settings.ts
git commit -m "feat(weather): 展示可降级七日天气卡片"
```

---

## Phase 7: Integration, real update verification and documentation

### Task 16: Run full regression and perform signed update acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/开发进度.md`
- Modify: `项目备忘录.md`
- Modify: `vault/11-更新窗口策略与七日天气.md`
- Create: `docs/验收/2026-07-13-luckyisland-enhancements.md`
- Test: full automated and Windows manual matrix

**Interfaces:**
- Consumes all prior tasks.
- Produces factual test/acceptance evidence only; no new product behavior.

- [ ] **Step 1: Run the complete automated gate**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib --locked
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe check --manifest-path src-tauri/Cargo.toml --all-targets --locked
git diff --check
```

Expected: all pass. Record exact counts and commands in acceptance doc. Do not run release publication from this task without separate authorization.

- [ ] **Step 2: Verify old-client compatibility**

- POST old notification JSON with no `priority` and list it back as normal.
- Use old `weather_get {city}` caller shape from devtools/invoke fixture.
- Import a pre-feature config JSON lacking new keys; defaults apply.
- Export current config; new user settings appear, cache/runtime fields do not.
- Existing Alt+X / Alt+Space bindings survive; click-through is unbound.

- [ ] **Step 3: Run Windows window-policy acceptance**

Record pass/fail for: click-through behind-window clicks/restart/settings recovery/hotkey; hover quick pass/delays/manual expanded/click-through pause; browser/video/game/PowerPoint/normal maximize/dual monitor/Alt+Tab; normal vs high/critical notification; no focus theft; desired hidden precedence.

- [ ] **Step 4: Run weather acceptance**

Record Beijing, Wuxi and district candidate; 1–7 honest days, timezone order, optional rainfall, fast switch, full offline cache, current failure, forecast failure, cross-city refusal and no-cache retry error.

- [ ] **Step 5: Perform a two-version signed update bootstrap in a non-public test channel**

First ensure `TAURI_SIGNING_PRIVATE_KEY` / password are provisioned in GitHub Secrets, an encrypted offline backup exists, and a signing smoke build proves the private key matches the committed public key. Existing v0.2.1 releases do not contain updater configuration, so they cannot retroactively auto-update: manually build/install updater-capable baseline N, then validate N → N+1.

This requires user authorization and a disposable test release/repository or a separately approved test endpoint; do not point the production stable build at a prerelease channel. Build version N and N+1 with the same updater key, install N, check/download/verify/install into N+1, and confirm the Windows updater-driven restart reaches N+1. Then alter the manifest signature (or serve a test manifest/package with invalid signature) and record rejection with no bypass and N still runnable. Do not expose the private key or test endpoint credentials in the doc.

If no authorized test channel exists, leave module 11 as `🚧` with “真实签名升级/坏签名拒绝待验收”; do not mark complete.

- [ ] **Step 6: Update user/release documentation**

README adds new settings/behaviors, seven-day weather, About/update, priority example, and notes Windows-only full-screen/click-through. `docs/releasing.md` remains maintainer source. Correct the README sentence that currently claims hover expansion before this feature has actually shipped only after acceptance passes.

- [ ] **Step 7: Restore stable-file boundaries and progress**

Only after all automated + required manual acceptance passes:

- mark module 11 ✅ in `docs/开发进度.md`;
- update vault status and command counts;
- re-add modified monitor/notify/weather/settings files to `项目备忘录.md` stable list with new scope;
- explicitly state plugin roadmap remained planning-only.

If any gate fails, keep 🚧 and list the exact failed scenario.

- [ ] **Step 8: Verify scope and working-tree protection**

Run:

```bash
git status --short
git diff --name-only "$BASELINE_COMMIT"..HEAD
git diff --check
```

Before starting Task 1, record `BASELINE_COMMIT=$(git rev-parse HEAD)` in the session/task notes. Expected: no `plugin`, AI/voice migration, market, manifest parser or sherpa removal changes; pre-existing user paths are untouched/uncommitted unless separately authorized.

- [ ] **Step 9: Commit final docs/evidence**

```bash
git add README.md docs/开发进度.md docs/验收/2026-07-13-luckyisland-enhancements.md 项目备忘录.md vault/11-更新窗口策略与七日天气.md
git commit -m "docs(progress): 记录新功能回归与真机验收"
```

---

## Execution Order and Review Gates

```text
Task 1 dependency baseline
  → Task 2 pure policy
  → Task 3 migrate island effects
  → Task 4 unbound hotkey
  → Task 5 click-through
  → Task 6 hover
  → Task 7 fullscreen
  → Task 8 notification priority
  → Task 9 about/diagnostics
  → Task 10 updater state machine
  → Task 11 signing config + validators (real public-key gate)
  → Task 12 CI/local release paths
  → Task 13 supplier probe/model
  → Task 14 cache/degradation
  → Task 15 weather UI/race protection
  → Task 16 full/signed/manual acceptance
```

Task 13–15 are architecturally independent of updater Tasks 9–12 after window policy stabilizes, but this project follows the user's lite preference: one main Agent executes serially; at most one read-only reviewer is used at phase/review boundaries, not a large fan-out.

Each task is a fresh review gate. Do not batch commits across tasks. Before every commit, inspect `git diff --cached --name-only` so existing user changes never enter the commit.

## Future-Project Exclusions

The following may be mentioned only as future context and must never become a checkbox or code change in this plan execution:

- Plugin Manager/Bridge/Host, WASI runtime, process sandbox, manifest/schema, `.luckyplugin`, market index/API, signing/revocation marketplace, third-party SDK.
- Moving AI providers/history/palette/hotkeys to a plugin or making them uninstallable.
- Moving sherpa-onnx/KWS/ASR/TTS/microphone/model files to a plugin, removing DLLs/dependencies, or adding voice uninstall UI.
- Transparent-area hit testing, system cursor proximity unlock, hover delay customization, macOS/Linux feature parity, prerelease update channels, automatic background downloads, or Windows Authenticode procurement.

## External References Consulted

- Tauri v2 updater guide: `https://v2.tauri.app/plugin/updater/`
- Tauri v2 updater JS API source (`v2` branch): `https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/guest-js/index.ts`
- Tauri updater signing: `https://v2.tauri.app/distribute/signing/`
- Tauri GitHub pipeline: `https://v2.tauri.app/distribute/pipelines/github/`
- `tauri-action` v1 inputs: `https://github.com/tauri-apps/tauri-action`
- Open-Meteo geocoding: `https://open-meteo.com/en/docs/geocoding-api`
- Open-Meteo forecast: `https://open-meteo.com/en/docs`

Exact APIs used in implementation must be rechecked against the dependency versions that `pnpm-lock.yaml` and `Cargo.lock` resolve at Task 1; web `v2`/`v1` branches are moving references.
