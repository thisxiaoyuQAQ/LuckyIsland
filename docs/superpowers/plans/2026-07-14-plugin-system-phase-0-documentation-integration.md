# Plugin System Phase 0 Documentation Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已批准并通过独立安全复核的插件专项阶段 0 规格纳入 LuckyIsland 的权威项目入口，同时明确关闭阶段 0、保留现有模块 10/11 现场，并阻止阶段 1 被误当成当前编码任务。

**Architecture:** 本计划只修改文档状态和项目脚手架索引，不修改 Rust、TypeScript、Tauri 配置、依赖或数据库。以阶段 0 设计规格为事实源，新建一个插件专项 Vault 作为生命周期记录；`vault/CURRENT.md` 只记录“阶段 0 已关闭、下一步需另行立项”的安全停点，并保存返回模块 10 的指针，不吞并现有审计整改任务。

**Tech Stack:** Markdown、Git、项目现有 lite 脚手架（`项目备忘录.md`、`vault/`、`docs/开发进度.md`、`docs/superpowers/specs/`）

## Global Constraints

- 阶段 0 只产出安全与产品规则，不编写插件运行时生产代码。
- 不新增 `plugin/`、Plugin Host、manifest parser、市场 API、设置开关或卸载入口。
- 不修改或迁移现有 AI、voice、hotkeys、notify、window policy 源码。
- 阶段 1 必须另行执行 brainstorming，另写设计规格和实施计划；本计划不得生成阶段 1 编码任务。
- 首版插件平台边界仍为 Windows 10/11 x64；该事实只同步到插件专项文档，不改现有应用平台配置。
- 工作区已有大量其他未提交改动；每次暂存与提交必须使用精确路径，禁止 `git add .`、`git add -A`、stash、reset、clean 或覆盖无关文件。
- 主 Agent 串行执行；阶段 0 已使用唯一独立安全审查 Agent，不再新增审查扇出。
- 不运行 Cargo、Vitest、TypeScript 或 GUI 验证：本计划没有产品代码变更；只运行 Markdown/文本一致性和 scoped Git 检查。
- 不 push、tag、发布或删除分支。

---

## File Structure

- Modify: `docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md` — 将状态改为最终批准，并写入独立安全复核结果及阶段 0 关闭结论。
- Modify: `docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md` — 将路线图的“未来启动”状态更新为阶段 0 已完成、阶段 1 尚未立项，并保留路线图不可直接执行的约束。
- Create: `vault/12-plugin-system-phase-0.md` — 保存插件专项阶段 0 的目标、决策、复核证据、完成状态和后续安全停点。
- Modify: `vault/CURRENT.md` — 把本 session 的唯一入口更新为阶段 0 文档收口；保留模块 10 的暂停点和恢复入口，明确当前没有阶段 1 编码授权。
- Modify: `docs/开发进度.md` — 新增插件专项阶段 0 的完成行和简洁验收记录，不篡改模块 10/11 的既有状态。
- Modify: `项目备忘录.md` — 增加插件专项文档指针、依赖关系和不可误执行约束；不复制完整威胁模型。

---

### Task 1: Finalize the Approved Phase 0 Specification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md:1-7`
- Modify: `docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md` after `## 20. 阶段 0 完成门禁`

**Interfaces:**
- Consumes: 用户对书面规格的最终批准；同一独立审查 Agent 的复审结论（LI-SEC-001～010 全部 resolved，最终 verdict 为 Pass）。
- Produces: 可由 Roadmap、Vault、开发进度和项目备忘录引用的最终阶段 0 事实源。

- [ ] **Step 1: Capture the current scoped state before editing**

Run:

```bash
git status --short -- docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
```

Expected: exactly one line for this path, currently `?? docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md`; if the status differs, inspect only this file before proceeding and do not overwrite external changes.

- [ ] **Step 2: Replace the header status with the final gate state**

Change the header to exactly:

```markdown
> 日期：2026-07-14  
> 状态：阶段 0 设计已获用户最终批准；独立安全复核 Pass；阶段 0 已完成  
> 上游路线图：[2026-07-13-plugin-market-roadmap.md](./2026-07-13-plugin-market-roadmap.md)  
> 适用平台：Windows 10/11 x64  
> 本阶段性质：安全与产品规则设计，不编写插件运行时生产代码
```

- [ ] **Step 3: Add the independent review record after the Phase 0 gate section**

Insert this exact subsection after the paragraph that says the gate does not authorize Phase 1 coding:

```markdown
### 20.1 独立安全复核记录

2026-07-14 使用唯一一个独立只读安全审查 Agent 对本规格进行两轮复核，未检查或修改无关工作区文件。

初审提出 LI-SEC-001～LI-SEC-010：同用户攻击者边界、原生隔离可测试属性、开发包身份、撤销反回滚、预激活健康检查、安全删除、DNS/私网绕过、安装与授权语义、可信 UI、不可删除安全状态。规格逐项修订后，复审确认 10/10 已解决，未发现新增高或中严重度问题，最终门禁为 **Pass**。

该 Pass 只证明阶段 0 安全规格具备进入用户最终审批的条件，不证明插件运行时已经实现，也不授权阶段 1 编码。
```

- [ ] **Step 4: Verify the specification contains no unresolved placeholders or stale pending status**

Run:

```bash
rg -n "TBD|TODO|待定|待确认|待书面规格复核|待最终确认" docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
```

Expected: no output and exit code 1 from `rg` because no forbidden marker remains.

Run:

```bash
rg -n "阶段 0 设计已获用户最终批准|10/10 已解决|最终门禁为 \*\*Pass\*\*|不授权阶段 1 编码" docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
```

Expected: four matching lines covering final approval, review resolution, Pass, and the Phase 1 prohibition.

- [ ] **Step 5: Check Markdown whitespace and stage only the specification**

Run:

```bash
git diff --check -- docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
git add -- docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
git diff --cached --name-only
```

Expected: `git diff --check` has no error; cached names contain only `docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md` at this checkpoint.

- [ ] **Step 6: Commit the finalized specification as an isolated document commit**

```bash
git commit -m "docs(plugin): finalize phase 0 threat model"
```

Expected: one commit containing only the new phase 0 specification. Do not push.

---

### Task 2: Create the Phase 0 Vault and Close the Roadmap Transition

**Files:**
- Create: `vault/12-plugin-system-phase-0.md`
- Modify: `docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md:1-6`
- Modify: `docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md:645-656`

**Interfaces:**
- Consumes: finalized phase 0 specification from Task 1.
- Produces: lifecycle record for phase 0 and an updated roadmap boundary that points to phase 1 as a separate future project.

- [ ] **Step 1: Create the plugin phase 0 Vault with exact lifecycle facts**

Create `vault/12-plugin-system-phase-0.md` with:

```markdown
# 12 - 插件系统阶段 0：威胁模型与产品规则

> 状态：✅ 已完成  
> 完成日期：2026-07-14  
> 设计规格：[阶段 0 威胁模型与产品规则](../docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md)  
> 上游路线图：[插件市场路线图](../docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md)

## 本阶段目标

为 LuckyIsland 的公开第三方插件生态建立可执行的安全与产品契约，不编写插件运行时生产代码。

## 已批准边界

- Windows 10/11 x64；
- WASM/WASI、受限原生 Host、隔离 Web UI 共用统一 capability 语义；
- 第三方二进制永不加载进 LuckyIsland 主进程；
- 原生插件隔离属性缺一即拒绝启动，不向普通用户提供不安全降级；
- 正式版提供默认关闭的签名侧载和未签名开发者模式，两者都不能绕过隔离、权限、包检查或撤销；
- 普通下架与高危撤销分级，高危撤销立即停止但不静默删除用户数据；
- 遥测默认关闭，安全索引与撤销获取按必要通信处理；
- 首个公开市场只支持免费插件。

## 安全复核

唯一独立只读安全审查初审提出 LI-SEC-001～LI-SEC-010。修订后复审确认 10/10 已解决，无新增高或中严重度问题，最终 verdict：**Pass**。

## 明确未实施

- 未创建插件运行时、Host、manifest parser、Bridge、市场 API 或插件设置页；
- 未迁移 AI、语音、热键、通知或现有数据；
- 未选择 WASI、RPC、AppContainer/受限 Token 封装或网络代理实现；
- 未运行产品代码测试，因为本阶段没有产品代码变更。

## 后续安全停点

阶段 1 尚未立项。下一步如果继续插件专项，必须重新执行 brainstorming，只设计版本化 manifest/schema、IPC、无网络/无原生能力的官方示例插件，以及启动、停止、健康检查和崩溃隔离；随后另写阶段 1 规格和实施计划。

不得从路线图、本 Vault 或阶段 0 规格直接开始阶段 1 编码。

## 原有项目恢复点

插件专项开始前，项目唯一入口为模块 10「审计整改」BASE-10B 工程基线；模块 11 暂停于 Task 5。若用户不继续阶段 1，应把 `vault/CURRENT.md` 恢复到 `vault/10b-工程基线与低风险重构.md` 的 BASE-10B-03 方案评估，不得覆盖模块 10/11 的未提交现场。
```

- [ ] **Step 2: Update the roadmap header without changing its architecture content**

Replace only the roadmap status lines with:

```markdown
> 日期：2026-07-13  
> 状态：路线规划已获用户批准；阶段 0 已于 2026-07-14 完成；阶段 1 尚未立项；禁止直接作为实施计划执行  
> 长期目标：支持公开第三方插件生态，并把语音、问答迁移为可真正安装/卸载的官方插件  
> 当前边界：阶段 0 只完成威胁模型与产品规则；不实现插件运行时、市场服务、模块迁移或卸载入口
```

- [ ] **Step 3: Replace the roadmap handoff paragraph with the completed transition**

In `## 22. 当前项目交接约束`, preserve all existing exclusions and replace the final future-start sentence with:

```markdown
插件专项阶段 0 已按独立 brainstorming 完成设计、用户批准和单次独立安全复核，事实源为 [2026-07-14-plugin-system-phase-0-threat-model-design.md](./2026-07-14-plugin-system-phase-0-threat-model-design.md)。阶段 1 尚未立项；继续时必须重新执行 brainstorming，把阶段 1 单独变成可批准的设计规格，再生成独立实施计划。
```

- [ ] **Step 4: Verify roadmap and Vault boundaries**

Run:

```bash
rg -n "阶段 0 已于 2026-07-14 完成|阶段 1 尚未立项|禁止直接作为实施计划执行" docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md
rg -n "状态：✅ 已完成|10/10 已解决|不得从路线图、本 Vault 或阶段 0 规格直接开始阶段 1 编码|BASE-10B-03" vault/12-plugin-system-phase-0.md
```

Expected: every required phrase appears; the Vault contains both the plugin stop point and the preserved module 10 resume point.

- [ ] **Step 5: Verify no product files or plugin implementation directories were created**

Run:

```bash
git status --short -- src src-tauri package.json src-tauri/Cargo.toml
```

Expected: output may show pre-existing unrelated changes, but this task must not introduce new paths or alter their existing status. Compare with the session-start status; if uncertain, stop rather than staging any product path.

Run:

```bash
git status --short -- docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md vault/12-plugin-system-phase-0.md
```

Expected: exactly the roadmap modification and new Vault file.

- [ ] **Step 6: Commit only the roadmap transition and Vault**

```bash
git diff --check -- docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md vault/12-plugin-system-phase-0.md
git add -- docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md vault/12-plugin-system-phase-0.md
git diff --cached --name-only
git commit -m "docs(plugin): close phase 0 lifecycle"
```

Expected: cached names contain exactly the two named files before commit. Do not push.

---

### Task 3: Synchronize the Single Current Entry and Development Progress

**Files:**
- Modify: `vault/CURRENT.md:1-55`
- Modify: `docs/开发进度.md:4-25`
- Modify: `docs/开发进度.md` immediately after the module table

**Interfaces:**
- Consumes: completed phase 0 Vault from Task 2 and the preserved module 10/11 state already recorded in both files.
- Produces: one unambiguous current stop point and a progress record that does not reopen or overwrite modules 10/11.

- [ ] **Step 1: Replace `vault/CURRENT.md` with the phase 0 closeout stop point**

Use this exact content:

```markdown
# 当前执行入口

> 当前阶段：插件系统专项 / 阶段 0 威胁模型与产品规则  
> 状态：✅ 已完成，停在阶段边界  
> 更新时间：2026-07-14  
> 阶段记录：[12-plugin-system-phase-0.md](./12-plugin-system-phase-0.md)  
> 设计规格：[阶段 0 威胁模型](../docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md)

## 五条执行规则

1. **本文件是唯一当前执行入口。**
2. 阶段 0 只完成安全与产品规则，没有插件运行时代码。
3. 阶段 1 尚未立项；未经新的 brainstorming、设计批准和实施计划，不得创建插件代码。
4. 默认主 Agent 串行；必要时最多使用 1 个独立审查 Agent，禁止大规模扇出。
5. 不覆盖、暂存或提交工作区已有模块 10/11 改动；未经明确授权不 push、tag、发布或改写历史。

## 阶段 0 完成证据

- 用户已批准书面规格；
- 独立安全复核 LI-SEC-001～010 全部解决；
- 复审没有新增高或中严重度问题，最终 verdict 为 Pass；
- 本阶段未新增运行时、依赖、设置入口或迁移代码。

## 当前唯一下一动作

**等待用户选择后续方向。**

- 若继续插件专项：只可启动阶段 1 的独立 brainstorming，不能直接编码；
- 若返回原项目：恢复模块 10 `BASE-10B-03` 统一验证入口方案评估；模块 11 继续暂停于 Task 5。

当前没有获授权的阶段 1 实施任务。

## 保留现场

- 模块 10「审计整改」：DOC-10A、FIX-10A 已完成；原入口为 BASE-10B-03 方案评估；
- 模块 11「更新、窗口策略与七日天气」：Task 1～4 已完成，暂停于 Task 5；
- 工作区包含上述模块的未提交改动，不得覆盖、清理或夹带提交。
```

- [ ] **Step 2: Add a separate progress-table row without renumbering existing modules**

Append this row after module 11:

```markdown
| 12 | 插件系统阶段 0：威胁模型与产品规则 | ✅ | 路线图 | Windows 10/11 x64 信任边界、三维策略、原生隔离属性、侧载/撤销/离线/治理规则已获用户批准；独立安全复核 10/10 resolved、最终 Pass；未实现运行时，阶段 1 尚未立项 |
```

Do not change module 10 from `🚧` or module 11 from `🚫`.

- [ ] **Step 3: Add a concise dated progress section**

Insert immediately after the module table:

```markdown
### 2026-07-14 插件系统阶段 0 完成

- 依据插件市场路线图单独完成阶段 0 brainstorming 与书面设计，确定来源、执行载体、capability 三维默认拒绝策略，以及 Windows 10/11 x64 原生插件的机制无关隔离属性。
- 正式版保留默认关闭的签名侧载与未签名开发者模式，但两者均不能绕过包检查、主进程边界、OS 隔离、权限、资源限制或撤销。
- 唯一独立只读安全审查初审提出 LI-SEC-001～010；修订后复审确认 10/10 已解决，无新增高或中严重度问题，最终 verdict 为 Pass。
- 本阶段只修改规划与安全文档，没有实现插件运行时、市场、设置入口或 AI/语音迁移，也没有产生产品代码测试数字。
- 阶段 1 尚未立项；若继续，必须另行 brainstorming、规格和计划，不能从路线图或阶段 0 文档直接编码。
```

- [ ] **Step 4: Verify the unique-entry and progress invariants**

Run:

```bash
rg -n "当前唯一下一动作|当前没有获授权的阶段 1 实施任务|BASE-10B-03|暂停于 Task 5" vault/CURRENT.md
rg -n "\| 10 \| 审计整改 \| 🚧|\| 11 \| 更新、窗口策略与七日天气 \| 🚫|\| 12 \| 插件系统阶段 0：威胁模型与产品规则 \| ✅" docs/开发进度.md
rg -n "10/10 已解决|阶段 1 尚未立项|没有实现插件运行时" docs/开发进度.md
```

Expected: one current-action section; modules 10 and 11 retain their old states; module 12 is complete; stage 1 remains unstarted.

- [ ] **Step 5: Commit only current-entry and progress synchronization**

```bash
git diff --check -- vault/CURRENT.md docs/开发进度.md
git add -- vault/CURRENT.md docs/开发进度.md
git diff --cached --name-only
git commit -m "docs(progress): record plugin phase 0 completion"
```

Expected: cached names contain exactly `vault/CURRENT.md` and `docs/开发进度.md`. Do not push.

---

### Task 4: Update Project Memory and Run the Documentation-Only Gate

**Files:**
- Modify: `项目备忘录.md:23-47`
- Modify: `项目备忘录.md:49-53`

**Interfaces:**
- Consumes: final specification, phase 0 Vault, current entry and progress state from Tasks 1–3.
- Produces: minimal long-lived project navigation and a verified documentation-only closeout.

- [ ] **Step 1: Extend the module dependency map without rewriting existing modules**

Add this branch after the existing module 10/11 branch:

```text

插件市场路线图
  └─ 12-插件系统阶段 0（✅ 威胁模型与产品规则）
       └─ 阶段 1（尚未立项；必须另行 brainstorming/spec/plan）
```

- [ ] **Step 2: Add the two authoritative plugin pointers**

Under `## 文档指针`, add:

```markdown
- 插件市场长期路线 → docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md
- 插件系统阶段 0 安全基线 → docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md
- 插件专项阶段记录 → vault/12-plugin-system-phase-0.md
```

- [ ] **Step 3: Add the no-direct-execution reading rule**

Under `## 文档读取规则`, add:

```markdown
- 插件路线图和阶段 0 规格不是代码任务清单；阶段 1 尚未立项，只有新的 brainstorming、获批规格和独立实施计划才能授权后续编码。
```

Do not copy the complete threat model into `项目备忘录.md` and do not add plugin files to `勿动文件`, because no plugin implementation exists.

- [ ] **Step 4: Run the cross-document consistency gate**

Run:

```bash
rg -n "阶段 0.*已完成|阶段 1.*尚未立项" \
  docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md \
  docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md \
  vault/12-plugin-system-phase-0.md \
  vault/CURRENT.md \
  docs/开发进度.md \
  项目备忘录.md
```

Expected: every file reports Phase 0 complete and/or Phase 1 not started; no file claims Phase 1 implementation is active.

Run:

```bash
if rg -n "阶段 1.*(正在开发|🚧|开始编码|实施中)" \
  docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md \
  docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md \
  vault/12-plugin-system-phase-0.md \
  vault/CURRENT.md \
  docs/开发进度.md \
  项目备忘录.md; then
  printf '%s\n' 'FAIL: 阶段 1 被误标为进行中'
  exit 1
else
  printf '%s\n' 'PASS: 阶段 1 未被授权或标记为进行中'
fi
```

Expected: `PASS: 阶段 1 未被授权或标记为进行中`.

- [ ] **Step 5: Verify the final changed-file allowlist**

Run:

```bash
git diff --check -- 项目备忘录.md
git status --short -- \
  docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md \
  docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md \
  vault/12-plugin-system-phase-0.md \
  vault/CURRENT.md \
  docs/开发进度.md \
  项目备忘录.md
```

Expected: after Tasks 1–3 commits, only `项目备忘录.md` remains modified among this allowlist.

Run:

```bash
git diff --name-only HEAD -- \
  docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md \
  docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md \
  vault/12-plugin-system-phase-0.md \
  vault/CURRENT.md \
  docs/开发进度.md \
  项目备忘录.md
```

Expected before the final commit: only `项目备忘录.md`; previously committed paths are clean relative to `HEAD`.

- [ ] **Step 6: Commit the project navigation update only**

```bash
git add -- 项目备忘录.md
git diff --cached --name-only
git commit -m "docs(project): index plugin phase 0 baseline"
```

Expected: cached names contain exactly `项目备忘录.md`. Do not push.

- [ ] **Step 7: Perform final evidence checks without product builds**

Run:

```bash
git log -4 --oneline --decorate
```

Expected: the latest four commits include the three or four isolated documentation commits from this plan, depending on whether the plan document itself was committed separately by the executor.

Run:

```bash
git status --short
```

Expected: pre-existing unrelated module 10/11 changes may remain. The six phase 0 integration files named by this plan are clean. Do not claim the whole working tree is clean.

Run:

```bash
for path in \
  docs/superpowers/specs/2026-07-14-plugin-system-phase-0-threat-model-design.md \
  docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md \
  vault/12-plugin-system-phase-0.md \
  vault/CURRENT.md \
  docs/开发进度.md \
  项目备忘录.md; do
  test -f "$path" || { printf 'MISSING: %s\n' "$path"; exit 1; }
done
printf '%s\n' 'PASS: phase 0 authority chain present'
```

Expected: `PASS: phase 0 authority chain present`.

Do not run `cargo`, `pnpm test`, `pnpm build`, or GUI smoke tests because this plan changes documentation only and the user may have `pnpm tauri dev` holding the Rust target directory.

---

## Plan Self-Review Record

- **Spec coverage:** Every stage 0 requirement remains in the approved specification; this plan only finalizes approval/review status and synchronizes the authoritative project chain. Phase 1 is explicitly excluded in every lifecycle file.
- **Placeholder scan:** The plan contains no `TBD`, `TODO`, “implement later”, unspecified tests, or undefined code interfaces. Future Phase 1 work is described as a prohibited scope requiring a new design cycle, not as a placeholder in this plan.
- **Type consistency:** No runtime types or functions are introduced. Status names, file paths, LI-SEC identifiers, platform scope and Phase 1 boundary are consistent across tasks.
- **Safety:** Every commit uses path-specific staging. The plan never uses broad staging, stash, reset, clean, push or product build commands.
