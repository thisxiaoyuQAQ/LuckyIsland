# VoicePanel Download Listener Migration Design

> 日期：2026-07-16  
> 状态：已批准

## 目标

将 `VoicePanel` 的 `voice://download-progress` 迁入 `useTauriEvent`，把随 `downloadingModel` 变化重订阅改为单次稳定注册，同时始终读取最新提交的下载模型并保持现有进度、完成和错误语义。

## 范围

修改：

- `src/settings/VoicePanel.tsx`
- `src/settings/__tests__/VoicePanel.test.tsx`

复用但原则上不修改：

- `src/lib/useTauriEvent.ts`
- `src/lib/useAsyncSubscription.ts`

明确不处理：

- `voice_download_model` RPC 与其错误处理；
- 初始 KWS/ASR readiness 和 settings 加载；
- 监听开关启停；
- 唤醒词校验、防抖与热重载；
- 设置读写；
- AI API、provider、模型与 prompt；
- `AiPalette` 的 transcript/listening listener；
- Voice Rust 后端。

## 事件处理

使用：

```tsx
useTauriEvent<DownloadProgress>("voice://download-progress", (event) => {
  const progress = event.payload;
  setProgress(progress);

  if (progress.stage === "done") {
    setDownloading(false);
    if (downloadingModel === "asr") setAsrReady(true);
    else setModelReady(true);
  } else if (progress.stage === "error") {
    setDownloading(false);
  } else {
    setDownloading(true);
  }
});
```

`useTauriEvent` 的 latest-handler ref 负责读取最新提交的 `downloadingModel`，无需增加业务 ref。模型从 KWS 切换到 ASR 时 listener 不重建，因此不存在注销/重新注册期间的事件空窗。

## 行为不变量

- 所有 stage 都更新 `progress`。
- `downloading`、`extracting` 和未知非终态 stage 设置 `downloading = true`。
- `error` 设置 `downloading = false`。
- `done` 设置 `downloading = false`。
- 最新 `downloadingModel === "asr"` 时 `done` 只设置 ASR ready；其余值保持现有 KWS ready 语义。
- cleanup 后 stale callback 不更新任何状态。
- registration rejection 使用默认标签 `listen:voice://download-progress`。

## 测试矩阵

- 初始 settings/readiness 读取契约保持；
- listener 只注册一次；
- KWS/ASR 下载模型变化不重建 listener；
- 同一个 callback 在 KWS done 时设置 KWS ready；
- 同一个 callback 在模型切为 ASR 后读取最新值并设置 ASR ready；
- `downloading`、`extracting`、未知 stage 保持下载态；
- `error` 停止下载并保留 payload；
- stale callback 在卸载后不写状态；
- 卸载前 registration resolve 时 disposer 精确一次；
- 卸载后 registration 才 resolve 时立即清理；
- StrictMode 每代精确清理，第一代 callback 永久失效；
- registration rejection 带 scoped 标签；
- listener 事件和模型切换不额外触发下载 RPC、关键词验证或热重载。

## 完成门禁

先获得 RED，再做最小迁移；运行 VoicePanel + shared-hook 专项、完整 listener 回归、TypeScript、scoped diff check、独立 Cargo target `pnpm verify`，并使用一个独立只读审查 Agent。验证通过后精确提交到本地 `main`，不 push，不夹带范围外工作树改动。
