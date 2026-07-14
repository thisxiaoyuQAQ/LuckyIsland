//! 自定义全局热键：动作 -> 绑定字符串，存 SQLite settings KV（`hotkeys:<id>`）。
//!
//! 当前内置两个动作（与历史硬编码行为对齐）：
//! - `toggle_island` 显示/隐藏灵动岛，默认 `alt+KeyX`
//! - `toggle_ai`     打开/关闭 AI 面板，默认 `alt+Space`
//!
//! 启动 / 设置面板改动 / 配置导入后调 [`apply`] 重新注册。插件 handler（`lib.rs`）
//! 在事件触发时用 `HotKey::id() -> u32` 反查 [`HotkeyMap`] 得到动作并分发，
//! 不再硬比较 `Shortcut::new(...)`，从而支持用户自定义绑定。
//!
//! 绑定字符串格式遵循 `global_hotkey::HotKey` 的 `Display`/`from_str`：修饰键在前
//! （`shift+control+alt+super+`，仅含按下的）+ 主键（`KeyX`/`Space`/`F12`/`ArrowUp`），
//! 大小写不敏感。前端按键捕获直接用 `KeyboardEvent.code` 大写化拼装即可。

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut as HotKey};

use crate::storage::Db;

/// `HotKey::id() -> 动作` 反查表，供插件 handler 分发。`app.manage` 注入。
#[derive(Default)]
pub struct HotkeyMap(pub Arc<Mutex<HashMap<u32, Action>>>);

/// 可绑定的动作。新增动作：加 variant + 下方三方法 + `ALL_ACTIONS`，handler 加 arm。
/// `Toggle*` 与持久化 action ID 的既有领域命名保持一致。
#[allow(clippy::enum_variant_names)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    ToggleIsland,
    ToggleAi,
    ToggleClickThrough,
}

impl Action {
    /// 持久化用的字符串 id（也是 settings KV 的后缀）。
    pub fn id_str(&self) -> &'static str {
        match self {
            Action::ToggleIsland => "toggle_island",
            Action::ToggleAi => "toggle_ai",
            Action::ToggleClickThrough => "toggle_click_through",
        }
    }

    /// 设置面板展示用的中文标签。
    pub fn label(&self) -> &'static str {
        match self {
            Action::ToggleIsland => "显示/隐藏灵动岛",
            Action::ToggleAi => "打开/关闭 AI 面板",
            Action::ToggleClickThrough => "开启/关闭鼠标穿透",
        }
    }

    /// 默认绑定；None 表示动作默认未绑定。
    pub fn default_binding(&self) -> Option<&'static str> {
        match self {
            Action::ToggleIsland => Some("alt+KeyX"),
            Action::ToggleAi => Some("alt+Space"),
            Action::ToggleClickThrough => None,
        }
    }
}

/// 全部可绑定动作（UI 列表与默认值来源）。新增动作在此追加。
const ALL_ACTIONS: [Action; 3] = [
    Action::ToggleIsland,
    Action::ToggleAi,
    Action::ToggleClickThrough,
];

/// `hotkeys:<id>` 形式的 settings key。
fn setting_key(action: Action) -> String {
    format!("hotkeys:{}", action.id_str())
}

/// 由字符串 id 反解动作。
fn parse_action(id: &str) -> Option<Action> {
    match id {
        "toggle_island" => Some(Action::ToggleIsland),
        "toggle_ai" => Some(Action::ToggleAi),
        "toggle_click_through" => Some(Action::ToggleClickThrough),
        _ => None,
    }
}

/// 规范化绑定字符串：解析成功返回 `HotKey::into_string` 的规范形，失败返回 None。
/// 用于「保留用户输入大小写习惯的同时落盘统一形式」，并兼做合法性校验。
fn normalize(binding: &str) -> Option<String> {
    HotKey::from_str(binding).ok().map(|h| h.into_string())
}

fn binding_from_stored(stored: Option<&str>, action: Action) -> Option<HotKey> {
    match stored {
        Some("") => None,
        Some(value) => HotKey::from_str(value).ok().or_else(|| {
            action
                .default_binding()
                .and_then(|default| HotKey::from_str(default).ok())
        }),
        None => action
            .default_binding()
            .and_then(|default| HotKey::from_str(default).ok()),
    }
}

#[cfg(test)]
fn default_hotkey_ids() -> HashSet<u32> {
    ALL_ACTIONS
        .iter()
        .filter_map(|action| action.default_binding())
        .filter_map(|binding| HotKey::from_str(binding).ok())
        .map(|hotkey| hotkey.id())
        .collect()
}

/// 读某动作当前生效绑定：缺失值使用默认，显式空值保持未绑定，坏值回退默认。
fn current_binding(db: &Db, action: Action) -> Option<HotKey> {
    let stored = db.setting_get(&setting_key(action));
    binding_from_stored(stored.as_deref(), action)
}

/// 读全部动作的当前生效绑定。
fn load_bindings(db: &Db) -> Vec<(Action, Option<HotKey>)> {
    ALL_ACTIONS
        .iter()
        .map(|&a| (a, current_binding(db, a)))
        .collect()
}

/// UI 列表项（`hotkeys_list` 返回）。
#[derive(serde::Serialize, Clone)]
pub struct HotkeyEntry {
    pub action: String,
    pub label: String,
    pub binding: String,
    pub default: String,
}

/// 应用结果（`hotkeys_apply` / `hotkeys_reset` 返回，每动作一条）。
#[derive(serde::Serialize, Clone)]
pub struct HotkeyResult {
    pub action: String,
    pub binding: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// 核心：按 DB 当前绑定 `unregister_all` 后逐个注册，刷新 [`HotkeyMap`]。
///
/// 在 setup（主线程）与 async 命令（worker 线程）两种上下文调用均安全——
/// `register`/`unregister_all` 内部 marshaling 到主线程，与历史 setup 直调 `register`
/// 同一调用链。sync 命令上下文不要直接调（改走 async 命令）。
pub fn apply(app: &AppHandle, db: &Db) -> Vec<HotkeyResult> {
    let bindings = load_bindings(db);
    let gs = app.global_shortcut();
    // 清旧绑定；首次启动或全空时是 no-op，忽略错误（未注册项注销失败无意义）。
    let _ = gs.unregister_all();

    let map = app.state::<HotkeyMap>();
    map.0.lock().unwrap().clear();

    let mut seen: HashSet<u32> = HashSet::new();
    let mut results = Vec::with_capacity(bindings.len());
    for (action, binding) in bindings {
        let Some(parsed) = binding else {
            results.push(HotkeyResult {
                action: action.id_str().to_string(),
                binding: String::new(),
                ok: true,
                error: None,
            });
            continue;
        };
        let binding = parsed.into_string();
        let id = parsed.id();
        // 跨动作冲突：两个动作绑到同一组合键，后者拒绝注册。
        if !seen.insert(id) {
            results.push(HotkeyResult {
                action: action.id_str().to_string(),
                binding,
                ok: false,
                error: Some("与其它动作冲突".to_string()),
            });
            continue;
        }
        match gs.register(parsed) {
            Ok(()) => {
                map.0.lock().unwrap().insert(id, action);
                results.push(HotkeyResult {
                    action: action.id_str().to_string(),
                    binding,
                    ok: true,
                    error: None,
                });
            }
            Err(e) => {
                results.push(HotkeyResult {
                    action: action.id_str().to_string(),
                    binding,
                    ok: false,
                    error: Some(format!("注册失败：{e}")),
                });
            }
        }
    }
    results
}

/// 列出全部动作 + 当前绑定 + 默认绑定（设置面板初始化用）。
#[tauri::command]
pub fn hotkeys_list(db: State<'_, Db>) -> Result<Vec<HotkeyEntry>, String> {
    Ok(ALL_ACTIONS
        .iter()
        .map(|&a| HotkeyEntry {
            action: a.id_str().to_string(),
            label: a.label().to_string(),
            binding: current_binding(&db, a)
                .map(|hotkey| hotkey.into_string())
                .unwrap_or_default(),
            default: a.default_binding().unwrap_or_default().to_string(),
        })
        .collect())
}

/// 批量保存绑定并重新注册。`bindings: Vec<(action_id, binding)>`。
///
/// 解析成功的绑定落盘规范形（统一大小写），解析失败的保留原值——后者会在
/// 随后 [`apply`] 里产生 `ok=false` 的错误项返回给前端展示。写完 KV 再统一 apply，
/// 保证注册态与 DB 一致（原子切换，不会出现「写了一半」的中间态）。
#[tauri::command]
pub async fn hotkeys_apply(
    app: AppHandle,
    db: State<'_, Db>,
    bindings: Vec<(String, String)>,
) -> Result<Vec<HotkeyResult>, String> {
    for (id, binding) in &bindings {
        let action = parse_action(id).ok_or_else(|| format!("未知动作：{id}"))?;
        let normalized = normalize(binding).unwrap_or_else(|| binding.clone());
        db.setting_set(&setting_key(action), &normalized)
            .map_err(|e| e.to_string())?;
    }
    Ok(apply(&app, db.inner()))
}

/// 全部恢复默认：删 `hotkeys:*` KV 后按默认重新注册。
#[tauri::command]
pub async fn hotkeys_reset(app: AppHandle, db: State<'_, Db>) -> Result<Vec<HotkeyResult>, String> {
    for &a in ALL_ACTIONS.iter() {
        db.setting_delete(&setting_key(a))
            .map_err(|e| e.to_string())?;
    }
    Ok(apply(&app, db.inner()))
}

/// 暂停所有热键：`unregister_all` + 清 [`HotkeyMap`]，不写 DB。
///
/// 设置面板录制新组合键时调用，避免录制过程中按下「当前已注册」的组合键触发其
/// 动作（OS 层全局热键与 webview 键盘事件互相隔离，webview 的 preventDefault 拦不住）。
/// 录制结束/取消/面板卸载时用 [`hotkeys_reload`] 从 DB 恢复注册态。
#[tauri::command]
pub async fn hotkeys_suspend(app: AppHandle) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();
    app.state::<HotkeyMap>().0.lock().unwrap().clear();
    Ok(())
}

/// 按 DB 当前绑定重新注册（录制取消 / 面板卸载时恢复用，不写 DB）。
#[tauri::command]
pub async fn hotkeys_reload(
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<Vec<HotkeyResult>, String> {
    Ok(apply(&app, db.inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_empty_value_is_valid_unbound_not_default_fallback() {
        assert_eq!(binding_from_stored(Some(""), Action::ToggleIsland), None);
    }

    #[test]
    fn missing_value_still_uses_existing_defaults() {
        assert_eq!(
            binding_from_stored(None, Action::ToggleIsland)
                .unwrap()
                .into_string(),
            "alt+KeyX"
        );
        assert_eq!(
            binding_from_stored(None, Action::ToggleAi)
                .unwrap()
                .into_string(),
            "alt+Space"
        );
    }

    #[test]
    fn existing_default_collision_check_only_counts_bound_defaults() {
        assert_eq!(default_hotkey_ids().len(), 2);
    }

    #[test]
    fn click_through_is_default_unbound() {
        assert_eq!(Action::ToggleClickThrough.default_binding(), None);
        assert_eq!(binding_from_stored(None, Action::ToggleClickThrough), None);
        assert_eq!(default_hotkey_ids().len(), 2);
    }

    #[test]
    fn default_bindings_parse_and_match_display() {
        // 默认绑定必须可解析，且 into_string 往返稳定（确保落盘规范形可被 from_str 还原）。
        for &a in ALL_ACTIONS.iter() {
            let Some(raw) = a.default_binding() else {
                continue;
            };
            let h =
                HotKey::from_str(raw).unwrap_or_else(|e| panic!("默认绑定 {raw} 解析失败：{e}"));
            let canonical = h.into_string();
            HotKey::from_str(&canonical).expect("规范形必须可往返解析");
        }
    }

    #[test]
    fn normalize_canonicalizes_case_and_order() {
        // 用户输入大小写/修饰键顺序不规范时，normalize 应产出统一规范形。
        assert_eq!(normalize("Alt+KeyX").as_deref(), Some("alt+KeyX"));
        assert_eq!(normalize("ALT+SPACE").as_deref(), Some("alt+Space"));
        assert_eq!(
            normalize("shift+alt+KeyC").as_deref(),
            Some("shift+alt+KeyC")
        );
        // 规范形里修饰键顺序固定为 shift+control+alt+super，与用户输入顺序无关。
        assert_eq!(
            normalize("alt+shift+KeyC").as_deref(),
            Some("shift+alt+KeyC")
        );
        assert_eq!(
            normalize("control+alt+KeyC").as_deref(),
            Some("control+alt+KeyC")
        );
    }

    #[test]
    fn normalize_rejects_garbage() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("???"), None);
        assert_eq!(normalize("alt+"), None);
        // 纯修饰键、无主键：global_hotkey 视为非法格式。
        assert_eq!(normalize("alt"), None);
        assert_eq!(normalize("shift+alt"), None);
    }

    #[test]
    fn parse_action_roundtrip() {
        for &a in ALL_ACTIONS.iter() {
            assert_eq!(parse_action(a.id_str()), Some(a));
        }
        assert_eq!(parse_action("does_not_exist"), None);
    }

    #[test]
    fn setting_key_format() {
        assert_eq!(setting_key(Action::ToggleIsland), "hotkeys:toggle_island");
        assert_eq!(setting_key(Action::ToggleAi), "hotkeys:toggle_ai");
        assert_eq!(
            setting_key(Action::ToggleClickThrough),
            "hotkeys:toggle_click_through"
        );
    }

    #[test]
    fn default_keys_distinct() {
        // 两个默认绑定不能撞键，否则启动 apply 会判冲突。
        let ids: HashSet<u32> = ALL_ACTIONS
            .iter()
            .filter_map(|action| action.default_binding())
            .map(|binding| HotKey::from_str(binding).unwrap().id())
            .collect();
        assert_eq!(ids.len(), default_hotkey_ids().len());
    }
}
