# LuckyIsland 更新、窗口策略与七日天气设计

> 日期：2026-07-13
> 状态：已获用户逐节批准，待实施计划
> 选定方案：增量功能 + 统一窗口策略层
> 实施范围：需求 1、2、3、5、6
> 规划范围：需求 4 仅记录插件化迁移方向，详见独立插件市场路线图

## 1. 背景

本次需求包括：

1. 新增关于页面，展示作者、仓库、诊断信息并支持更新检测；
2. 灵动岛支持整窗鼠标穿透，并可通过自定义全局快捷键切换；
3. 灵动岛在所在显示器出现真正全屏窗口时可自动隐藏；
4. 语音和问答模块最终支持真正卸载；
5. 鼠标悬停可自动展开灵动岛，并可配置；
6. 天气页展示未来七天天气。

需求 2、3、5 都会影响同一个窗口；通知系统也会主动显示、展开并聚焦该窗口。若继续让各功能直接调用 `show`、`hide`、`set_focus` 和窗口尺寸 API，就会形成状态竞争。因此，本设计以统一窗口策略层作为交互功能的共同基础，同时让关于/更新与天气保持独立业务模块。

## 2. 已确认产品决策

### 2.1 关于与更新

- 更新提示同时提供“安全更新并重启”和“查看 Release”两个入口。
- 启动后自动检查可配置，默认开启。
- 只订阅稳定 Release，忽略 draft 和 prerelease。
- 发现新版时只显示非打扰提示，不自动下载、不抢焦点。
- 正式发布以 GitHub Actions 为主，本机脚本为备用；两者使用同一 Tauri 更新签名密钥。
- 关于页展示基础信息、仓库/Issue 和可复制诊断信息，不展示完整开源鸣谢列表。

### 2.2 鼠标穿透与悬停

- 穿透是整座岛的手动开关，不做透明区域命中测试，也不做系统级鼠标位置自动解穿透。
- 新增可自定义动作“开启/关闭鼠标穿透”，默认不绑定按键。
- 穿透状态跨重启保持。
- 除快捷键外，只在设置页提供穿透开关；不增加托盘或岛内开关。
- 穿透开启时，窗口收不到鼠标事件，因此悬停展开暂停。
- 悬停展开开关默认关闭。
- 移入约 180ms 后展开，移出约 300ms 后收起；第一版延迟固定，不提供数值配置。

### 2.3 全屏与通知

- 全屏隐藏开关默认关闭。
- 只检测灵动岛所在显示器的前台真正全屏窗口；普通最大化不算全屏。
- 离开全屏后恢复用户进入前或期间最后选择的状态。
- 普通通知在全屏期间只入库和发系统 Toast，不显示灵动岛。
- `high` / `critical` 通知可以在全屏期间无焦点展开灵动岛约 6 秒，然后重新隐藏。
- 用户主动隐藏灵动岛的意图高于任何通知；通知仍入库和发系统 Toast，但不强制显示窗口。

### 2.4 七日天气

- 数据源免 API Key 优先。
- 展开态使用横向天气卡：当前天气保留为主视觉，七天卡片横向滚动。
- 每日卡片显示图标、高低温；数据存在时显示降雨概率。
- 第一版不显示未来每日风向风力或日出日落。

### 2.5 插件化范围

- 长期目标是公开插件市场，而不是仅隐藏或删除语音模型。
- 语音与问答将迁移成可真正安装、卸载和更新的插件。
- 本轮只产出独立路线图，不实现插件运行时、不迁移模块、不新增卸载按钮。

## 3. 目标与非目标

### 3.1 必须达到

- 所有窗口显示意图经过一个可测试的策略层归约，不再由通知、热键、悬停和全屏检测互相覆盖。
- 点击穿透具有持久化设置和可选全局快捷键；无快捷键时仍可从设置窗口关闭。
- 全屏检测只作用于 Windows，且只隐藏岛所在屏的真正全屏窗口。
- 通知优先级与视觉 level 分离，重要通知在全屏时不抢焦点地临时展示。
- 关于页可检查、下载、验证并安装稳定更新，同时保留 GitHub Release 备用入口。
- CI 与本机备用发布都生成完整、可验证的更新资产。
- 七日天气具有统一 DTO、按城市缓存、部分失败降级和横向卡片 UI。
- 老用户数据库、旧通知客户端、现有天气设置和现有热键无感升级。

### 3.2 非目标

本轮不实现：

- 透明区域穿透、穿透时系统级鼠标靠近自动解锁；
- macOS/Linux 的穿透和全屏等价行为；
- 悬停延迟自定义；
- 预发布更新通道；
- 自动后台下载或无人确认安装；
- 用 Tauri 更新签名替代 Windows Authenticode；
- 用户配置天气 API Key；
- 插件运行时、插件市场服务、第三方插件加载；
- 语音或问答模块卸载。

## 4. 总体架构

```text
设置页 / 全局热键 / 前端悬停事件 / 全屏检测器 / 通知系统
                         │
                         ▼
                WindowPolicyState
      ┌──────────────────┼──────────────────┐
      │ 用户期望状态      │ 环境抑制/覆盖      │ 平台效果
      │ desired_state     │ fullscreen/hover │ show/hide
      │ click_through     │ priority override│ resize/focus
      └──────────────────┴──────────────────┘ ignore cursor

关于页 ──> Updater / Process / Opener
天气页 ──> Rust Weather Service ──> 当前天气源 + 七日预报源 + SQLite 缓存
```

职责划分：

- `window_policy`：保存输入状态、纯函数归约最终状态、统一应用窗口效果；
- `fullscreen`：Windows 前台窗口与显示器探测，只上报布尔结果；
- `hotkeys`：新增可为空的穿透动作；
- `notify`：校验并持久化 priority，再请求策略层展示；
- `update` / `about`：版本、诊断、检查、下载、安装与跳转；
- `weather`：供应商适配、统一模型、缓存与降级；
- React：渲染状态、报告悬停、展示设置/关于/天气，不自行裁决窗口状态。

## 5. 统一窗口策略

### 5.1 状态

概念模型：

```rust
enum IslandState {
    Hidden,
    Compact,
    Expanded,
}

struct WindowPolicyState {
    desired_state: IslandState,
    hover_expand: bool,
    hovered: bool,
    click_through: bool,
    hide_in_fullscreen: bool,
    fullscreen_block: bool,
    priority_override_generation: u64,
    priority_override_active: bool,
}
```

实现可调整字段名，但必须保留“用户期望状态”和“环境导致的最终状态”两个层次。`WindowPolicy` 由 `app.manage` 托管，内部同步仅保护短时状态更新；任何 Tauri 窗口调用和异步等待不得跨锁执行。

### 5.2 归约规则

最终状态按以下优先级计算：

```text
if desired_state == hidden:
    hidden
else if priority_override_active:
    expanded_without_focus
else if hide_in_fullscreen && fullscreen_block:
    hidden
else if desired_state == compact
     && hover_expand
     && hovered
     && !click_through:
    expanded
else:
    desired_state
```

补充语义：

- 高优先级通知只越过全屏抑制，不越过用户主动隐藏。
- 用户在全屏期间通过热键改变 `desired_state`，窗口仍可因全屏保持隐藏；退出全屏后显示最新意图。
- 用户主动展开后，鼠标移出不收起。
- 策略层同时返回 `should_focus`；只有用户显式显示/展开等交互可请求焦点。全屏重要通知必须为 false。
- 相同归约结果不重复调用平台 API，降低闪烁。

### 5.3 命令与事件

现有 `set_island_state` 保留前端调用契约，但实现改为提交 `desired_state`。新增概念接口：

```text
window_policy_get
window_click_through_set(enabled)
window_hover_set(hovered)
window_hide_in_fullscreen_set(enabled)
```

事件：

```text
window://state-changed      用户期望/有效显示状态发生变化
window://policy-changed     clickThrough/fullscreenBlocked 等策略快照
```

事件 payload 使用结构化对象并定义 TypeScript/Rust 类型，不再只靠自由字符串猜测上下文。迁移期间可以兼容旧 `window://state-changed` 字符串监听，但最终只能由策略层发出。

### 5.4 平台效果失败

- `show/hide/resize/set_ignore_cursor_events` 失败时，返回结构化错误，不把未成功的持久化值广播成已生效。
- 应用启动恢复穿透失败时，本次运行回退非穿透，并向设置页广播实际状态；不允许 UI 显示开启但平台仍可点击。
- 策略归约器不依赖 Tauri，可做纯单元测试。

## 6. 鼠标穿透

### 6.1 设置和入口

```text
window:click_through = false
```

- 默认关闭；设置页“总体”面板提供持久化 Switch。
- 开启/关闭通过策略命令完成，成功后保存 SQLite 并广播。
- 重启时读取并恢复。
- 设置窗口不穿透；只有 `island` 窗口调用 `set_ignore_cursor_events`。
- 穿透开启后悬停计时器立即取消，`hovered` 视为 false。

### 6.2 全局热键

新增：

```text
action id: toggle_click_through
label: 开启/关闭鼠标穿透
default: 未绑定
setting: hotkeys:toggle_click_through
```

现有热键层必须正式支持未绑定：

- 未绑定值使用一个明确表示（持久化可用空字符串，领域层必须转为 `Option<HotKey>`）；
- `apply` 跳过未绑定动作，结果为成功且 binding 为空；
- 未绑定不能被当成坏值后回退默认；
- 默认绑定冲突测试只统计非空默认项；
- 单项/全部恢复默认后，穿透动作仍为空；
- 导入导出保留空值；
- 录制期间 suspend/reload 语义不变。

快捷键切换必须调用同一窗口策略接口，不直接操作窗口。

## 7. 悬停自动展开

```text
window:hover_expand = false
enter delay = 180ms
leave delay = 300ms
```

React 灵动岛外层容器报告 `pointerenter` / `pointerleave`，使用 generation 或可取消 timeout 防抖：

- 移入后 180ms 仍在窗口内才上报 `hovered=true`；
- 移出后 300ms 仍在窗口外才上报 `hovered=false`；
- 相反事件取消前一个定时器；
- 组件卸载、设置关闭或穿透开启时清理定时器并上报 false；
- 快速掠过不改变窗口；
- 前端不直接调用 `setState("expanded")`。

设置默认关闭，避免升级后改变既有交互。穿透开启时 WebView 不保证能收到 leave 事件，因此 Rust 在成功开启穿透的同一事务中清空悬停输入。

## 8. Windows 全屏检测

### 8.1 范围

```text
window:hide_in_fullscreen = false
```

- 默认关闭；关闭时检测器不需要持续做窗口探测。
- 本轮仅实现 Windows 10/11。
- 非 Windows 构建提供安全 no-op，并在设置页说明当前平台不支持；不能阻塞启动。

### 8.2 判定

检测器周期约 500ms：

1. 获取前台 HWND；
2. 排除 LuckyIsland 自身窗口、桌面窗口与 Shell；
3. 跳过不可见、最小化或无法读取有效矩形的窗口；
4. 获取窗口矩形与其所在显示器；
5. 获取灵动岛当前所在显示器；
6. 两者不是同一显示器则不上报全屏；
7. 窗口矩形覆盖显示器边界时判定真正全屏；普通最大化若只覆盖工作区并保留任务栏，则不判定；
8. 连续两次相同结果才提交变化，降低 Alt+Tab 和切场景闪烁。

平台接口与纯判定函数隔离，边界容差集中定义并测试。探测调用失败时保留上一次可靠结果，而不是突然显示/隐藏。

### 8.3 生命周期

- 设置开启时启动或激活检测；关闭时清除 `fullscreen_block` 并恢复策略结果。
- 多屏选择、运行时显示器断开回退后，下一轮按新岛显示器重新判定。
- 应用退出时停止线程/任务。
- 全屏结束后策略层按最新 `desired_state` 恢复。

## 9. 通知优先级与全屏覆盖

### 9.1 数据模型

现有 `level` 继续表示外观和语义：

```text
info | success | warn | error
```

新增独立字段：

```text
priority = normal | high | critical
```

- `NotifyInput`、返回 DTO、HTTP API、CLI 和 SQLite 都包含 priority。
- 未提供时默认 `normal`，保证旧客户端兼容。
- 非法值拒绝写入。
- 不能从 `level=error` 自动推导高优先级。
- 数据库迁移为 notifications 增加非空列，旧记录为 `normal`。

### 9.2 分发行为

所有通知都先校验、入库、emit `notify://incoming`，再按策略决定窗口效果：

- 用户期望 hidden：不显示岛；
- 非全屏：延续当前通知页展开行为，但是否聚焦由策略统一控制；
- 全屏 + normal：岛保持隐藏；
- 全屏 + high/critical：岛无焦点展开约 6 秒；
- 6 秒内又来 high/critical：替换/更新当前通知内容并从最新 generation 重新计时；
- 到期的旧计时器只有 generation 仍匹配时才能清除覆盖；
- 退出全屏时立刻回到正常归约结果。

Windows Toast 仍由 `general:toast` 控制，与岛窗口是否被抑制无关。

当前 `notify` 中直接 emit 展开、`window.show()` 和 `set_focus()` 的逻辑必须迁移到策略层，避免抢走游戏、视频或演示焦点。

## 10. 关于页面

在设置窗口侧栏末尾新增“关于”。侧栏内容可滚动，应用标识保持顶部，“关于”保持底部可达。

### 10.1 基础信息

显示：

- Logo、LuckyIsland；
- 当前版本；
- 作者 `thisxiaoyuQAQ`；
- MIT License；
- GitHub 仓库 `https://github.com/thisxiaoyuQAQ/LuckyIsland`；
- Issue 入口 `https://github.com/thisxiaoyuQAQ/LuckyIsland/issues/new`。

外部链接通过 opener 插件交给系统浏览器，不在 WebView 加载。

`src-tauri/Cargo.toml` 的 package authors 应同步为真实作者，避免诊断/包元数据显示 `you`。

### 10.2 诊断信息

显示并支持一键复制：

```text
LuckyIsland: <version>
OS: <Windows version>
Architecture: <arch>
WebView2: <version or 未知>
Update channel: stable
```

诊断读取使用 Tauri/平台提供的非敏感信息。单项失败显示“未知”，不阻断页面。复制内容不得包含：

- AI API Key、通知 Token；
- 对话、城市、自选股；
- 用户名、私人绝对路径；
- Authorization header 或签名私钥信息。

## 11. 更新系统

### 11.1 组件与配置

采用 Tauri v2 官方更新器和进程插件：

- Rust `tauri-plugin-updater`、`tauri-plugin-process`；
- 前端 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`；
- capability 仅授予更新检查、下载/安装和重启所需权限；
- Tauri bundle 启用 updater artifacts；
- `tauri.conf.json` 保存更新公钥与稳定更新端点；
- 端点指向 GitHub 稳定 Release 中的 `latest.json`。

私钥绝不进入仓库或打包产物。

### 11.2 状态机

```text
idle
  └─ check ─> checking
                 ├─ no update ─> up_to_date
                 ├─ available ─> available
                 └─ failure ─> error
available
  ├─ open release
  └─ update ─> downloading ─> installing ─> restart
                         └──────> error
```

关于页展示当前/最新版本、Release 标题、发布日期和精简说明，并提供：

- 安全更新并重启；
- 查看 Release；
- 下载中的真实进度；
- 支持时提供取消下载；
- 错误后的重试和复制非敏感错误。

下载取消必须使用当前插件版本提供的正式取消/中止能力；若官方 API 在实施时不支持可靠取消，则 UI 不得提供伪取消按钮，规格中的“下载可取消”降级为“关闭关于页不影响下载状态，等待完成或失败”。该能力必须在实施前查本地锁定版本 API 并测试。

### 11.3 自动检查

```text
update:auto_check = true
channel = stable (不可配置)
```

- 启动稳定后约 10 秒静默检查一次；
- 每个进程生命周期最多自动检查一次；
- 关于页可随时手动检查；
- 只接受比当前版本新的稳定版；
- 自动失败只记状态，不弹模态框；
- 有更新时显示非打扰提示和关于页标记，不自动下载；
- 若当前受全屏抑制，提示延迟到退出全屏后；
- 手动检查失败仍可打开 Release 页面。

### 11.4 信任边界

- 更新安装前必须通过 Tauri 公钥签名、版本、平台和架构校验。
- 签名失败不提供绕过选项。
- 更新失败不能损坏当前安装或修改用户设置。
- Tauri updater signature 认证更新源和完整性，不等同于 Windows Authenticode。没有代码签名证书时仍可能出现 SmartScreen，文档不得声称已消除该提示。
- 公钥轮换需要独立迁移设计；私钥丢失不是简单替换配置即可恢复。

## 12. 双发布流程

### 12.1 GitHub Actions 主路径

新增 Windows Release workflow，仅由 `v*` 标签触发：

1. 校验标签与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 四处版本一致；
2. 安装固定 Node、pnpm、Rust 和 Tauri 工具；
3. 执行前端测试、TypeScript 检查、前端构建、Rust 单元测试和必要构建检查；
4. 构建 Windows x86_64 NSIS 与 updater artifacts；
5. 使用 GitHub Secrets 中的 Tauri 私钥签名；
6. 生成并上传 NSIS 安装包、更新包、`.sig`、`latest.json`；
7. 创建非 draft、非 prerelease 的稳定 Release；
8. 任一测试、签名或资产校验失败则不发布不完整版本。

Secrets：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

workflow 权限最小化到构建所需的 read 和 Release 写入权限；第三方 Action 固定到可信版本或 commit。

### 12.2 本机备用路径

仓库提供维护者脚本，和 CI 使用同一资产与校验规则：

1. 必须在干净 `main`，确认标签/版本；
2. 运行同一测试集合；
3. 从进程环境或系统安全存储读取同一 Tauri 私钥；
4. 构建签名更新产物；
5. 校验 `latest.json` 版本、平台 URL、签名和资产完整性；
6. 用 `gh release create` 发布完整集合；
7. 发布后重新下载 `latest.json` 并验证结构和 URL。

约束：

- CI 是正式主路径，本机仅用于 CI 故障或紧急维护；
- 同一版本不能由两条路径并发发布；
- 私钥不放 `.env`、仓库目录、Artifact、Release 或日志；
- 私钥加密备份和恢复流程写入维护文档。

## 13. 七日天气

### 13.1 供应商适配与统一 DTO

当前 uapis.cn 继续用于实时天气和 IP 定位。七日预报首选无需用户 API Key、支持 HTTPS、可返回七天高低温及降雨概率的数据源。候选为 Open-Meteo：先通过地理编码将城市解析为经纬度，再请求 daily forecast。实施第一步必须用北京、无锡及区县级城市做真实探针，确认中文检索、字段、速率限制、署名/许可要求和中国区域数据质量；探针不通过时更换供应商，但前端 DTO 不变。

统一返回：

```rust
struct WeatherBundle {
    now: WeatherNow,
    forecast: Vec<WeatherDay>, // 1..=7，绝不伪造缺日
    source: WeatherSourceInfo,
    offline: bool,
    partial: bool,
    fetched_at: i64,
}

struct WeatherDay {
    date: String, // YYYY-MM-DD
    weather: String,
    weather_icon: String,
    temp_min: f64,
    temp_max: f64,
    precipitation_probability: Option<f64>,
}
```

如使用多个供应商，`source` 能标识当前/预报来源，方便诊断和满足署名要求。前端只消费统一模型。

### 13.2 城市规范化

请求和缓存使用结构化地点标识，避免同名城市：

```text
queryName / displayName / province / country / latitude / longitude / timezone
```

- IP 定位和用户已有城市字符串进入后端解析；
- 解析结果与城市配置关联缓存；
- 无法唯一解析时显示候选或明确失败，不静默选择其他省的同名城市；
- 日期按地点 timezone 对齐，不用主机 UTC 猜“今天”。

在不引入数据库大迁移的前提下，可先用规范化地点对象的稳定 key 做缓存，城市列表仍保持现有字符串契约；具体迁移由实施计划确定。

### 13.3 缓存与部分降级

由当前单一 `weather:last` 升级为按规范化地点隔离的缓存：

```text
weather:cache:<location-key>
```

规则：

1. 当前和预报都成功：返回完整在线结果并刷新各自缓存；
2. 当前成功、预报失败：当前用新数据，预报回退同地点缓存；
3. 预报成功、当前失败：预报用新数据，当前回退同地点缓存；
4. 两者都失败：回退同地点完整缓存；
5. 无同地点缓存：返回可重试错误；
6. 标记 `offline/partial` 和最后更新时间；
7. 降雨概率为 None 时隐藏，不显示 0%；
8. 旧 `weather:last` 只有在缓存内城市与目标城市规范化后一致时才迁移，之后不再写旧键；
9. 天气缓存继续排除配置导入导出。

### 13.4 并发与刷新

- 切换城市立即显示加载状态；
- 每次请求绑定递增 request ID 或 AbortController；
- 旧城市晚返回不能覆盖新城市；
- 同城市短时间重复刷新合并或限流；
- 当前与预报并行请求，分别记录失败；
- 现有城市添加、删除和排序保持不变。

### 13.5 横向卡片 UI

展开态：

- 上半部保留城市、当前温度、天气、体感/湿度、更新时间、缓存标记和预警入口；
- 下半部为 1–7 张横向卡片；
- 卡片显示“今天/明天/周几”、天气图标、高低温和可选降雨概率；
- 首张“今天”视觉强调；
- 滚轮在预报区域转为横向滚动，触控板保留原生横向滑动；
- 使用滚动吸附；聚焦预报区后左右键可浏览；
- 不自动轮播，不增加必须点中的小分页圆点；
- 保持窗口 720×400 和当前内容高度；
- 紧凑态只显示当前天气。

## 14. 设置、导入导出与迁移

新增设置默认值：

```text
window:click_through       false
window:hover_expand        false
window:hide_in_fullscreen  false
update:auto_check          true
hotkeys:toggle_click_through  未绑定
```

- 老数据库缺键时按默认值运行。
- 新设置加入 portable settings 白名单。
- `weather:cache:*`、更新运行态、全屏输入态和通知临时覆盖不导出。
- 配置导入后重新应用穿透、全屏检测和热键。
- 穿透为 true 且热键为空是合法组合，设置窗口是恢复入口。
- 通知表迁移幂等；旧通知 priority 为 normal。
- 设置写入失败时 UI 回滚到实际状态并显示错误。

## 15. 错误处理

### 15.1 窗口与全屏

- 平台 API 失败保持可找回状态，不宣称设置已生效。
- 全屏探测单次失败保留上次可靠结果。
- 悬停定时器用 generation 防旧回调覆盖新输入。
- 通知覆盖计时器只有最新 generation 可结束覆盖。
- 窗口策略异常时优先恢复用户期望状态；不得永久卡在不可交互且无恢复入口的状态。

### 15.2 更新

区分网络、限流、清单、版本、平台、签名、下载、安装和重启错误：

- 自动检查失败不打扰；
- 手动失败提供重试和 Release；
- 签名失败绝不绕过；
- 错误信息不得包含私钥、Token、Authorization 或私人路径；
- 安装失败保留当前可运行版本和设置。

### 15.3 天气

- 当前和预报分别降级；
- 不跨城市回退；
- 缺字段按可选数据处理；
- 日期乱序/重复时归一化、排序、去重；
- 不生成虚假天气或虚假第七天。

## 16. 测试设计

### 16.1 Rust 纯逻辑与模块测试

窗口策略至少覆盖：

| 输入 | 预期 |
|---|---|
| 用户 hidden + 高优先级通知 | hidden |
| compact + hover 开启 + hovered | expanded |
| compact + click-through + hovered | compact |
| expanded + pointer leave | expanded |
| fullscreen + normal 通知 | hidden |
| fullscreen + high 通知 | expanded、无焦点、6 秒 |
| 连续 high 通知 | 最新通知重新计时 |
| fullscreen 退出 | 恢复最新 desired state |
| fullscreen 期间用户改 hidden | 退出后仍 hidden |

其余测试：

- 空热键解析、保存、注册跳过、重置和导入导出；
- Windows 显示器矩形、任务栏保留的最大化和真正全屏判定；
- priority 校验、默认值和 SQLite 迁移；
- 版本比较、更新错误映射和自动检查一次性门；
- 天气供应商映射、缺降雨、少于七天、部分失败；
- 同地点缓存回退、跨城市拒绝、旧缓存迁移、日期排序去重。

### 16.2 前端测试

- 设置读取、保存、失败回滚和 `settings://changed` 同步；
- hover enter/leave 防抖、卸载清理、穿透时取消；
- 关于页全部更新状态、非打扰提示和诊断复制脱敏；
- 七日卡片、缺降雨隐藏、缓存/partial 标签；
- 快速城市切换时丢弃旧结果；
- 横向滚动与键盘浏览。

### 16.3 发布验证

- 标签与三处版本不一致时失败；
- 缺签名 Secret 时失败；
- 缺更新包、`.sig` 或 `latest.json` 时失败；
- 公钥能验证产物；
- 清单 URL 可访问且指向本 Release；
- draft/prerelease 不进入稳定更新；
- CI 与本机脚本资产集合一致。

### 16.4 Windows 真机验收

穿透/悬停：

- 点击落到后方窗口；重启保持；设置页可恢复；
- 绑定热键后任意应用可切换；
- 穿透期间不悬停展开；
- 快速掠过不展开，停留展开，移出延迟收起；
- 用户主动展开后移出不收起。

全屏/通知：

- 浏览器全屏视频、游戏或无边框全屏、PowerPoint/演示；
- 普通最大化；双显示器；全屏在非岛显示器；Alt+Tab；
- 仅岛所在屏真正全屏触发；
- normal 不唤出岛，high/critical 无焦点展示约 6 秒；
- 前台全屏应用不失焦。

更新：

- 测试版本完整执行旧版 → 检查 → 下载 → 验签 → 安装 → 重启 → 新版；
- 损坏签名明确被拒绝；
- Release 备用链接可用。

天气：

- 北京、无锡、一个区县级城市；
- 七日顺序、高低温、可选降雨、切换、断网缓存、单侧 API 失败；
- 快速切换不被旧响应覆盖。

## 17. 实施分段与提交边界

后续实施计划按以下阶段，每段独立测试与提交：

1. 窗口策略状态归约与现有窗口入口迁移；
2. 点击穿透、空快捷键和悬停展开；
3. Windows 全屏隐藏、通知 priority 和无焦点临时展示；
4. 关于页、诊断、手动/自动检查和安全更新；
5. GitHub Actions 主发布与本机备用发布脚本；
6. 七日天气供应商探针、DTO、缓存和横向 UI；
7. 文档、全量回归和真机验收记录。

插件市场路线图不进入上述实施任务。

## 18. `main` 分支交付约束

- 当前 `feat/luckyisland-website` 工作目录包含用户未提交的网站工作，本轮不修改、不暂存、不提交这些内容。
- 设计、计划和实现均在独立目录中的 `main` 分支完成并提交。
- 独立目录只是保护脏工作区，不创建新功能分支；最终提交分支就是 `main`。
- 每个功能点独立 commit。
- 不把网站实现分支合并进 `main`。
- 未经用户明确要求不 push、不创建 Release。
- 若远端 `main` 发生新变化，提交前先同步；冲突时停止并报告，不擅自丢弃。

## 19. 预计文件边界

实施计划可调整具体命名，但保持职责分离：

- 新增 `src-tauri/src/window_policy.rs`；
- 新增 Windows 全屏探测子模块；
- 修改 `src-tauri/src/lib.rs`，把状态、热键和通知入口接入策略层；
- 修改 `src-tauri/src/hotkeys.rs` 支持穿透动作和未绑定状态；
- 修改 `src-tauri/src/notify/*` 与 storage migration 支持 priority；
- 新增关于/更新 Rust 或前端封装、`AboutPanel.tsx`；
- 修改 `SettingsApp.tsx`、`GeneralPanel.tsx`、`HotkeysPanel.tsx` 和共享 settings 类型；
- 增加 updater/process 依赖、Tauri 配置和 capability；
- 新增 `.github/workflows/release.yml` 与本机发布脚本；
- 扩展 `src-tauri/src/data/weather.rs` 或拆分 supplier/cache 子模块；
- 修改 WeatherPage 与天气前端类型；
- 增加 Rust/TypeScript 测试和用户/维护文档。

## 20. 外部参考

- [Tauri v2 Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri GitHub Actions 发布流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri 更新签名](https://v2.tauri.app/distribute/signing/)
- [Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)

实施时先以项目锁定依赖的本地 crate/package 源码和官方文档核对精确 API，不凭记忆填写方法签名。

## 21. 完成标准

- 需求 1、2、3、5、6 按已确认行为完成；
- 窗口效果全部经策略层归约，状态测试通过；
- 穿透、悬停、全屏和通知多屏真机验收通过；
- 更新器完成至少一次真实签名升级和一次损坏签名拒绝；
- CI 与本机发布路径可生成完整稳定更新资产；
- 七日天气在目标城市、断网和部分失败场景工作；
- 老配置、旧通知请求和现有页面行为兼容；
- 插件系统只保留规划，不误进入本轮代码；
- 所有工作提交在 `main`，网站子分支工作区保持未被本轮触碰。
