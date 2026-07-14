# LuckyIsland 木鱼 Flush 与窗口策略归约器续接 Implementation Plan

> **执行结果（2026-07-14）：** FIX-10A-02 与增强总计划 Task 2 已完成并通过各自独立审查；未 commit。当前入口为 Task 3，且只建立了 `EffectPlan` RED，本续接计划不得再重复执行。
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留当前未提交工作的前提下完成 FIX-10A-02 木鱼卸载 flush，切换唯一执行入口到模块 11，并完成增强总计划中已接入 updater 之后的第一个未完成任务——纯窗口策略归约器。

**Architecture:** 木鱼持久化使用组件实例私有的纯 TypeScript `DebouncedWriter`，把“延迟合并写”和“卸载前提交最新值”从 React 组件中分离；组件卸载调用 `flush()`，不等待 UI。模块 11 首步只新增不调用 Tauri 窗口 API 的 Rust 领域模型和纯归约函数，通过优先级测试冻结 Hidden、通知覆盖、全屏抑制、悬停和焦点语义；平台效果迁移留给增强总计划 Task 3。

**Tech Stack:** React 19、TypeScript 5.8、Vitest 4.1、Tauri 2.11、Rust 1.92 stable-msvc、serde。

## Global Constraints

- 当前分支为用户指定的 `main`；不创建功能分支或 worktree。
- 当前工作区已有 FIX-10A-01、启动存储顺序、滚轮导航、审计文档和增强计划等未提交改动；实施前后均不得 reset、checkout、清理或覆盖这些改动。
- `src/components/pages/time/widgets/WoodenFishWidget.tsx` 已同时包含 FIX-10A-01 跨午夜逻辑；完成 flush 时必须保留 `useLocalDay`、`stateRef`、`loadedRef` 和 rollover 行为。
- FIX-10A-02 的纯 writer、测试和组件接线已经出现在工作区；先审阅和验证当前实现，不删除后重写来制造重复工作或伪造 RED 证据。
- 模块 11 Task 1 更新插件依赖与 cleanup 接入已由提交 `7485835` 完成；不得重复安装 updater/process 依赖或重做该提交。
- 本批次只实施 FIX-10A-02 和增强总计划 Phase 1 / Task 2；不执行 Task 3 的窗口平台效果迁移，不实施穿透、悬停、全屏、通知 priority、关于 UI、发布流程或七日天气。
- 插件市场、Plugin Manager/Bridge/Host、manifest、市场 API、语音/问答插件化、卸载入口和 sherpa-onnx 移除只保留规划，不得产生代码或配置变更。
- 未经用户明确要求不 commit、不 push、不打标签、不创建 Release；如以后获准 commit，必须显式列路径暂存并先检查 `git diff --cached --name-only`。
- 前端验证使用现有 Node 环境 Vitest；Rust 使用独立 target：`CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe`。
- 所有通过结论必须来自本轮新鲜命令输出；环境阻断按真实原因记录，不把未运行写成通过。

---

## File Structure

### Current in-progress files to finish, not recreate

- `src/components/pages/time/debouncedWriter.ts` — 与 React/Tauri 解耦的最后值防抖写入队列；提供 `schedule` 和可等待的 `flush`。
- `src/components/pages/time/__tests__/debouncedWriter.test.ts` — 覆盖延迟合并、提前 flush、在途写入顺序和旧写失败后的最新值提交。
- `src/components/pages/time/widgets/WoodenFishWidget.tsx` — 每个组件实例持有独立 writer；敲击调度，跨日立即 flush，卸载尽力 flush。

### Progress and execution-boundary files

- `vault/10a-文档同步与确定性修复.md` — 记录 FIX-10A-02 的四步证据并标记完成。
- `vault/10-审计整改.md` — 保持模块 10 进行中，注明 FIX-10A-01/02 已完成、FIX-10A-03 暂停等待恢复模块 10。
- `docs/开发进度.md` — 写入 FIX-10A-02 的新鲜验证与模块 11 恢复状态。
- `vault/CURRENT.md` — FIX 完成后从模块 10 切换到模块 11；纯归约器完成后指向增强总计划 Task 3。
- `vault/11-更新窗口策略与七日天气.md` — 从“暂停排队”改为进行中，记录 Task 1 和 Task 2 状态。
- `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md` — 仅勾选实际完成的 Task 2 步骤，不机械处理后续 checkbox。

### New module-11 domain file

- `src-tauri/src/window_policy.rs` — `IslandState`、`FocusIntent`、`WindowPolicyInputs`、`WindowDecision` 和纯 `reduce`；不包含 `AppHandle`、WebviewWindow、Mutex、持久化或平台调用。
- `src-tauri/src/lib.rs` — 只增加 `mod window_policy;`；保留当前未提交的早期 SQLite storage plugin 初始化改动。

---

### Task 1: 完成并验证 FIX-10A-02 木鱼卸载 Flush

**Files:**
- Finish existing: `src/components/pages/time/debouncedWriter.ts`
- Finish existing: `src/components/pages/time/__tests__/debouncedWriter.test.ts`
- Modify existing worktree change: `src/components/pages/time/widgets/WoodenFishWidget.tsx`

**Interfaces:**
- Consumes: `settingSet(key: string, value: string | null): Promise<void>` and immutable `MeritState` values.
- Produces:

```ts
export interface DebouncedWriterEnvironment {
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface DebouncedWriter<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
}

export function createDebouncedWriter<T>(
  write: (value: T) => Promise<void>,
  delayMs: number,
  environment?: DebouncedWriterEnvironment,
): DebouncedWriter<T>;
```

- Invariant: 多次 `schedule` 只保留最后值；写入串行；`flush` 先取消 timer，再等待在途写并提交最后 pending 值。

- [ ] **Step 1: 捕获当前路径状态，确认不把并发出现的实现当成待重建文件**

Run:

```bash
git status --short -- src/components/pages/time/debouncedWriter.ts src/components/pages/time/__tests__/debouncedWriter.test.ts src/components/pages/time/widgets/WoodenFishWidget.tsx
```

Expected: writer 与测试为未跟踪文件，WoodenFishWidget 为已修改文件；若路径状态再次变化，先重新读取文件再继续，不覆盖较新的内容。

- [ ] **Step 2: 补充“正常延迟仍只写最后值”的测试**

在 `src/components/pages/time/__tests__/debouncedWriter.test.ts` 的 `describe` 内加入：

```ts
it("正常延迟到期也只保存最后一个值", async () => {
  const fake = createFakeEnvironment();
  const write = vi.fn(async (_value: string) => {});
  const writer = createDebouncedWriter(write, 500, fake.environment);

  writer.schedule("first");
  writer.schedule("latest");
  fake.runTimer();
  await writer.flush();

  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith("latest");
});
```

这与已有的提前 `flush`、在途写和旧写失败测试共同覆盖 vault 验收，不引入 React 测试库。

- [ ] **Step 3: 运行定向测试并诚实处理既有实现状态**

Run:

```bash
pnpm test src/components/pages/time/__tests__/debouncedWriter.test.ts
```

Expected: 4 tests pass。当前实现已在工作区，若没有先前 RED 日志，不删除实现来伪造失败；进度文档只记录“接手时测试与实现已存在，本轮完成审阅和新鲜通过”，不虚构首次失败输出。

- [ ] **Step 4: 收敛 WoodenFishWidget 为实例私有 writer**

`src/components/pages/time/widgets/WoodenFishWidget.tsx` 在模块常量区只能保留：

```ts
const DATA_KEY = "time:data:wooden_fish";
const SOUND_URL = "/sound_1.mp3";
const FISH_URL = "/WoodenFish.svg";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

删除模块级 `const persistWriter = createDebouncedWriter(...)`，避免多个挂载实例共享 pending 状态。组件内保留唯一 writer：

```ts
const persistWriter = useRef(
  createDebouncedWriter<MeritState>(
    (value) => settingSet(DATA_KEY, JSON.stringify(value)),
    500,
  ),
);
```

敲击只调度最新值：

```ts
const schedulePersist = (value: MeritState) => {
  persistWriter.current.schedule(value);
};
```

卸载 cleanup 必须清除读取回调并尽力提交：

```ts
return () => {
  disposed = true;
  void persistWriter.current.flush().catch(() => {
    /* 卸载期间无法再展示错误；保留异步写入尽力提交。 */
  });
};
```

跨日 effect 保留 FIX-10A-01 的 rollover，并使跨日状态立即排在旧在途写之后落盘：

```ts
stateRef.current = next;
setState(next);
persistWriter.current.schedule(next);
void persistWriter.current.flush().catch(() => {
  /* 保持 UI 可用；后续敲击会继续调度最新状态。 */
});
```

- [ ] **Step 5: 运行 FIX-10A-01/02 相关回归**

Run:

```bash
pnpm test src/components/pages/time/__tests__/debouncedWriter.test.ts src/components/pages/time/__tests__/localDayStore.test.ts src/components/pages/time/__tests__/date.test.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: writer 4/4，通过现有 local-day/date 测试，TypeScript 与三个 Vite 入口构建成功；只允许记录实际输出数字。既有主 chunk 大于 500 kB 的 Vite warning 不等于失败。

- [ ] **Step 6: 做最小实现者自审**

Check:

```text
1. WoodenFishWidget 没有模块级 writer 或旧 persistTimer。
2. 每次 knock 使用 stateRef.current，快速连续点击不会读旧 React state。
3. cleanup 不 setState、不阻塞卸载，只捕获异步错误。
4. rollover、loadedRef、currentLocalDay/useLocalDay 未被删除。
5. debouncedWriter 不依赖 React、Tauri 或全局单例。
6. 正常延迟、提前 flush、在途写和旧写失败均有测试。
```

Expected: 六项全部满足；只修正与本任务直接相关的问题。

---

### Task 2: 记录 FIX 完成并切换唯一执行入口到模块 11

**Files:**
- Modify: `vault/10a-文档同步与确定性修复.md`
- Modify: `vault/10-审计整改.md`
- Modify: `docs/开发进度.md`
- Modify: `vault/CURRENT.md`
- Modify: `vault/11-更新窗口策略与七日天气.md`

**Interfaces:**
- Consumes: Task 1 的实际命令输出。
- Produces: 单一权威下一动作——模块 11 的 `Phase 1 / Task 2: Implement the pure window-policy reducer`。

- [ ] **Step 1: 更新 10a 子任务状态和证据**

在任务表中把 FIX-10A-02 改为 `✅`；将该节状态改为：

```markdown
> 状态：✅ 已完成（2026-07-14）
```

用本轮真实输出填写四步记录，至少明确：

```markdown
- 复现/保护：纯 writer 测试覆盖 500ms 前 flush 只写 latest。
- 定位：旧 cleanup 只 clearTimeout，pending 最新功德值被丢弃。
- 修复：实例私有 DebouncedWriter 串行写入；卸载和跨日调用 flush。
- 验证：记录定向测试、完整相关测试、tsc 和 build 的真实结果；没有历史 RED 日志时明确不伪造。
```

- [ ] **Step 2: 保持模块 10 为未完成但暂停**

`vault/10-审计整改.md` 顶部与总表保持 `🚧`，不得把整个模块标为完成。状态文字写成：

```markdown
> 状态：🚧 进行中（DOC-10A、FIX-10A-01/02 已完成；FIX-10A-03 及 10b/10c 保留，当前按用户确认暂停并转入模块 11）
```

进度记录新增 FIX-10A-02 实际证据；不得删除 FIX-10A-03。

- [ ] **Step 3: 激活模块 11 并更新开发进度**

`vault/11-更新窗口策略与七日天气.md` 顶部改为：

```markdown
> 状态：🚧 进行中（2026-07-14：详细计划和 Task 1 更新插件接入已完成；当前执行 11.1 / 总计划 Task 2 纯窗口策略归约器）
```

`docs/开发进度.md` 模块 10 保持 `🚧` 并注明暂停点；模块 11 从 `🚫` 改为 `🚧`，备注中明确：

```text
Task 1 更新插件接入已由 7485835 完成；当前 Task 2 纯窗口策略归约器；插件市场及语音/问答插件化不实施
```

- [ ] **Step 4: 重写 CURRENT 为唯一模块 11 入口**

`vault/CURRENT.md` 顶部使用：

```markdown
> 当前阶段：模块 11「更新、窗口策略与七日天气」
> 状态：🚧 进行中
> 更新时间：2026-07-14
```

唯一下一动作必须是：

```markdown
**执行 `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md` 的 Phase 1 / Task 2：先为 Hidden、priority override、fullscreen、hover/click-through 和 focus 规则建立失败测试，再实现不依赖 Tauri 窗口 API 的纯 `window_policy::reduce`。Task 1 已由 `7485835` 完成，不得重复；不得提前执行 Task 3 或插件路线图。**
```

- [ ] **Step 5: 核对文档状态一致性**

Run:

```bash
git diff --check -- vault/CURRENT.md vault/10a-文档同步与确定性修复.md vault/10-审计整改.md vault/11-更新窗口策略与七日天气.md docs/开发进度.md
```

Expected: exit 0；五个文件都把 Task 2 作为唯一当前动作，模块 10 仍未完成，插件路线仍仅规划。

---

### Task 3: 以 TDD 建立纯窗口策略归约器

**Files:**
- Create: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/lib.rs:1-10`
- Test: inline `src-tauri/src/window_policy.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: 设计规格 §5.2 的优先级；不消费 Tauri `AppHandle` 或窗口对象。
- Produces:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState {
    Hidden,
    Compact,
    Expanded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusIntent {
    Preserve,
    Focus,
}

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

pub fn reduce(inputs: WindowPolicyInputs, requested_focus: FocusIntent) -> WindowDecision;
```

- Priority: user Hidden > priority override > enabled fullscreen block > compact hover expansion > desired state.
- Any environment-driven branch returns `FocusIntent::Preserve`; only an unsuppressed explicit request may retain `FocusIntent::Focus`.

- [ ] **Step 1: 创建只含类型、`unimplemented!()` 和完整失败测试的模块**

Create `src-tauri/src/window_policy.rs` with the public types above, then add:

```rust
pub fn reduce(_inputs: WindowPolicyInputs, _requested_focus: FocusIntent) -> WindowDecision {
    unimplemented!("window policy reducer")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(
        desired_state: IslandState,
        fullscreen_block: bool,
        priority_override_active: bool,
    ) -> WindowPolicyInputs {
        WindowPolicyInputs {
            desired_state,
            hover_expand: false,
            hovered: false,
            click_through: false,
            hide_in_fullscreen: true,
            fullscreen_block,
            priority_override_generation: u64::from(priority_override_active),
            priority_override_active,
        }
    }

    #[test]
    fn user_hidden_beats_priority_override() {
        let decision = reduce(
            inputs(IslandState::Hidden, true, true),
            FocusIntent::Focus,
        );
        assert_eq!(
            decision,
            WindowDecision {
                effective_state: IslandState::Hidden,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn priority_override_beats_fullscreen_without_focus() {
        let decision = reduce(
            inputs(IslandState::Compact, true, true),
            FocusIntent::Focus,
        );
        assert_eq!(
            decision,
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn enabled_fullscreen_block_hides_normal_state_without_focus() {
        let decision = reduce(
            inputs(IslandState::Compact, true, false),
            FocusIntent::Focus,
        );
        assert_eq!(
            decision,
            WindowDecision {
                effective_state: IslandState::Hidden,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn disabled_fullscreen_setting_does_not_hide() {
        let mut state = inputs(IslandState::Compact, true, false);
        state.hide_in_fullscreen = false;
        assert_eq!(
            reduce(state, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Focus,
            }
        );
    }

    #[test]
    fn hover_only_expands_compact_non_click_through_without_focus() {
        let mut state = inputs(IslandState::Compact, false, false);
        state.hover_expand = true;
        state.hovered = true;
        assert_eq!(
            reduce(state, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );

        state.click_through = true;
        assert_eq!(
            reduce(state, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Focus,
            }
        );
    }

    #[test]
    fn pointer_leave_never_collapses_explicit_expanded() {
        let state = inputs(IslandState::Expanded, false, false);
        assert_eq!(
            reduce(state, FocusIntent::Preserve),
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );
    }
}
```

Add only this module declaration near the top of `src-tauri/src/lib.rs`:

```rust
mod window_policy;
```

Do not change existing `apply_state`, `set_state_and_emit`, monitor, notification or hotkey behavior in this task.

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
```

Expected: tests compile and fail because `reduce` reaches `unimplemented!("window policy reducer")`。若编译被当前工作区的其他独立 Rust 改动阻断，记录具体文件和错误，不修改无关模块来迁就本测试。

- [ ] **Step 3: 实现最小优先级归约器**

Replace only `reduce` with:

```rust
pub fn reduce(inputs: WindowPolicyInputs, requested_focus: FocusIntent) -> WindowDecision {
    if inputs.desired_state == IslandState::Hidden {
        return WindowDecision {
            effective_state: IslandState::Hidden,
            focus: FocusIntent::Preserve,
        };
    }

    if inputs.priority_override_active {
        return WindowDecision {
            effective_state: IslandState::Expanded,
            focus: FocusIntent::Preserve,
        };
    }

    if inputs.hide_in_fullscreen && inputs.fullscreen_block {
        return WindowDecision {
            effective_state: IslandState::Hidden,
            focus: FocusIntent::Preserve,
        };
    }

    if inputs.desired_state == IslandState::Compact
        && inputs.hover_expand
        && inputs.hovered
        && !inputs.click_through
    {
        return WindowDecision {
            effective_state: IslandState::Expanded,
            focus: FocusIntent::Preserve,
        };
    }

    WindowDecision {
        effective_state: inputs.desired_state,
        focus: requested_focus,
    }
}
```

Do not read or mutate `priority_override_generation` in the reducer; it exists for later expiry coordination, while `priority_override_active` is the current pure input.

- [ ] **Step 4: 运行定向 Rust 测试确认 GREEN**

Run the same cargo command as Step 2.

Expected: 6 window-policy tests pass, 0 fail。Warnings about fields/functions not yet used by platform code are acceptable only for this pure-domain task; compiler errors are not。

- [ ] **Step 5: 检查本任务没有提前迁移平台效果**

Run:

```bash
git diff -- src-tauri/src/window_policy.rs src-tauri/src/lib.rs
```

Expected:

```text
window_policy.rs 只含 serde 类型、纯 reduce 和单元测试。
lib.rs 只多一行 mod window_policy;，原有未提交 storage_plugin 改动保持原样。
没有新增 window.show/hide/set_focus/set_ignore_cursor_events 调用。
没有修改 hotkeys、monitor、notify、settings 或 React 窗口状态。
```

---

### Task 4: 回写 Task 2 完成状态并冻结下一阶段边界

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md`
- Modify: `vault/11-更新窗口策略与七日天气.md`
- Modify: `vault/CURRENT.md`
- Modify: `docs/开发进度.md`
- Test: all commands listed below

**Interfaces:**
- Consumes: Task 1 前端证据、Task 3 Rust RED/GREEN 证据。
- Produces: 唯一下一动作为增强总计划 Task 3（应用策略效果并迁移现有岛窗口入口）；本批次不执行它。

- [ ] **Step 1: 只勾选增强总计划 Task 2 的实际步骤**

在 `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md` 中把 Task 2 的 Step 1–5 从 `- [ ]` 改为 `- [x]`。不要更改 Task 3 及以后 checkbox；Task 1 的既有完成标记保持不变。

- [ ] **Step 2: 更新模块 11 进度和 CURRENT**

`vault/11-更新窗口策略与七日天气.md` 记录：

```markdown
- Task 1 updater 接入：✅ `7485835`
- Task 2 纯窗口策略归约器：✅ 记录测试数量与命令
- 当前下一任务：Task 3 平台效果规划与现有岛窗口入口迁移
```

`vault/CURRENT.md` 的唯一下一动作改为：

```markdown
**继续增强总计划 Phase 1 / Task 3：`EffectPlan` 测试和 RED 已建立，不得重建；先修复同态显式 focus 未生成 `WindowOp::Focus`，并让全套 policy 测试与 rustfmt 变绿，再接入 `lib.rs`、monitor 和 App。不得越过 Task 3 实施穿透、全屏、天气或插件路线图。**
```

本轮到此停止，不实现 Task 3。

- [ ] **Step 3: 运行完整本批次自动化门禁**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture
git diff --check
```

Expected: 所有命令 exit 0；记录 Vitest 总数、window-policy 6/6、tsc/build 结果。若全量前端测试发现当前工作区其他未提交功能回归，保持任务进行中并报告，不把失败归咎于本任务前先定位。

- [ ] **Step 4: 核对禁止范围与工作区保护**

Run:

```bash
git status --short
git diff --name-only
```

Expected: 可以看到进入会话前已有的路径和本批次路径；不得出现新的 plugin host/bridge/manifest/market 文件，不得出现 AI/voice 插件迁移或 sherpa 删除。确认没有 staged changes，除非用户之后明确授权 commit。

- [ ] **Step 5: 请求 Windows 手工快速验收 FIX-10A-02**

Ask user to verify:

```text
1. 打开时间页并快速敲击木鱼多次。
2. 在 500ms 内切换到另一页，使木鱼组件卸载。
3. 切回时间页，确认今日与累计功德包含最后几次敲击。
4. 正常连续敲击时 UI 立即增长，没有每击可见卡顿。
```

Expected: 重挂载后尾部计数不丢失。纯 WindowPolicy Task 2 无 GUI 效果，不要求窗口真机验收。

- [ ] **Step 6: 如用户明确授权，再按功能路径提交**

在未获授权时跳过本步骤并保留工作区。若用户明确要求 commit，先运行：

```bash
git diff --cached --name-only
```

Expected: 初始为空。由于 `WoodenFishWidget.tsx` 同时含 FIX-10A-01/02，不能假装拆成互不包含的提交；应先向用户说明并获得一次合并时间修复提交的授权。窗口策略归约器及其进度文档可另做独立提交，且不得暂存滚轮、stock、terminal、storage 初始化或其他不属于该提交的路径。

---

## Execution Stop Boundary

本计划完成后必须停止在以下状态：

```text
FIX-10A-02 ✅
模块 10 仍 🚧，后续任务保留但按用户确认暂停
模块 11 Task 1 ✅（既有 7485835）
模块 11 Task 2 ✅（纯 reducer）
CURRENT → Task 3
Task 3 及后续未实施
插件市场/语音/问答插件化：仅规划，无代码变更
```

不得因为总计划已经存在而继续批量执行 Task 3–16。
