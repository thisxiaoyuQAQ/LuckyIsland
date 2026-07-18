# RUN-10C-04 Release 冷启动 / 包体 / CPU / 内存 / DLL

> 来源：AUD-RUNTIME-04
> 通过条件：达成最终阈值，缺 DLL 可诊断

## 前置

- 已通过 `pnpm tauri build` 产出 Release 安装包并完成安装
- 已关闭 dev 进程（避免与 Release 互抢数据目录锁）

## 步骤与预期

| # | 操作 | 预期 |
|---|---|---|
| 1 | 记录安装包体积 | NSIS setup.exe 大小（MB，精确到 0.1）；与上一版本对比增量 ≤ 20%（若超过需在记录中说明原因） |
| 2 | 冷启动计时 | 双击图标 → 灵动岛可见的时间（秒表 / 视频帧测量）；预期 ≤ 3s（SSD + Win11） |
| 3 | 启动后立即用任务管理器记录 | 进程名 `lucky-island.exe`；内存（工作集） ≤ 150MB（语音未加载）；CPU 空闲 ≤ 2% |
| 4 | 检查 DLL 依赖 | 安装目录含 `sherpa-onnx-c-api.dll`、`sherpa-onnx-cxx-api.dll`、`onnxruntime.dll`、`onnxruntime_providers_shared.dll`；缺任一个安装失败/启动报错可诊断（日志中含缺失 DLL 名） |
| 5 | 缺 DLL 诊断演练（可选） | 临时把 `onnxruntime.dll` 改名 → 启动 → 日志 / 系统弹窗能定位到具体 DLL 名；恢复后启动正常 |
| 6 | 24h 内重启 3 次 | 每次冷启动都 ≤ 3s、内存基线一致；数据目录 `data.db` 不膨胀（记录每次大小） |

## 实测记录

- 日期：
- 版本：
- 安装包大小（MB）：
- 冷启动时间（秒）：
- 启动后内存（MB）：
- 启动后 CPU（%）：
- DLL 清单：
- 步骤 5 演练结果：
- 步骤 6 三次冷启动数据：

## 失败与派生

- 现象：
- 复现步骤：
- 日志片段（`%APPDATA%\com.luckyisland\logs\lucky-island.log`）：
- 是否派生 BUG：是 / 否（理由）
