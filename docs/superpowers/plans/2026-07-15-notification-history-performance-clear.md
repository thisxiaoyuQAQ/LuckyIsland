# Notification History Performance and Clear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove remaining notification-page expansion jank by rendering history in 20-item batches, and add a confirmed native “清理历史” action that deletes persisted notifications and resets the live cache safely.

**Architecture:** Keep the existing module-level notification history loader as the cross-remount source of truth, extend it with pure pagination/reset behavior, and let `NotifyPage` render only the current slice. Add one Rust database command for deletion and one small frontend clear transaction that confirms first, invokes second, and mutates cache/UI only after success.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri v2 invoke/dialog, Rust, rusqlite, Motion.

## Global Constraints

- Preserve the current notification storage, incoming-event, filtering, read-state and Windows Toast semantics.
- Keep `notify_list` capped at 100 and do not add a virtual-list dependency.
- Initial expanded render shows 20 notifications; each “加载更多” action adds 20 and never exceeds the actual list length.
- “清理历史” uses the Tauri native dialog text `将永久删除全部历史通知，此操作不可撤销。`.
- Cancel does not invoke Rust or mutate cache/UI; failure preserves cache/UI and displays an inline error.
- Clearing notifications must not delete settings, notification token or future incoming notifications.
- Do not edit, clean, stage or commit the module 10 paths currently present in the worktree: `vault/CURRENT.md`, `vault/10b-工程基线与低风险重构.md`, `docs/superpowers/{plans,specs}/2026-07-15-ref-10b-01-*`, `src/lib/useAsyncSubscription.ts`, `src/lib/useTauriEvent.ts`, and their tests.
- Task 8 is currently uncommitted; stage only explicit paths listed in this plan and keep its final feature commit separate from module 10 work.

---

### Task 1: Add pure pagination and cache reset behavior

**Files:**
- Modify: `src/lib/notification-history.ts`
- Modify: `src/lib/__tests__/notification-history.test.ts`

**Interfaces:**
- Consumes: existing `createNotificationHistoryLoader(fetchHistory)` with `load`, `prepend`, `markAllRead`.
- Produces:

```ts
export const NOTIFICATION_PAGE_SIZE = 20;
export function nextNotificationVisibleCount(
  current: number,
  total: number,
  pageSize?: number,
): number;

// Existing loader gains:
clear(): NotificationHistoryItem[];
```

- [ ] **Step 1: Write failing pagination and clear tests**

Append to `src/lib/__tests__/notification-history.test.ts`:

```ts
import {
  createNotificationHistoryLoader,
  nextNotificationVisibleCount,
  NOTIFICATION_PAGE_SIZE,
} from "../notification-history";

it("grows visible history by twenty and caps at the actual total", () => {
  expect(NOTIFICATION_PAGE_SIZE).toBe(20);
  expect(nextNotificationVisibleCount(20, 55)).toBe(40);
  expect(nextNotificationVisibleCount(40, 55)).toBe(55);
  expect(nextNotificationVisibleCount(55, 55)).toBe(55);
});

it("clears cached history and accepts new notifications afterward", async () => {
  const loader = createNotificationHistoryLoader(async () => items);
  await loader.load();

  expect(loader.clear()).toEqual([]);
  await expect(loader.load()).resolves.toEqual([]);

  const incoming = { ...items[0], id: "2" };
  expect(loader.prepend(incoming)).toEqual([incoming]);
});
```

Keep the existing in-flight deduplication test unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm test src/lib/__tests__/notification-history.test.ts
```

Expected: FAIL because `NOTIFICATION_PAGE_SIZE`, `nextNotificationVisibleCount`, and `loader.clear` do not exist.

- [ ] **Step 3: Implement minimal pure behavior**

In `src/lib/notification-history.ts`, add:

```ts
export const NOTIFICATION_PAGE_SIZE = 20;

export function nextNotificationVisibleCount(
  current: number,
  total: number,
  pageSize = NOTIFICATION_PAGE_SIZE,
): number {
  return Math.min(total, current + pageSize);
}
```

Inside `createNotificationHistoryLoader`, add:

```ts
const clear = () => {
  cached = [];
  pending = undefined;
  return cached;
};
```

Return it:

```ts
return { load, prepend, markAllRead, clear };
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm test src/lib/__tests__/notification-history.test.ts
```

Expected: all notification-history tests pass.

- [ ] **Step 5: Keep changes unstaged for the Task 8 feature commit**

Do not commit yet. Task 2 consumes these interfaces, and the current worktree already contains the uncommitted Task 8 feature. Confirm only intended paths changed:

```bash
git diff --name-only -- src/lib/notification-history.ts src/lib/__tests__/notification-history.test.ts
```

Expected: exactly those two paths.

---

### Task 2: Add the isolated Rust clear command

**Files:**
- Modify: `src-tauri/src/notify/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/notify/mod.rs`

**Interfaces:**
- Consumes: `Db(pub Mutex<Connection>)` and existing notification table.
- Produces:

```rust
pub fn clear_notifications(db: &Db) -> Result<usize, String>;

#[tauri::command]
pub fn notify_clear(db: State<'_, Db>) -> Result<usize, String>;
```

The returned count is the number of deleted rows and is informational; frontend success is determined by a resolved invoke.

- [ ] **Step 1: Write a failing deletion-isolation test**

Inside `src-tauri/src/notify/mod.rs` test module, add an in-memory helper and test:

```rust
fn db_with_notification_and_setting() -> Db {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE notifications (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           body TEXT,
           source TEXT NOT NULL,
           level TEXT NOT NULL,
           priority TEXT NOT NULL DEFAULT 'normal',
           created_at INTEGER NOT NULL,
           read INTEGER NOT NULL DEFAULT 0,
           action_type TEXT,
           action_cwd TEXT
         );
         INSERT INTO settings (key, value) VALUES ('notify:http_token', 'keep-me');
         INSERT INTO notifications
           (id, title, source, level, priority, created_at)
         VALUES ('n1', 'test', 'custom', 'info', 'normal', 1);",
    )
    .unwrap();
    Db(std::sync::Mutex::new(conn))
}

#[test]
fn clear_notifications_deletes_history_without_touching_settings() {
    let db = db_with_notification_and_setting();

    assert_eq!(clear_notifications(&db).unwrap(), 1);
    assert!(list_notifications(&db, Some(100)).unwrap().is_empty());
    assert_eq!(db.setting_get("notify:http_token").as_deref(), Some("keep-me"));
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml \
  notify::tests::clear_notifications_deletes_history_without_touching_settings -- --nocapture
```

Expected: FAIL because `clear_notifications` is undefined.

- [ ] **Step 3: Implement deletion and command wrapper**

Add next to `mark_read` in `src-tauri/src/notify/mod.rs`:

```rust
pub fn clear_notifications(db: &Db) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM notifications", [])
        .map_err(|error| error.to_string())
}
```

Add the command next to `notify_mark_read`:

```rust
#[tauri::command]
pub fn notify_clear(db: State<'_, Db>) -> Result<usize, String> {
    clear_notifications(&db)
}
```

In `src-tauri/src/lib.rs`, import it:

```rust
use notify::{notify_clear, notify_create, notify_get_token, notify_list, notify_mark_read};
```

Register it in `tauri::generate_handler!` immediately after `notify_mark_read`:

```rust
notify_clear,
```

No capability change is needed for a Tauri command; `dialog:default` is separate and handled in Task 3.

- [ ] **Step 4: Run notify tests and verify GREEN**

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml notify:: -- --nocapture
```

Expected: all notify tests pass, including deletion isolation.

- [ ] **Step 5: Keep Rust changes unstaged for the final feature commit**

Run:

```bash
git diff --check -- src-tauri/src/notify/mod.rs src-tauri/src/lib.rs
```

Expected: exit 0. Do not stage module 10 paths.

---

### Task 3: Render 20-item batches and add confirmed clear UI

**Files:**
- Modify: `src/components/pages/notify/NotifyPage.tsx`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src/components/pages/notify/__tests__/NotifyPage.test.tsx`
- Consume: `src/lib/notification-history.ts`

**Interfaces:**
- Consumes:
  - `NOTIFICATION_PAGE_SIZE`
  - `nextNotificationVisibleCount(current, total)`
  - `historyLoader.clear()`
  - Rust command `notify_clear`
  - `confirm(message, options)` from `@tauri-apps/plugin-dialog`
- Produces: paginated notification UI and confirmed clear behavior.

- [ ] **Step 1: Write failing UI tests with mocked Tauri boundaries**

Create `src/components/pages/notify/__tests__/NotifyPage.test.tsx`. Follow the repository’s existing happy-dom React mounting pattern (`createRoot`, `act`) and mock `@tauri-apps/api/core`, `@tauri-apps/api/event`, `@tauri-apps/plugin-dialog`, and `motion/react`. The core assertions are:

```tsx
it("renders twenty items first and loads twenty more", async () => {
  notifyItems = Array.from({ length: 45 }, (_, index) => makeItem(index));
  const view = await mountNotifyPage();

  expect(view.querySelectorAll("[data-notification-id]")).toHaveLength(20);
  click(buttonNamed(view, "加载更多"));
  expect(view.querySelectorAll("[data-notification-id]")).toHaveLength(40);
  click(buttonNamed(view, "加载更多"));
  expect(view.querySelectorAll("[data-notification-id]")).toHaveLength(45);
  expect(buttonNamedOrNull(view, "加载更多")).toBeNull();
});

it("cancels clear without invoking the backend", async () => {
  confirmMock.mockResolvedValue(false);
  const view = await mountNotifyPage();

  click(buttonNamed(view, "清理历史"));
  await flush();

  expect(invokeMock).not.toHaveBeenCalledWith("notify_clear");
  expect(view.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);
});

it("clears only after backend success and preserves items on failure", async () => {
  confirmMock.mockResolvedValue(true);
  invokeMock.mockImplementation((command) => {
    if (command === "notify_clear") return Promise.reject(new Error("database busy"));
    return Promise.resolve(notifyItems);
  });
  const view = await mountNotifyPage();

  click(buttonNamed(view, "清理历史"));
  await flush();
  expect(view.textContent).toContain("清理历史失败：database busy");
  expect(view.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);

  invokeMock.mockImplementation((command) =>
    command === "notify_clear" ? Promise.resolve(notifyItems.length) : Promise.resolve(notifyItems),
  );
  click(buttonNamed(view, "清理历史"));
  await flush();
  expect(view.querySelectorAll("[data-notification-id]")).toHaveLength(0);
});
```

Give each rendered notification wrapper `data-notification-id={item.id}` in the production code so tests target behavior rather than CSS.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
pnpm test src/components/pages/notify/__tests__/NotifyPage.test.tsx
```

Expected: FAIL because pagination, clear button, confirm flow, error display and notification data attributes are absent.

- [ ] **Step 3: Grant dialog permission to the island window**

Modify `src-tauri/capabilities/default.json` permissions from:

```json
["core:default", "opener:default"]
```

to:

```json
["core:default", "dialog:default", "opener:default"]
```

This is required because the clear button lives in the `island` WebView; the settings-only dialog permission does not apply to it.

- [ ] **Step 4: Implement pagination state and rendering**

In `NotifyPage.tsx`, import:

```ts
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  createNotificationHistoryLoader,
  nextNotificationVisibleCount,
  NOTIFICATION_PAGE_SIZE,
} from "@/lib/notification-history";
```

Add state:

```ts
const [visibleCount, setVisibleCount] = useState(NOTIFICATION_PAGE_SIZE);
const [clearing, setClearing] = useState(false);
const [clearError, setClearError] = useState<string | null>(null);
const visibleItems = items.slice(0, visibleCount);
```

Reset `visibleCount` to 20 only after successful clear. Do not reset it on compact/expanded remount; each new expanded mount naturally initializes to 20, which is the performance requirement.

Change the list map to:

```tsx
{visibleItems.map((item) => (
  <motion.div
    key={item.id}
    data-notification-id={item.id}
    initial={{ opacity: 0, y: -12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -12 }}
    transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
  >
    <NotifyCard item={item} />
  </motion.div>
))}
```

After the list, add:

```tsx
{visibleCount < items.length && (
  <Button
    variant="ghost"
    size="sm"
    className="mx-auto mt-2 flex h-7 px-3 text-xs"
    onClick={() =>
      setVisibleCount((current) => nextNotificationVisibleCount(current, items.length))
    }
  >
    加载更多
  </Button>
)}
```

- [ ] **Step 5: Implement confirmed clear transaction**

Add:

```ts
const clearHistory = async () => {
  if (clearing || items.length === 0) return;
  setClearError(null);
  const accepted = await confirm("将永久删除全部历史通知，此操作不可撤销。", {
    title: "清理历史通知",
    kind: "warning",
    okLabel: "清理",
    cancelLabel: "取消",
  });
  if (!accepted) return;

  setClearing(true);
  try {
    await invoke<number>("notify_clear");
    setItems(historyLoader.clear());
    setVisibleCount(NOTIFICATION_PAGE_SIZE);
  } catch (error) {
    setClearError(error instanceof Error ? error.message : String(error));
  } finally {
    setClearing(false);
  }
};
```

In the page heading’s right side, replace the current unread-only element with:

```tsx
<div className="flex items-center gap-2">
  {unread > 0 && <span className="text-[11px] text-primary">{unread} 未读</span>}
  <Button
    variant="outline"
    size="sm"
    className="h-7 border-destructive/50 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
    disabled={clearing || items.length === 0}
    onClick={() => void clearHistory()}
  >
    {clearing ? "清理中…" : "清理历史"}
  </Button>
</div>
```

Render the inline error directly below the heading:

```tsx
{clearError && (
  <p className="text-xs text-destructive">清理历史失败：{clearError}</p>
)}
```

The cache is cleared only after `notify_clear` resolves. Incoming events after resolution still use `historyLoader.prepend` and repopulate the empty list.

- [ ] **Step 6: Run focused frontend tests and verify GREEN**

Run:

```bash
pnpm test \
  src/lib/__tests__/notification-history.test.ts \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx
```

Expected: pagination, cancel, success and failure tests all pass.

- [ ] **Step 7: Run static checks for the island dialog capability**

Run:

```bash
pnpm exec tsc --noEmit
git diff --check -- src-tauri/capabilities/default.json src/components/pages/notify/NotifyPage.tsx
```

Expected: both commands exit 0; `default.json` includes `dialog:default` only once.

---

### Task 4: Full regression, manual verification and isolated Task 8 commit

**Files:**
- Verify all Task 8 and notification performance paths.
- Stage only the explicit list below.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified Task 8 feature commit containing notification priority, fullscreen override, hover regression fix, cached/paginated history, and confirmed history clear—without module 10 paths.

- [ ] **Step 1: Run the full frontend regression gate**

Run:

```bash
pnpm test:frontend
pnpm exec tsc --noEmit
pnpm build
```

Expected: all frontend tests pass; all three Vite entries build. The existing main chunk >500 kB warning is allowed but no new errors are allowed.

- [ ] **Step 2: Run the Rust notification and policy gate**

Run:

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml notify:: -- --nocapture

CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml storage:: -- --nocapture

CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml window_policy::tests -- --nocapture

CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass without warnings introduced by these changes.

- [ ] **Step 3: Run format and whitespace checks**

Run:

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustfmt.exe \
  --edition 2021 --check \
  src-tauri/src/notify/mod.rs \
  src-tauri/src/storage/mod.rs \
  src-tauri/src/window_policy.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/bin/lucky-notify.rs

git diff --check
```

Expected: exit 0. CRLF conversion notices are informational only.

- [ ] **Step 4: User performs Windows GUI verification**

Ask the user to verify in their existing `pnpm tauri dev` session:

1. With at least 40 notifications, expanding the notification page initially creates 20 cards and feels smooth.
2. “加载更多” reveals 20 more; the final click reveals the remainder and removes the button.
3. “清理历史” opens the native warning dialog with “清理” and “取消”.
4. Cancel preserves the list.
5. Confirm clears the list; reopening/restarting keeps it empty.
6. A new notification after clearing appears normally.
7. Disabling hover expansion still produces no pointer-enter visual twitch.

Do not claim GUI success until the user confirms.

- [ ] **Step 5: Inspect and stage only Task 8 paths**

Run:

```bash
git status --short
git diff --check
git add \
  docs/Claude-Codex-hook配置.md \
  src-tauri/capabilities/default.json \
  src-tauri/src/bin/lucky-notify.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/notify/mod.rs \
  src-tauri/src/storage/mod.rs \
  src-tauri/src/window_policy.rs \
  src/App.tsx \
  src/components/pages/notify/NotifyCard.tsx \
  src/components/pages/notify/NotifyPage.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  src/lib/notification-history.ts \
  src/lib/__tests__/notification-history.test.ts \
  src/lib/window-policy.ts \
  src/lib/__tests__/window-policy.test.ts
git diff --cached --check
git diff --cached --name-only
```

Expected: cached paths are exactly the listed Task 8/performance-fix files. In particular, no `vault/10b-*`, `vault/CURRENT.md`, `2026-07-15-ref-10b-01-*`, `useAsyncSubscription*`, or `useTauriEvent*` path is staged.

- [ ] **Step 6: Commit after user GUI confirmation**

```bash
git commit -m "feat(notify): 增加全屏优先级与历史管理" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: one Task 8 feature commit; no push, tag or Release.
