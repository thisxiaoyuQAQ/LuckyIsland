# 10d-origin-dev 审计文档合并说明

> 状态：✅ 文档合并完成，后续实现待执行
> 合并日期：2026-07-13
> 来源：`origin/dev`（`4e808ee`，前置审计保存提交 `293e3fa`）
> 目标：本地 `main` 工作区（基准提交 `df0fbc2`）
> 合并方式：选择性文件同步，不合并独立 Git 历史
> 审计执行入口：[CURRENT.md](./CURRENT.md)
> 审计总控：[10-审计整改.md](./10-审计整改.md)

## 1. 合并目的与结果

本次合并只把 `origin/dev` 中已经整理完成的审计事实、任务分层、历史计划状态和模块 Vault 修订同步到 `main`，不把 `dev` 当作功能分支整体合并。

结果：

- 新增模块 10 审计整改总控、三个分阶段执行单和唯一执行入口；
- 将已审计修订的核心文档、历史 plan/spec 状态声明和既有模块 Vault 同步为 `dev` 版本；
- 保留 `main` 的 README、界面画廊、图片资源、后续增强设计和插件路线图；
- 未修改任何业务源码、依赖、构建配置或 Git 历史；
- 未执行提交、push、发布或分支删除。

## 2. 实际合入内容

### 2.1 新增审计文件

以下文件从 `origin/dev` 新增到 `main`：

1. `vault/10-审计整改.md`
   - 模块 10 总控；
   - 建立 DOC、FIX、BASE、REF、RISK、PROD、RUN 七类任务；
   - 明确批次顺序、完成定义和状态回写顺序。
2. `vault/10a-文档同步与确定性修复.md`
   - 文档事实同步；
   - 多屏/点击穿透契约确认；
   - 三个确定性行为缺口的测试与修复要求。
3. `vault/10b-工程基线与低风险重构.md`
   - 统一验证入口、React 生命周期测试和可复现环境；
   - Tauri event 生命周期、主题同步、App 拆分、SQLite migration、日志等渐进重构任务。
4. `vault/10c-高风险候选与产品验证.md`
   - PTY、语音、Provider、AI 原子性、权限/CSP 等高风险候选；
   - 产品待决项和 Windows 真机/安装态验证矩阵。
5. `vault/CURRENT.md`
   - 将模块 10 设为审计体系中的唯一执行入口；
   - 合并当时下一动作指向 `DOC-10A-03`；该契约任务现已完成，当前入口已推进至 `FIX-10A-01`。

### 2.2 同步为 dev 版本的核心文档

- `docs/AI助手方案.md`
- `docs/审计/2026-07-13-项目与文档同步审计.md`
- `docs/开发进度.md`
- `docs/技术栈规划.md`
- `docs/需求文档.md`
- `项目备忘录.md`

这些修订主要用于：

- 按当前源码收敛架构和能力描述；
- 明确 SQLite settings KV、AI Provider、联网方式、非流式回复、真正取消、语音 ASR、多屏回退和热键等事实；
- 把旧 plan 的未勾选框定义为历史执行记录，而不是当前 TODO；
- 建立 `CURRENT → 开发进度 → 模块 Vault → 当前代码/新验证 → spec → plan` 的读取顺序；
- 避免为了迎合旧规划而修改当前正确实现。

### 2.3 同步为 dev 版本的历史实施文档

Plans：

- `docs/superpowers/plans/2026-07-06-m5-notifications.md`
- `docs/superpowers/plans/2026-07-10-ai-request-cancellation-and-provider-reliability.md`
- `docs/superpowers/plans/2026-07-10-voice-listening-event-delivery.md`
- `docs/superpowers/plans/2026-07-11-multi-monitor-selection.md`
- `docs/superpowers/plans/2026-07-12-time-page-widgets.md`

Specs：

- `docs/superpowers/specs/2026-07-06-m5-notifications-design.md`
- `docs/superpowers/specs/2026-07-10-ai-request-cancellation-and-provider-reliability-design.md`
- `docs/superpowers/specs/2026-07-11-multi-monitor-selection-design.md`
- `docs/superpowers/specs/2026-07-11-time-page-widgets-design.md`

合并后的边界：spec 继续作为设计基线；plan 只描述当时的实施过程。旧 plan 中遗留的未勾选项、旧“下一 Session”和旧测试快照不得自动转成新任务。

### 2.4 同步为 dev 版本的既有模块 Vault

- `vault/02-灵动岛外壳.md`
- `vault/06-通知系统.md`
- `vault/08-AI助手.md`

这些文件用于同步当前实现事实、合法历史偏离、稳定模块边界和后续复验要求，不代表重新开启已关闭的 BUG。

## 3. 明确未合入的内容

### 3.1 README 与展示资源

按用户确认，`README.md` 保持 `main` 版本，不采用 `dev` 删除界面画廊的修改。

因此以下内容继续保留：

- README 界面画廊；
- `public/pictures/` 下的灵动岛、主题、通知、设置、待办和 AI 助手截图；
- `main` 已完成的网站素材整理结果。

注意：`dev` 对 README 中少量能力描述的审计修订没有在本次合并中应用。若以后需要同步，应单独核对这些描述，不得以删除画廊为代价整文件覆盖。

### 3.2 工程配置与辅助脚本

未合入：

- `.gitignore` 的差异；
- `cc.bat`；
- `pnpm-workspace.yaml`；
- `dev` 中对图片文件的删除。

这些内容不属于本次“审计文件和修改文档”范围。

### 3.3 源码、依赖和运行行为

未修改：

- `src/`；
- `src-tauri/`；
- `package.json`、`pnpm-lock.yaml`；
- Rust Cargo 配置和锁文件；
- 应用设置、数据库、窗口、AI、语音、通知、天气和发布行为。

本次只有文档变化，不能把文档合并视为对应缺陷已经修复或功能已经实现。

### 3.4 Git 历史与远程操作

`main` 与 `origin/dev` 没有共同 Git 祖先，因此本次没有执行：

- `git merge origin/dev`；
- rebase、squash 或 history graft；
- cherry-pick 整个审计提交；
- commit、push 或远程分支删除。

采用文件级同步，避免把独立历史、无关配置和资源删除带入 `main`。

## 4. 与 main 后续规划的边界

`main` 已在 `dev` 审计快照之后新增或规划：

- `docs/superpowers/specs/2026-07-13-luckyisland-enhancements-design.md`；
- `docs/superpowers/specs/2026-07-13-plugin-market-roadmap.md`；
- `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md`；
- `vault/11-更新窗口策略与七日天气.md`。

这些文件没有被删除或覆盖，但由于用户明确选择 `docs/开发进度.md` 和 `项目备忘录.md` 采用 `dev` 版本，原工作区中写入这两个文件的模块 11 条目没有保留在正式工作区版本中。覆盖前差异已备份到：

```text
.omc/logs/2026-07-13-pre-dev-doc-merge.patch
```

因此当前存在一个需要后续明确的执行边界：

- `vault/CURRENT.md` 继续将模块 10 审计整改定义为唯一当前入口，现已推进至 `FIX-10A-01`；
- 模块 11 的设计、计划和 Vault 已恢复到开发进度与项目备忘录，但状态为“更新插件接入已完成、其余实现暂停排队”，不构成第二个当前入口；
- 模块 10 进入适当切换点后，需显式更新 `CURRENT.md` 才能恢复模块 11 实现。

插件市场仍然只是长期路线，不在本次审计合并或当前实现授权内。

## 5. 后续需要实现、决策与验证的内容

### 5.1 已完成的产品契约确认

按 `vault/CURRENT.md` 的执行顺序，该任务已经完成：

- `DOC-10A-03`：✅ 2026-07-13 已确认多屏断开/恢复与鼠标穿透产品契约并完成文档同步；
- 副屏恢复后由应用主动移回已保存副屏，当前实现缺口归入模块 11；Hidden 与默认关闭的整窗手动穿透分离，不做透明区域选择性命中；
- 本次契约同步未修改产品行为，模块 10 下一动作转为 `FIX-10A-01`。

### 5.2 三个确定性修复

契约和文档基线明确后，按测试先行处理：

1. `FIX-10A-01`：时间组件跨午夜刷新；
2. `FIX-10A-02`：电子木鱼卸载/重挂载时持久化 flush；
3. `FIX-10A-03`：AI `switch_page` 页面跳转链路。

每项都必须先形成失败测试或可复现证据，再做最小修复，并分别记录自动化与真机结果。

### 5.3 工程验证基线

- `BASE-10B-01`：建立统一验证入口和新环境验证矩阵；
- `BASE-10B-02`：补齐可发现、稳定的 React 生命周期测试层；
- `BASE-10B-03`：明确 Node/pnpm/Rust 环境、registry 和 DLL 入包前置条件。

环境问题与项目失败必须分开记录，不能把 registry 证书、PATH 或工具链缺失直接算成产品测试失败。

### 5.4 渐进低风险重构

在基线测试可保护行为后，按小批次推进：

1. `REF-10B-01`：统一 Tauri event 生命周期；
2. `REF-10B-02`：共享主题同步；
3. `REF-10B-03`：轻量拆分 `App`；
4. `REF-10B-04`：SQLite 版本化 migration；
5. `REF-10B-05`：持久、脱敏、轮转日志；
6. `REF-10B-06`：其余通过定向测试保护的渐进项。

禁止把这些任务扩展成一次性重写，也不得无证据引入新的状态框架、ORM、连接池或第二配置真源。

### 5.5 高风险候选

以下内容只能先做复现、日志、探针或设计，不能直接大改：

- `RISK-10C-01`：PTY 生命周期；
- `RISK-10C-02`：语音下载与状态机；
- `RISK-10C-03`：Provider 拆分与协议边界；
- `RISK-10C-04`：AI 动作原子性与幂等；
- `RISK-10C-05`：command 权限与 CSP；
- `RISK-10C-06`：composition root、错误和平台边界。

只有出现不同于既有已关闭 BUG 的新失败场景，并具备复现证据和验收边界时，才能派生新的 BUG 或重构 Vault。

### 5.6 产品决策状态

仍需用户单独确认：

- 完整待办范围；
- 导航与专注模式；
- 通知与窗口可配置项；
- AI 历史、撤销与确认。

点击穿透语义已于 2026-07-13 完成决策：Hidden 使用 `window.hide()`；模块 11 实现默认关闭的整窗手动穿透，不做透明区域选择性命中。其实现与 RUN-10C-03 真机验收仍未完成。

其余产品未决项不得由实现者自行推断后编码。

### 5.7 Windows 真机与安装态验证

后续需要带环境、日期和证据完成：

- 副屏断开/恢复、多 DPI 和不同显卡；
- NSIS 安装后的 `lucky-notify`、PATH、token 和 HTTP 链路；
- 整窗手动穿透的开启/关闭与恢复入口点击矩阵；
- Release 冷启动、包体、CPU、内存和 DLL；
- 24 小时日常功能长跑；
- KWS/ASR/TTS、模型下载和安装态 DLL 完整性。

## 6. 完成门禁

本次文档合并完成不等于模块 10 完成。模块 10 关闭前至少需要：

- 所有审计项都有明确状态和处置理由；
- 三个确定性缺陷具备失败测试、最小修复和回归证据；
- 统一验证入口可在声明环境中执行；
- 自动化证据与 Windows 真机证据分开记录；
- 高风险候选没有被无证据直接实施；
- `项目备忘录.md`、`docs/开发进度.md`、`vault/10-审计整改.md` 与 `vault/CURRENT.md` 状态一致；
- 模块 10 与模块 11 的执行优先级已明确：模块 10 / FIX-10A-01 是唯一当前入口，模块 11 余下实现暂停排队，后续切换仍须更新 `CURRENT.md`。

## 7. 本次验证范围

本次只验证文档同步本身：

- 检查恢复文件与 `origin/dev` 对应文件一致；
- 检查 README 仍与 `main` 一致；
- 检查业务源码和依赖文件未发生变化；
- 检查不存在 Git 冲突标记和空白错误；
- 不运行产品测试，不生成新的功能或真机验收结论。