# LuckyIsland

> Windows 灵动岛式桌面助手 · 常驻屏幕顶部，一眼看清时间、天气、待办、行情，顺手敲木鱼、查历史、问 AI。

LuckyIsland 把 macOS 灵动岛的形态搬到了 Windows：一个常驻屏幕顶部中央的透明小条，平时只占一行高度显示时钟；鼠标悬停或热键展开成一块「单页画布」，在时间 / 日历 / 天气 / 股票 / 待办 / 终端 / 通知之间秒切。还能通过本地 HTTP 端点接收 Claude / Codex 的完成通知，用 Windows toast 弹给你。


## 它能做什么

**灵动岛外壳**
- 三态窗口：隐藏 / 紧凑（720×80 单行）/ 展开（720×400 画布），260ms 缓动过渡
- 透明窗 + 毛玻璃，跟随系统深浅色
- 多屏选择 + 位置持久化：副屏断开自动回退主屏，重连恢复
- 托盘菜单、开机自启、单实例

**时间页（可自定义组件）**
- 流式画布：上下满行 + 左右窄列 + 中央时钟，组件开关 / 区域 / 拖拽排序
- 内置五个组件：一言、程序员历史上的今天、今日运势、电子木鱼（带疯狂星期四彩蛋）、今日心情（五档 + 连续天数）
- 时钟可自定义位置（上方 / 中央 / 下方）、纯色或双色渐变、9 个主题预设、12/24 小时制、字号字重

**其他页面**
- **日历**：月视图 + 农历 / 节气 / 节日
- **天气**：uapis.cn 多城市 + IP 自动定位 + 离线缓存 + 气象预警
- **股票**：腾讯实时行情 + sina 搜索 + 日 / 周 / 月 K 线 + 拖拽排序
- **待办**：CRUD + 优先级 / 截止 + SQLite 持久化
- **终端**：xterm.js + portable-pty 多 tab + 快捷命令 + 一键打开 Windows Terminal
- **通知**：本地 HTTP 端点 + token 鉴权 + SQLite 历史 + Windows toast

**AI 助手**
- 独立面板，三选一 Provider：Claude CLI / Codex CLI / 自定义 Chat API
- 联网搜索、流式问答、请求可取消、对话历史
- `Alt+Space` 随时唤起

**语音**
- sherpa-onnx 唤醒词 + 流式 ASR + Windows SAPI5 TTS 应答
- 唤醒时懒加载模型，闲置 ~110MB

**设置**
- 独立设置窗口：总体 / 外观 / 页面管理 / 通知 / 终端 / 天气 / 股票 / AI / 语音 / 时间组件 / 时间外观
- 配置导入导出（安全白名单，密钥 / token / 缓存 / 运行数据不外泄）
- 窗口透明度、双轴偏移实时预览

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 显示 / 隐藏灵动岛 | `Alt+X` |
| 唤起 AI 助手 | `Alt+Space` |
| 切换页面 | `Alt+1~9` / `Alt+←` / `Alt+->` / 滚轮 |
| 托盘左键 | 显示 / 隐藏 |

## 技术栈

- **Tauri 2**（Rust 后端 + WebView2 渲染，安装包 ~12.5MB，含 sherpa-onnx 动态库）
- **React 19** + TypeScript + Vite
- **Tailwind CSS v4** + shadcn 风格 UI + motion 12 动画
- **rusqlite** 本地存储、**reqwest** 网络层、**chrono / nongli** 农历
- **xterm.js + portable-pty** 终端、**sherpa-onnx + cpal** 语音
- 测试：Vitest（纯逻辑）+ Rust `#[cfg(test)]`

## 性能

- 语音关闭基线 ~61MB，CPU < 1%
- 语音开启闲置 ~110MB（唤醒时懒加载 ASR）
- 安装包 ~12.5MB（thin LTO + strip；sherpa-onnx 走 shared 动态链接，4 个 DLL 随包打包）

## 开发

```bash
pnpm install
pnpm tauri dev    # 桌面应用开发（需 Rust + MSVC 工具链）
pnpm tauri build  # 打包 NSIS 安装包
pnpm test         # Vitest 纯逻辑单测
```

> Rust 工具链：本仓库开发环境用 `D:/rust` 下的 stable-msvc 工具链；`tauri dev` 会自动热编 Rust + HMR 前端。

## 通知接入

LuckyIsland 在 `127.0.0.1:9753/notify` 暴露一个本地 HTTP 端点（Bearer 或 `?token=` 鉴权），任何脚本 / hook 都能往里发通知：

```bash
curl -X POST http://127.0.0.1:9753/notify \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"构建完成","body":"lucky-island 发布成功","source":"ci"}'
```

仓库自带 `lucky-notify` CLI 和 Claude Code / Codex 的 hook 配置示例，详见 [docs/Claude-Codex-hook配置.md](docs/Claude-Codex-hook配置.md)。
## 界面画廊

### 灵动岛状态

<p align="center">
  <img src="./public/pictures/island-compact.png" alt="LuckyIsland 紧凑状态" width="100%" />
  <br />
  <sub>紧凑状态</sub>
</p>

<p align="center">
  <img src="./public/pictures/island-compact2.png" alt="LuckyIsland 紧凑状态（另一主题）" width="100%" />
  <br />
  <sub>紧凑状态 · 另一主题</sub>
</p>


### 主题预览

<p align="center">
  <img src="./public/pictures/theme1.png" alt="LuckyIsland 主题预览 1" width="100%" />
  <br /><sub>主题预览 · 一</sub>
</p>

<p align="center">
  <img src="./public/pictures/theme2.png" alt="LuckyIsland 主题预览 2" width="100%" />
  <br /><sub>主题预览 · 二</sub>
</p>

<p align="center">
  <img src="./public/pictures/theme3.png" alt="LuckyIsland 主题预览 3" width="100%" />
  <br /><sub>主题预览 · 三</sub>
</p>

### 展开界面与功能页面

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./public/pictures/island-expanded.png" alt="LuckyIsland 展开界面" />
      <br /><sub>展开界面</sub>
    </td>
    <td align="center" width="50%">
      <img src="./public/pictures/island-expanded2.png" alt="LuckyIsland 展开界面 2" />
      <br /><sub>展开界面 · 主题二</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./public/pictures/island-expanded3.png" alt="LuckyIsland 展开界面 3" />
      <br /><sub>展开界面 · 主题三</sub>
    </td>
    <td align="center" width="50%">
      <img src="./public/pictures/island-expanded4.png" alt="LuckyIsland 展开界面 4" />
      <br /><sub>展开界面 · 主题四</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./public/pictures/island-expanded5.png" alt="LuckyIsland 展开界面 5" />
      <br /><sub>展开界面 · 主题五</sub>
    </td>
    <td align="center" width="50%">
      <img src="./public/pictures/todo-page.png" alt="LuckyIsland 待办页面" />
      <br /><sub>待办页面</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./public/pictures/notification-page.png" alt="LuckyIsland 通知页面" />
      <br /><sub>通知页面</sub>
    </td>
    <td align="center" width="50%">
      <img src="./public/pictures/settings-window.png" alt="LuckyIsland 设置窗口" />
      <br /><sub>设置窗口</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="./public/pictures/AI-assistant.png" alt="LuckyIsland AI 助手页面" />
      <br /><sub>AI 助手页面</sub>
    </td>
  </tr>
</table>

## 项目结构

```
src/                      前端（React）
  components/pages/       各页面（time/calendar/weather/stock/todo/terminal/notify）
  settings/               设置面板各子面板
  lib/                    settings KV、动画、拖拽等工具
src-tauri/src/            Rust 后端
  data/                   天气 / 股票 / 日历 / 待办 / time_api（一言/历史）
  ai/                     AI 路由 / provider / 历史
  voice/                  唤醒 / ASR / TTS
  storage/                SQLite + 配置导入导出白名单
  monitor.rs              多屏选择与窗口定位
docs/                     需求 / 技术栈 / 开发进度 / hook 配置
vault/                    模块任务拆解
```

## 文档

- [需求文档](docs/需求文档.md)
- [技术栈规划](docs/技术栈规划.md)
- [开发进度](docs/开发进度.md)
- [Claude/Codex hook 配置](docs/Claude-Codex-hook配置.md)
- [时间页组件设计](docs/superpowers/specs/2026-07-11-time-page-widgets-design.md)

## 许可证

[MIT License](LICENSE)。代码、文档与仓库内素材均按 MIT 授权，可自由使用、修改、分发（含商用），需保留版权声明

## 友链

[LINUX DO](https://linux.do/)