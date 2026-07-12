# BUG-20260710-04 修复：Codex 多行 Prompt 传输截断

> 状态：修复、自动化与 LuckyIsland/Codex CLI 真机验收均已完成；纳入 2026-07-11 收尾提交

## 需要先读
- [项目备忘录.md](../项目备忘录.md)
- [docs/开发进度.md](../docs/开发进度.md)
- [vault/BUG-20260710-02-Provider状态与实时问答.md](./BUG-20260710-02-Provider状态与实时问答.md)
- `src-tauri/src/ai/prompt.rs`
- `src-tauri/src/ai/provider.rs`
- `src-tauri/src/ai/process.rs`

## Bug 摘要
- 实际表现：Codex CLI 收到“今天天兰州天气怎么样”后，只根据 system prompt 第一行回复助手身份和当前时间，没有回答天气。
- 期望表现：Codex 收到完整 system prompt、历史和末尾用户问题，联网查证后回答兰州实时天气。
- 复现路径：`build_prompt` 生成完整多行 prompt，经 `cmd /C codex.cmd ... <prompt argv>` 启动；`codex.cmd` 再通过 `%*` 交给 Node。
- 影响范围：Codex CLI 的多行 prompt；Claude CLI 和 Chat API 不经过该 `cmd /C codex.cmd` 参数链路。

## 根因假设
- 假设：Windows `cmd /C` 与 `codex.cmd %*` 对包含换行、内嵌双引号和 shell 元字符的 prompt 进行二次解析，导致 argv 在第一处内嵌双引号附近截断。
- 证据：真实 prompt 为 843 字符、1833 UTF-8 字节；direct-node 与 cmd-wrapper argv 探针都只收到前 74 字符，缺少天气问题、JSON 示例和 `<标题>`；stdin 探针收到 843 字符且 SHA-256 与源 prompt 完全一致。
- 交叉验证：伪 CLI 哈希回归与 UI 日志均确认 stdin 收到完整末尾天气问题；此前真实 `codex --search exec ... -` 探针也证明 stdin/中文链路兼容，但其联网能力不再作为当前保证，已由 BUG-05 的 A+ 后端预搜索替代。

## 选定方案
- 方案：A——Codex CLI 参数末尾使用 `-`，完整 UTF-8 prompt 通过子进程 stdin 传输。
- 改动范围：为 `src-tauri/src/ai/process.rs` 增加可选 stdin 输入能力；`src-tauri/src/ai/provider.rs` 的 Codex 调用改用 stdin；补充参数与多行/中文/引号/JSON/尖括号传输回归测试。
- 风险点：必须保持其他 provider 的 stdin 关闭行为，以及取消、120 秒超时、stdout/stderr 并发读取、Windows 进程树终止、Codex 全局选项与 `exec` 子命令的参数顺序等既有契约。
- 不在范围：不修历史同秒排序问题；不调整 KWS/VAD/ASR/TTS 参数；不提交本轮改动。

## 四步原则记录
| 步骤 | 结论 | 落盘时间 |
|---|---|---|
| 1. 复现 | ✅ 完整 prompt 843 字符经现有 argv 链路稳定缩减为 74 字符，末尾兰州天气问题不存在。 | 2026-07-10 20:20 |
| 2. 定位 | ✅ 截断发生在 prompt→cmd/codex.cmd argv 边界；stdin 哈希一致且真实 Codex 成功回答，根因确认。 | 2026-07-10 20:25 |
| 3. 修复 | ✅ Codex 参数末尾改为 `-`；进程运行器新增可选 stdin 并在取消/超时选择中写入、关闭；Codex 传入完整 UTF-8 prompt。RED 2 项失败、GREEN 2/2 通过。 | 2026-07-10 20:44 |
| 4. 验证 | ✅ Codex 8/8、AI 17/17、定向 rustfmt、cargo check、TypeScript、diff check 均通过；2026-07-11 全局配置恢复后，LuckyIsland 使用 Codex CLI 的天气问答不再只返回身份/时间，用户真机验收通过。 | 2026-07-11 |

## 验证命令
- `cargo test --manifest-path src-tauri/Cargo.toml ai:: -- --nocapture`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npx tsc --noEmit`
- `git diff --check`
- 真机发送：`今天天兰州天气怎么样`

## 修复结果
- 现有 argv 链路的 843→74 字符截断已由回归测试锁定；修复后伪 Codex CLI 从 stdin 收到与 `build_prompt` 完全一致的复杂 UTF-8 prompt。
- 此前真实 Codex stdin 探针返回过兰州天气，证明 `codex exec ... -` 的 stdin/中文传输与 CLI 兼容；当前联网保证已由 BUG-05 的 A+ 后端预搜索接管，不再依赖 `--search`。
- 最新自动化与编译验证已通过，且 UI 日志已确认末尾天气问题完整到达 Codex stdin。2026-07-10 曾因全局 Codex 配置解析错误阻断端到端复验；配置恢复后已于 2026-07-11 完成 LuckyIsland/Codex CLI 真机验收，BUG 关闭。
- 2026-07-11 用户要求统一收尾提交，本修复与相关回归记录一并入库。
