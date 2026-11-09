# 当前执行入口

> 当前阶段：模块 14、BUG-20261108-01、模块 15 均已实现且自动化全绿，等用户同轮真机验收
> 前置状态：模块 14 T1–T5 已本地提交（`7094ee4`、`12c8080`、`bdccbf7`、`0b6a69a`，main 领先 origin 4 个提交，未 push）；2026-08-18 真机反馈修复、BUG-20261108-01 与模块 15 在工作区未提交
> 更新时间：2026-11-08
> 契约：[14-位置外观增强需求包.md](./14-位置外观增强需求包.md) / [15-语音问答轻量卸载.md](./15-语音问答轻量卸载.md) / [BUG-20261108-01](./BUG-20261108-01-胶囊悬停与贴边几何异常.md)
> 历史模块（已收口）：[13-贴顶新UI与设置分类.md](./13-贴顶新UI与设置分类.md) / [11a-更新窗口策略与七日天气.md](./11a-更新窗口策略与七日天气.md) / [10-审计整改.md](./10-审计整改.md)

## 五条执行规则

1. **本文件是唯一当前执行入口。**
2. 执行顺序固定：BUG-20261108-01 → 模块 15 → 用户一次性真机验收（模块 14 + BUG + 15）→ 逐次授权 commit。
3. 单人模式：主 Agent 串行实现 → 实现者自审 → 测试 → 按授权范围 commit；commit 逐次授权，push/tag/发布单独授权。
4. 严格遵循 vault 14 / 15 冻结契约与「明确不做」项；功能冲突立即停止并交用户拍板。
5. 不覆盖、暂存或提交工作区无关改动；未经明确授权不 push、tag、发布或改写历史。

## 唯一当前动作

**等用户一次性真机验收**：模块 14 T1–T5 + 08-18 真机反馈修复、[BUG-20261108-01](./BUG-20261108-01-胶囊悬停与贴边几何异常.md)、[15-语音问答轻量卸载](./15-语音问答轻量卸载.md) 均已实现，自动化全绿并已过 1 轮独立只读审查（8 条发现全部处理；前端 53 files / 507 tests、Rust 185 passed / 1 ignored；2026-11-09 真机第 1 轮发现 Alt+拖动结束判定缺陷，已改为 Rust 判定，见 BUG vault「真机第 1 轮」），改动全部在工作区未提交。验收通过后逐次授权 commit；push/tag/发布单独授权。

- BUG-20261108-01 真机检查点：该 BUG vault「修复结果」末段与 9 条复现路径。
- 模块 15 真机检查点：vault/15「测试要点」最后一条。
- 2026-11-09 真机：Alt+拖动、任务栏嵌入条点击（[BUG-20261109-01](./BUG-20261109-01-任务栏嵌入条点击异常.md)）用户已确认修好；资源管理器重启后自动重挂（[BUG-20261109-02](./BUG-20261109-02-资源管理器重启后嵌入条无法重挂.md)）实机已通过，待用户确认重建后的点击。
- 模块 14 真机验收点（与 BUG 修复同轮）：T1 长度从中间两侧伸缩；T2 展开/收起透明度各自生效；T3 Alt+拖动落点持久化、重启保持、跨屏留在目标屏；T4 四边吸附与左右竖向图标导航；T5 设置外观页切「任务栏嵌入条」→ 条在开始按钮旁、点击左下角展开、再点/Esc 收起、切回悬浮/贴顶无双入口、重启恢复、重启 Explorer 后自动重挂、导出/导入携带 `window:*:taskbar` 键。
- 13a 取消结论与三条硬事实见 `vault/13a-左下角贴角模式.md`（两窗口拆分、Win32 易错点、点击而非悬停），T5 实现已逐条遵守。

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
