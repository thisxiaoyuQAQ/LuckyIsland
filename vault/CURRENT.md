# 当前执行入口

> 当前阶段：模块 13「贴顶新 UI 与设置分类」（2026-07-26 用户授权「全做」，单人模式，main 分支线性）
> 前置状态：模块 11a「悬浮胶囊/两段悬停/双视觉样式」✅ 已完成并发布 v0.4.0；工作区干净
> 更新时间：2026-07-26
> 冻结契约：[13-贴顶新UI与设置分类.md](./13-贴顶新UI与设置分类.md)
> 历史模块（已收口）：[11a-更新窗口策略与七日天气.md](./11a-更新窗口策略与七日天气.md) / [10-审计整改.md](./10-审计整改.md)

## 五条执行规则

1. **本文件是唯一当前执行入口。**
2. 本 session 处理模块 13 增量（A 设置分类 / B 贴顶停靠+新 UI 外壳 / C 新 UI 紧凑组件条），按 A→B→C 顺序串行实施。
3. 单人模式：主 Agent 串行实现 → 实现者自审 → 测试 → 按授权范围 commit；commit 逐次授权，push/tag/发布单独授权。
4. 严格遵循 vault 13 冻结契约与「明确不做」项（不改窗口几何、不做组件条配置化、不动插件/ai/voice）；功能冲突立即停止并交用户拍板。
5. 不覆盖、暂存或提交工作区无关改动；未经明确授权不 push、tag、发布或改写历史。

## 唯一当前动作

**模块 13 已真机验收通过（2026-07-26），本地 4 commit（未 push）。当前：模块 13a 左下角贴角模式已实现，待真机验收。**

- 13a = `window:ui_mode` 第三值 `corner`：`monitor.rs` `Placement`(工作区左下角定位) + `window_policy.rs` corner 静息胶囊 / 底边锚定展开 + `window_ui_mode_set` 接受 corner + 前端 corner 外壳/三选一开关。冻结契约 `vault/13a-左下角贴角模式.md`。
- 自动化全绿：前端 typecheck + 430 tests + build；Rust `cargo test --lib` 150/0 + `clippy --lib -D warnings` 干净（独立 `CARGO_TARGET_DIR=.omc/cargo-check-target` + `SHERPA_ONNX_LIB_DIR` + `CARGO_HTTP_CHECK_REVOKE=false`，未抢 tauri dev 锁）。
- 待用户真机验收：贴左下角在任务栏之上、胶囊静息、悬停/点击向上展开、三模式互切即时生效、重启保持、导入导出携带、多屏/DPI；展开动画衔接若有 jank 需迭代。逐次授权提交（docs(13a) + feat(13a) Rust + feat(13a) 前端）。

## 已完成状态

- DOC-10A、FIX-10A：✅。
- BASE-10B-01：✅ 统一验证入口与严格门禁。
- BASE-10B-02：✅ Node + happy-dom React 生命周期测试层。
- BASE-10B-03：✅ Node/pnpm/Rust 声明、registry 诊断、原生 DLL 来源与默认 release 打包前置检查。
- REF-10B-01：✅ 统一 Tauri event 生命周期；共享 hook + 全量业务 listener 分批迁移收口。
- REF-10B-02：✅ 共享主题同步（批次 B1）；theme.ts + 三入口接入。
- REF-10B-03：✅ 轻量拆分 App（registry + useIslandSettings / useIslandEvents / useIslandNavigation）。
- REF-10B-04：✅ SQLite 版本化 migration（批次 B3）；user_version + 事务 + 失败回滚 + 防降级。
- REF-10B-05：✅ 日志脱敏轮转（批次 B4）；tracing 设施 + 启动/退出接入。
- REF-10B-06：✅ P2 渐进项（B5b Weather 按城市状态机 / B5c IPC unknown 校验 / B5d AiPalette reducer 一阶段 / B5e 设置字段 draft-persisted）。
- RUN-10C-01～06：✅ 真机/安装态矩阵全部通过（2026-07-19 用户确认）。
- 插件系统阶段 0：✅ 威胁模型与产品规则已完成；阶段 1 未立项，禁止直接创建插件运行时代码。
- 模块 11：✅ Task 1～16 全部完成，自动化、兼容性、Windows 窗口策略与天气矩阵通过（v0.3.0）；「双发布流程」任务 2026-07-19 用户取消。

## 2026-07-19 RUN-10C 真机验收收口

- 用户确认 6 项真机验证（副屏断开恢复 / NSIS 安装后 lucky-notify / 整窗手动穿透 / Release 冷启动与资源基线 / 24h 长跑 / 语音全链路）全部通过；检查单位于 `docs/验收/RUN-10C/`，状态与日期已同步。
- 同期一并提交：`src-tauri/Cargo.lock`（`webpki-root-certs 1.0.8 → 1.0.9`，依赖解析副作用）与 `src-tauri/tauri.conf.json`（`createUpdaterArtifacts: false`，用户主动确认）。

## 2026-07-18 并行批次 B1/B3/B4 证据

三路按方案二并行规划、主 Agent 串行 TDD 实施，各自独立 verify。均未提交、未 push。

- **B1（REF-10B-02 主题）**：新增 `src/lib/theme.ts`（parseThemeMode/systemTheme/resolveTheme/applyTheme/startThemeSync/useTheme）；`settings/main.tsx`、`ai-palette/main.tsx` 两份重复 bootstrap 收敛为 `startThemeSync`；`App.tsx` 改用 `useTheme` + `parseThemeMode`。theme 专项 21 + useTheme 专项 5；verify 前端 35 files / 341 tests、Rust lib 119/1 全绿。
- **B3（REF-10B-04 migration）**：`storage/mod.rs` 收敛为 `PRAGMA user_version` 版本化迁移（v1 基线 + v2 priority），每版事务执行、失败回滚不前进、断点续传、拒绝降级。migration_tests 7/7；verify 前端 341、Rust lib 126/1 全绿。
- **B4（REF-10B-05 日志）**：新增 `logging.rs`（redact 脱敏 + RedactingWriter + 按天轮转 init_logging，EnvFilter 默认 info、Release 可定位）；接入启动/退出，guard 经 resource 持有到退出 flush；新增 tracing/tracing-subscriber/tracing-appender 依赖（lock 纯新增）。logging 7/7；verify 前端 341、Rust lib 133/1 全绿。
- 三窗口主题真机同步、真实用户库迁移、Release 日志轮转/密钥扫描均未做真机/安装态验收（已在 2026-07-19 RUN-10C 收口）。

## 2026-07-18 REF-10B-06 P2 批次（B5b/B5c/B5d/B5e）证据

- **B5b Weather 按城市请求状态机**：删除全局 RequestGate，改按城市独立 `CityFetchEntry`（token/generation/pending/inflight/error/candidates）；同步 ref 作 token 真源、setState 仅作渲染派生；缓存写入移到 token 校验后。新增 `city-fetch.test.ts` 13 项 + WeatherPage 组件用例 3 项；verify 前端 36/357 全绿。
- **B5c IPC unknown 校验**：新增 `src/lib/ipc-guard.ts` 守卫原子 + `src/lib/ipc-schemas.ts` 4 域集中守卫；12 个 invoke/事件边界（AI/通知/天气/股票）全部改 `invoke<unknown>` + `assertIpc`；新增 `ipc-schemas.test.ts` 16 项；verify 前端 38/377 全绿。
- **B5d AiPalette 请求状态机（一阶段）**：新增 `src/ai-palette/aiPaletteState.ts` reducer + 14 action；取消/晚到不变量由 reducer 强制；Provider/语音/UI 结构未动（归二阶段）。新增 `aiPaletteState.test.ts` 15 项；verify 前端 39/392 全绿。
- **B5e 设置字段 draft/persisted 分离**：新增 `src/settings/useDraftField.ts`；迁移 4 panel 5 字段（AiHistory chat_api_base_url/key/model、Voice wake:keyword/reply、Terminal shell/fontSize、Weather refresh_min）；新增 `useDraftField.test.tsx` 9 项；verify 前端 40/401 全绿。

## 当前环境约束

- 工作区包含模块 10/11/12 大量未提交改动，不得覆盖或清理；本批 B1/B3/B4 改动同样未提交。
- Cargo 验证使用独立 `CARGO_TARGET_DIR`；正式 Tauri 打包使用默认 target。
- **verify 需带 env**：`SHERPA_ONNX_LIB_DIR=<绝对路径>/lib` + `CARGO_HTTP_CHECK_REVOKE=false`（新增 tracing 触发 sherpa 重链时相对 LIBPATH 解析失败、离线 SSL 撤销检查失败，均为环境约束）。
- GUI、安装态和真机证据必须与自动化分开记录。

## 下一步候选（11a 收口后）

- **PROD-10C-01～04 产品待决**：完整待办范围 / 导航与专注模式 / 通知与窗口可配置项 / AI 历史撤销与确认。需要用户拍板。
- **RISK-10C-01～06 高风险候选**：PTY 生命周期 / 语音下载与状态机 / Provider 拆分与协议边界 / AI 动作原子性 / command 权限与 CSP / Composition root。需先复现矩阵或设计结论。
- **AiPalette 二阶段**：Provider/语音/UI 拆分（B5d 已完成 reducer 一阶段）。
