# 当前执行入口

> 当前阶段：模块 10「审计整改」/ REF-10B 低风险重构
> 状态：🚧 REF-10B-01/02/04/05 已完成并通过统一门禁；下一项 REF-10B-03 轻量拆分 App（依赖页面 registry 契约测试）
> 更新时间：2026-07-18
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
- REF-10B-01：✅ 统一 Tauri event 生命周期；共享 hook + 全量业务 listener 分批迁移收口。
- REF-10B-02：✅ 共享主题同步（批次 B1）；theme.ts + 三入口接入。
- REF-10B-04：✅ SQLite 版本化 migration（批次 B3）；user_version + 事务 + 失败回滚 + 防降级。
- REF-10B-05：✅ 日志脱敏轮转（批次 B4）；tracing 设施 + 启动/退出接入。
- 插件系统阶段 0：✅ 威胁模型与产品规则已完成；阶段 1 未立项，禁止直接创建插件运行时代码。
- 模块 11：Task 1～4 已完成，继续暂停于 Task 5。

## 2026-07-18 并行批次 B1/B3/B4 证据

三路按方案二并行规划、主 Agent 串行 TDD 实施，各自独立 verify。均未提交、未 push。

- **B1（REF-10B-02 主题）**：新增 `src/lib/theme.ts`（parseThemeMode/systemTheme/resolveTheme/applyTheme/startThemeSync/useTheme）；`settings/main.tsx`、`ai-palette/main.tsx` 两份重复 bootstrap 收敛为 `startThemeSync`；`App.tsx` 改用 `useTheme` + `parseThemeMode`。theme 专项 21 + useTheme 专项 5；verify 前端 35 files / 341 tests、Rust lib 119/1 全绿。
- **B3（REF-10B-04 migration）**：`storage/mod.rs` 收敛为 `PRAGMA user_version` 版本化迁移（v1 基线 + v2 priority），每版事务执行、失败回滚不前进、断点续传、拒绝降级。migration_tests 7/7；verify 前端 341、Rust lib 126/1 全绿。
- **B4（REF-10B-05 日志）**：新增 `logging.rs`（redact 脱敏 + RedactingWriter + 按天轮转 init_logging，EnvFilter 默认 info、Release 可定位）；接入启动/退出，guard 经 resource 持有到退出 flush；新增 tracing/tracing-subscriber/tracing-appender 依赖（lock 纯新增）。logging 7/7；verify 前端 341、Rust lib 133/1 全绿。
- 三窗口主题真机同步、真实用户库迁移、Release 日志轮转/密钥扫描均未做真机/安装态验收（归 RUN-10C）。

## 当前环境约束

- 工作区包含模块 10/11/12 大量未提交改动，不得覆盖或清理；本批 B1/B3/B4 改动同样未提交。
- Cargo 验证使用独立 `CARGO_TARGET_DIR`；正式 Tauri 打包使用默认 target。
- **verify 需带 env**：`SHERPA_ONNX_LIB_DIR=<绝对路径>/lib` + `CARGO_HTTP_CHECK_REVOKE=false`（新增 tracing 触发 sherpa 重链时相对 LIBPATH 解析失败、离线 SSL 撤销检查失败，均为环境约束）。
- GUI、安装态和真机证据必须与自动化分开记录。

