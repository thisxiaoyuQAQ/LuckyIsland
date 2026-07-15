# 当前执行入口

> 当前阶段：模块 10「审计整改」/ REF-10B-01 统一 Tauri event 生命周期
> 状态：🚧 首批共享 hook 已实现并通过统一门禁；业务迁移待确认
> 更新时间：2026-07-15
> 总控：[10-审计整改.md](./10-审计整改.md)
> 执行单：[10b-工程基线与低风险重构.md](./10b-工程基线与低风险重构.md)

## 五条执行规则

1. **本文件是唯一当前执行入口。**
2. 本 session 只处理审计整改，不开发新功能。
3. 默认主 Agent 串行；必要时最多使用 1 个独立审查 Agent，禁止大规模扇出。
4. 高风险候选无新复现/设计结论不得直接编码；产品项无用户决策不得实施。
5. 不覆盖、暂存或提交工作区已有模块 10/11/12 改动；未经明确授权不 push、tag、发布或改写历史。

## 已完成状态

- DOC-10A、FIX-10A：✅。
- BASE-10B-01：✅ 统一验证入口与严格门禁。
- BASE-10B-02：✅ Node + happy-dom React 生命周期测试层。
- BASE-10B-03：✅ Node/pnpm/Rust 声明、registry 诊断、原生 DLL 来源与默认 release 打包前置检查。
- 插件系统阶段 0：✅ 威胁模型与产品规则已完成；阶段 1 未立项，禁止直接创建插件运行时代码。
- 模块 11：Task 1～4 已完成，继续暂停于 Task 5。

## BASE-10B-03 最终证据

- DLL checker RED：实现模块缺失；GREEN fixture 4/4（完整、缺文件、空文件、缺映射）。
- `pnpm check:native-runtime`：默认 release target 的 4 个 Tauri 映射源 DLL 均存在且非空。
- 声明环境与实机一致：Node 22、pnpm 10.15.0、Rust 1.92.0 stable-msvc。
- 最新连续 `pnpm verify`：TypeScript、前端 14 files / 127 tests、三入口 build、Rust fmt、严格 Clippy、Rust lib 74/74、cargo check 全部 exit 0。
- 未重新打包或安装；不声称 NSIS 内部清单、安装后 DLL 加载、PATH 或真机语音通过。

## REF-10B-01 当前证据

- 共享层：新增 `useAsyncSubscription` / `useTauriEvent`，专项 2 files / 17 tests；独立审查修复未提交 render ref 泄漏和旧订阅错误误归，复核无新增 finding。
- App 批：settings、window-state、notify 三类订阅已迁移；App 集成测试 4/4 覆盖通知稳定订阅、最新页面设置、window payload、卸载晚 resolve 与 StrictMode。
- App 批独立审查补强 blur/opacity 与旧字符串 payload 的可观察断言后，复核无 finding；并行 hover `enable()` hunk完整保留。
- 最新连续 `pnpm verify` 使用独立 `.superpowers/target-check`，TypeScript、前端 19 files / 155 tests、三入口 build、Rust fmt、严格 Clippy、Rust lib 90/90、cargo check全部 exit 0。
- 未迁移 Stock、NotifyPage、Weather、Terminal、设置窗口或 AI listener；未做 GUI、安装态或真机 Tauri 验证。

## 唯一下一动作

**App 批已完成并通过统一门禁。下一候选按既定顺序是 Stock listener 迁移；实施前需单独只读评估 Stock 的 tick、config imported、settings 三类订阅与现有异步读取边界，不连带迁移 NotifyPage、Weather 或 Terminal。**

## REF-10B-01 边界

- 先保护“卸载前 resolve 正常 cleanup”和“卸载后 resolve 立即 cleanup”；
- handler 必须读取最新闭包，不因订阅重建造成事件空窗；
- Promise rejection 统一处理但不吞掉可诊断错误；
- 分批迁移，单批只改一类入口；
- 不借机拆 App、改主题同步、改变导航/窗口策略或让隐藏页面 keep-alive；
- 模块 11 与插件阶段 1 均不在本项实施范围。

## 当前环境约束

- 工作区包含模块 10/11/12 大量未提交改动，不得覆盖或清理。
- Cargo 验证使用独立 `CARGO_TARGET_DIR`；正式 Tauri 打包使用默认 target。
- GUI、安装态和真机证据必须与自动化分开记录。
