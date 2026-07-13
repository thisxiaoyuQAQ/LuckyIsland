# Voice Listening Event Delivery Implementation Plan

> **历史状态（2026-07-13）：** ✅ 对应修复已实施，并于 2026-07-11 完成真机验收。本文件是当时的实施脚本，所有 `- [ ]`、命令与未提交约束不是当前 TODO。
> **当前事实与验收：** [`vault/08-AI助手.md`](../../../vault/08-AI助手.md)、[`docs/开发进度.md`](../../开发进度.md) 的 BUG-20260710-03 与 2026-07-11 验收记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “正在聆听…” visible for the real manual-recording interval and clear it reliably on every exit.

**Architecture:** The Tauri command becomes async and moves microphone/ASR blocking work to `tokio::task::spawn_blocking`, freeing the runtime to deliver `voice://listening` during recording. A drop guard owns `manual_recording` cleanup and the false event; React treats the boolean payload as authoritative and keeps a timer only as an abnormal fallback.

**Tech Stack:** Rust 2021, Tauri 2, Tokio `spawn_blocking`, cpal, sherpa-onnx, React 19, TypeScript.

## Global Constraints

- Keep manual recording isolated from KWS through `VoiceState.manual_recording`.
- Emit `voice://listening=true` only after `cpal_stream.play()` succeeds.
- Emit false and reset the flag on normal return, error, and Rust unwind.
- Frontend reads `event.payload`; false is not ignored; timer is fallback only.
- Close a listener whose registration promise resolves after React cleanup.
- Do not change `VOICE_RMS`, `SILENCE_END`, `ASR_UTTERANCE_TIMEOUT`, KWS, TTS, or `ASR_BLANK_PENALTY = 0.0`.
- Preserve uncommitted edits. Do not stage or commit.

## File Structure

- Modify `src-tauri/src/voice/mod.rs`: guard, async command, blocking helper, tests.
- Modify `src/ai-palette/AiPalette.tsx`: boolean listener and command finalization.

---

### Task 1: Recording Cleanup Guard

**Files:** Modify `src-tauri/src/voice/mod.rs` around the manual command and tests.

**Interfaces:** Produces `RecordingGuard<F: FnOnce()>`, which sets one `Arc<AtomicBool>` true on construction and resets it plus invokes `on_drop` once on drop.

- [ ] **Step 1: Write guard tests without removing the ASR regression**

```rust
#[test]
fn recording_guard_resets_on_normal_and_error_return() {
    for fail in [false, true] {
        let manual = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicUsize::new(0));
        let result: Result<(), ()> = {
            let stopped_for_drop = stopped.clone();
            let _guard = RecordingGuard::new(manual.clone(), move || {
                stopped_for_drop.fetch_add(1, Ordering::SeqCst);
            });
            assert!(manual.load(Ordering::SeqCst));
            if fail { Err(()) } else { Ok(()) }
        };
        assert_eq!(result.is_err(), fail);
        assert!(!manual.load(Ordering::SeqCst));
        assert_eq!(stopped.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn recording_guard_resets_during_unwind() {
    let manual = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(AtomicUsize::new(0));
    let manual_for_panic = manual.clone();
    let stopped_for_panic = stopped.clone();
    assert!(std::panic::catch_unwind(move || {
        let stopped_for_drop = stopped_for_panic.clone();
        let _guard = RecordingGuard::new(manual_for_panic, move || {
            stopped_for_drop.fetch_add(1, Ordering::SeqCst);
        });
        panic!("test unwind");
    }).is_err());
    assert!(!manual.load(Ordering::SeqCst));
    assert_eq!(stopped.load(Ordering::SeqCst), 1);
}
```

Run `cargo test voice::tests::recording_guard -- --nocapture`; expected red because the guard is absent.

- [ ] **Step 2: Implement the guard**

```rust
struct RecordingGuard<F: FnOnce()> {
    manual_recording: Arc<AtomicBool>,
    on_drop: Option<F>,
}
impl<F: FnOnce()> RecordingGuard<F> {
    fn new(manual_recording: Arc<AtomicBool>, on_drop: F) -> Self {
        manual_recording.store(true, Ordering::SeqCst);
        Self { manual_recording, on_drop: Some(on_drop) }
    }
}
impl<F: FnOnce()> Drop for RecordingGuard<F> {
    fn drop(&mut self) {
        self.manual_recording.store(false, Ordering::SeqCst);
        if let Some(on_drop) = self.on_drop.take() { on_drop(); }
    }
}
```

- [ ] **Step 3: Verify guard and blank-penalty tests**

Run `cargo test voice::tests -- --nocapture`; expected guard tests and `asr_blank_penalty_keeps_blank_tokens_unpenalized` pass. Inspect the diff; do not commit.

---

### Task 2: Async Command and Blocking Recording Helper

**Files:** Modify `src-tauri/src/voice/mod.rs:811-910`.

**Interfaces:** Produces async `voice_record_utterance` and `record_utterance_blocking(app, manual_recording)`.

- [ ] **Step 1: Convert the command boundary**

```rust
#[tauri::command]
pub async fn voice_record_utterance(
    app: AppHandle,
    state: tauri::State<'_, VoiceState>,
) -> Result<String, String> {
    if !is_model_ready(&app, &ModelKind::Asr) {
        return Err("语音问答模型尚未下载，请先在设置里下载语音问答模型".to_string());
    }
    let manual_recording = state.manual_recording.clone();
    tokio::task::spawn_blocking(move || record_utterance_blocking(app, manual_recording))
        .await
        .map_err(|e| format!("录音任务异常退出：{e}"))?
}
```

- [ ] **Step 2: Implement helper ownership and cleanup**

```rust
fn record_utterance_blocking(
    app: AppHandle,
    manual_recording: Arc<AtomicBool>,
) -> Result<String, String> {
    let app_for_stop = app.clone();
    let _guard = RecordingGuard::new(manual_recording, move || {
        let _ = app_for_stop.emit("voice://listening", false);
        eprintln!("[voice] 已 emit voice://listening=false，按需录音结束");
    });
    let com_initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) { if self.0 { unsafe { CoUninitialize() } } }
    }
    let _com = ComGuard(com_initialized);
```

Move the existing host/device/config, `build_asr_if_ready`, channel, and three `build_input_stream` sample-format arms into this helper without altering sample conversion. Keep `cpal_stream` in this function. Replace the old nested thread/result channel with:

```rust
    cpal_stream.play().map_err(|e| format!("启动麦克风采集失败：{e}"))?;
    app.emit("voice://listening", true)
        .map_err(|e| format!("发送正在聆听状态失败：{e}"))?;
    eprintln!("[voice] 已 emit voice://listening=true");
    let result = transcribe_once(&asr, &rx);
    eprintln!("[voice] 按需转写结果：{result:?}");
    result
}
```

Delete the old `std::thread::spawn`, `result_tx/result_rx`, explicit manual flag stores, and blocking `result_rx.recv()`.

- [ ] **Step 3: Verify Rust voice path**

Run:

```powershell
cargo test voice:: -- --nocapture
cargo check
rg -n "pub async fn voice_record_utterance|voice://listening.*false|result_rx|ASR_BLANK_PENALTY|VOICE_RMS|SILENCE_END" src-tauri/src/voice/mod.rs
```

Expected: tests/check pass; async command and false event exist; no result channel remains in the manual command; approved constants are unchanged. Do not commit.

---

### Task 3: Boolean Listener and StrictMode-Safe Cleanup

**Files:** Modify `src/ai-palette/AiPalette.tsx` around the `voice://listening` effect and `recordVoice` finalizer.

**Interfaces:** Consumes backend boolean `voice://listening` events. Produces one live listener per mounted palette, authoritative true/false rendering, and an 8-second abnormal fallback timer.

- [ ] **Step 1: Replace the listening effect with payload-aware lifecycle handling**

```tsx
useEffect(() => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  void listen<boolean>("voice://listening", (event) => {
    if (disposed) return;
    console.log("[ai-palette] 收到 voice://listening", event.payload);
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    setListening(event.payload);
    if (event.payload) {
      timer = setTimeout(() => {
        timer = undefined;
        setListening(false);
      }, 8000);
    }
  }).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  }).catch((error) => {
    console.error("[ai-palette] 监听 voice://listening 失败", error);
  });

  return () => {
    disposed = true;
    unlisten?.();
    if (timer) clearTimeout(timer);
  };
}, []);
```

The late-resolution branch must call `fn()` immediately so React StrictMode mount/unmount cannot leak the first asynchronous registration.

- [ ] **Step 2: Stop the command finalizer from overriding backend state**

Keep transcript-driven `setListening(false)` in the wake transcript listener. Change only the manual command finalizer:

```tsx
} finally {
  setRecording(false);
}
```

Do not add a frontend `setListening(true)` to `recordVoice`; the backend event remains authoritative and only fires after microphone playback succeeds.

- [ ] **Step 3: Verify the frontend contract**

Run:

```powershell
npx tsc --noEmit
rg -n -C 5 'listen<boolean>\("voice://listening"|event\.payload|disposed|setRecording\(false\)|setListening\(false\)' src/ai-palette/AiPalette.tsx
```

Expected: TypeScript passes; the listener consumes both boolean values; a late listener is closed; `recordVoice` finally only resets recording. Do not stage or commit.

---

### Task 4: Integrated and Real-Machine Verification

- [ ] Run `cargo test voice:: -- --nocapture`; expected the cleanup guard tests and existing ASR blank-penalty regression tests pass.
- [ ] Run `cargo check` and `npx tsc --noEmit`; expected both pass with no warnings introduced by this change.
- [ ] Run `git diff --check` and `git status --short`; expected no whitespace errors and every change remains unstaged.
- [ ] Normal speech: click the microphone, confirm the overlay is visible while speech is captured, disappears after transcription, and the text is inserted without automatic send.
- [ ] Silence: click the microphone and stay silent, confirm the overlay remains visible during the capture timeout, then disappears and a second recording can start.
- [ ] Failure path: make the microphone or ASR model unavailable, confirm no stale overlay remains and `manual_recording` does not block later wake listening.
- [ ] Wake regression: wake once and speak; confirm transcript efficiency remains acceptable, no duplicate characters return, and the manual-recording change does not self-trigger KWS.
- [ ] Inspect logs for paired `voice://listening=true` / `false` on every path; do not stage or commit.

## Self-Review

- Spec coverage: guard cleanup is Task 1; async command and event delivery are Task 2; boolean payload and StrictMode cleanup are Task 3; automated and real-machine paths are Task 4.
- Placeholder scan: every code-changing step contains exact code, command, and expected outcome; no deferred markers remain.
- Type consistency: Rust emits `bool`; React registers `listen<boolean>` and uses `event.payload`; `RecordingGuard` owns the same `Arc<AtomicBool>` cloned from `VoiceState.manual_recording`.
- Timing consistency: backend emits true only after `cpal_stream.play()` and false from guard drop; the frontend 8-second timer is abnormal fallback only and command finally cannot preempt false delivery.
- Regression boundary: KWS, VAD, TTS, sample conversion, ASR timeout, and `ASR_BLANK_PENALTY = 0.0` remain unchanged.
- Commit constraint: no task stages or commits.


## 2026-07-11 收尾更新

- 用户已确认按需录音期间“正在聆听”提示能够正常显示，BUG-20260710-03 按当前验收范围关闭。
- 计划编写时的“不暂存、不提交”约束已被用户 2026-07-11 的明确提交指令取代；语音修复与回归记录纳入本次收尾提交。
