//! 模块 15：语音 / 问答轻量卸载（契约 `vault/15-语音问答轻量卸载.md`）。
//!
//! 安装态存于本机 settings KV（不随配置导出/导入）；Rust 是唯一事实来源，
//! 卸载状态下相关命令一律拒绝，前端隐藏入口只是展示层。

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::storage::Db;
use crate::voice::VoiceState;

pub const AI_INSTALLED_KEY: &str = "modules:ai:installed";
pub const VOICE_INSTALLED_KEY: &str = "modules:voice:installed";
pub const MODULES_CHANGED_EVENT: &str = "modules://changed";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatus {
    pub ai: bool,
    pub voice: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModuleId {
    Ai,
    Voice,
}

impl ModuleId {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "ai" => Ok(Self::Ai),
            "voice" => Ok(Self::Voice),
            other => Err(format!("未知模块：{other}")),
        }
    }
}

/// 缺键或任何非 `false` 的值都视为已安装（老用户升级无感）。
fn parse_installed(value: Option<&str>) -> bool {
    value.map(str::trim) != Some("false")
}

/// 生效安装态：语音依赖问答（唤醒后的话交给问答回答），问答未安装时语音一律视为未安装。
pub fn status(db: &Db) -> ModuleStatus {
    let ai = parse_installed(db.setting_get(AI_INSTALLED_KEY).as_deref());
    let voice = parse_installed(db.setting_get(VOICE_INSTALLED_KEY).as_deref());
    ModuleStatus {
        ai,
        voice: ai && voice,
    }
}

pub fn ensure_ai(db: &Db) -> Result<(), String> {
    if status(db).ai {
        Ok(())
    } else {
        Err("问答模块已卸载".to_string())
    }
}

pub fn ensure_voice(db: &Db) -> Result<(), String> {
    if status(db).voice {
        Ok(())
    } else {
        Err("语音模块已卸载".to_string())
    }
}

/// 卸载后的目标安装态：卸载问答连带卸载语音；单独卸载语音时问答保持不变。
fn after_uninstall(current: ModuleStatus, module: ModuleId) -> ModuleStatus {
    match module {
        ModuleId::Ai => ModuleStatus {
            ai: false,
            voice: false,
        },
        ModuleId::Voice => ModuleStatus {
            ai: current.ai,
            voice: false,
        },
    }
}

/// 重新安装后的目标安装态：重装问答不自动重装语音；问答未安装时不能重装语音。
fn after_install(current: ModuleStatus, module: ModuleId) -> Result<ModuleStatus, String> {
    match module {
        ModuleId::Ai => Ok(ModuleStatus {
            ai: true,
            voice: current.voice,
        }),
        ModuleId::Voice if !current.ai => Err("请先重新安装问答".to_string()),
        ModuleId::Voice => Ok(ModuleStatus {
            ai: true,
            voice: true,
        }),
    }
}

fn publish(app: &AppHandle, db: &Db) -> ModuleStatus {
    let next = status(db);
    if let Err(error) = app.emit(MODULES_CHANGED_EVENT, next) {
        tracing::warn!("[modules] 广播模块安装态失败：{error}");
    }
    next
}

/// 按当前安装态重建问答入口：`toggle_ai` 全局热键是否注册、托盘是否含「AI 助手」。
fn refresh_entry_points(app: &AppHandle, db: &Db) -> Result<(), String> {
    for result in crate::hotkeys::apply(app, db) {
        if !result.ok {
            tracing::warn!(
                "[modules] 重新注册热键 {} 失败：{}",
                result.action,
                result.error.as_deref().unwrap_or("?")
            );
        }
    }
    crate::refresh_tray_menu(app, status(db).ai)
        .map_err(|error| format!("更新托盘菜单失败：{error}"))
}

/// 卸载语音：停止监听 → 删除全部模型 → 写安装态。删除失败时不写安装态，界面保持已安装。
fn uninstall_voice(app: &AppHandle, db: &Db) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if state.manual_recording.load(Ordering::SeqCst) {
        return Err("正在语音输入，请结束后再卸载".to_string());
    }
    // 占住下载槽：卸载期间不能开始新的模型下载，避免与删除目录并发。
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("语音模型正在下载，请等下载结束后再卸载".to_string());
    }
    let was_listening = state.listening.load(Ordering::SeqCst);
    let result = (|| {
        crate::voice::stop_listening_inner(state.inner());
        crate::voice::remove_models(app)?;
        db.setting_set(VOICE_INSTALLED_KEY, "false")
    })();
    state.downloading.store(false, Ordering::SeqCst);
    if result.is_err() && was_listening {
        // 卸载失败、语音仍算已安装：恢复卸载前的唤醒监听（审查 #4）。
        // 模型若已被删掉一部分，这里会失败并记录，界面的错误文案提示用户重新下载。
        if let Err(error) = crate::voice::start_listening_inner(app, state.inner()) {
            tracing::warn!("[modules] 卸载语音失败后恢复唤醒监听失败：{error}");
        }
    }
    result
}

/// 卸载问答：写安装态后隐藏 AI 面板并重建入口；任一步失败回滚安装态并按原状重建入口。
fn uninstall_ai(app: &AppHandle, db: &Db) -> Result<(), String> {
    db.setting_set(AI_INSTALLED_KEY, "false")?;
    let result =
        crate::ai::hide_ai_palette(app.clone()).and_then(|()| refresh_entry_points(app, db));
    if let Err(error) = result {
        let _ = db.setting_set(AI_INSTALLED_KEY, "true");
        let _ = refresh_entry_points(app, db);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn module_status(db: State<'_, Db>) -> ModuleStatus {
    status(db.inner())
}

/// 卸载模块（`module` = "ai" | "voice"）。卸载问答连带卸载语音。
///
/// 必须是 async 命令：重建入口会调用 `hotkeys::apply`，它在 sync 命令里会与主线程互等。
/// 先执行唯一不可逆的语音模型删除；它失败时问答保持原状。
#[tauri::command]
pub async fn module_uninstall(
    app: AppHandle,
    db: State<'_, Db>,
    module: String,
) -> Result<ModuleStatus, String> {
    let module = ModuleId::parse(&module)?;
    let current = status(db.inner());
    let target = after_uninstall(current, module);
    if current.voice && !target.voice {
        uninstall_voice(&app, db.inner())?;
    }
    if current.ai && !target.ai {
        if let Err(error) = uninstall_ai(&app, db.inner()) {
            publish(&app, db.inner());
            return Err(error);
        }
    }
    Ok(publish(&app, db.inner()))
}

/// 重新安装模块。语音模型不随安装下载，回到语音页按原流程下载。
#[tauri::command]
pub async fn module_install(
    app: AppHandle,
    db: State<'_, Db>,
    module: String,
) -> Result<ModuleStatus, String> {
    let module = ModuleId::parse(&module)?;
    let current = status(db.inner());
    let target = after_install(current, module)?;
    if !current.ai && target.ai {
        db.setting_set(AI_INSTALLED_KEY, "true")?;
        if let Err(error) = refresh_entry_points(&app, db.inner()) {
            let _ = db.setting_set(AI_INSTALLED_KEY, "false");
            let _ = refresh_entry_points(&app, db.inner());
            return Err(error);
        }
    }
    if !current.voice && target.voice {
        db.setting_set(VOICE_INSTALLED_KEY, "true")?;
    }
    Ok(publish(&app, db.inner()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn db() -> Db {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        Db(Mutex::new(conn))
    }

    const ALL: ModuleStatus = ModuleStatus {
        ai: true,
        voice: true,
    };
    const NONE: ModuleStatus = ModuleStatus {
        ai: false,
        voice: false,
    };
    const AI_ONLY: ModuleStatus = ModuleStatus {
        ai: true,
        voice: false,
    };

    #[test]
    fn missing_keys_mean_installed_so_upgrades_are_unchanged() {
        let db = db();
        assert_eq!(status(&db), ALL);
        assert!(ensure_ai(&db).is_ok());
        assert!(ensure_voice(&db).is_ok());
    }

    #[test]
    fn only_a_literal_false_uninstalls() {
        assert!(parse_installed(None));
        assert!(parse_installed(Some("true")));
        assert!(parse_installed(Some("garbage")));
        assert!(!parse_installed(Some("false")));
        assert!(!parse_installed(Some(" false ")));
    }

    #[test]
    fn voice_is_never_effective_without_ai() {
        let db = db();
        db.setting_set(AI_INSTALLED_KEY, "false").unwrap();
        assert_eq!(status(&db), NONE);
        assert_eq!(ensure_ai(&db).unwrap_err(), "问答模块已卸载");
        assert_eq!(ensure_voice(&db).unwrap_err(), "语音模块已卸载");
    }

    #[test]
    fn voice_can_be_uninstalled_alone() {
        let db = db();
        db.setting_set(VOICE_INSTALLED_KEY, "false").unwrap();
        assert_eq!(status(&db), AI_ONLY);
        assert!(ensure_ai(&db).is_ok());
        assert!(ensure_voice(&db).is_err());
    }

    #[test]
    fn uninstalling_ai_cascades_to_voice_but_voice_alone_keeps_ai() {
        assert_eq!(after_uninstall(ALL, ModuleId::Ai), NONE);
        assert_eq!(after_uninstall(ALL, ModuleId::Voice), AI_ONLY);
        assert_eq!(after_uninstall(AI_ONLY, ModuleId::Ai), NONE);
    }

    #[test]
    fn reinstalling_ai_leaves_voice_off_and_voice_requires_ai() {
        assert_eq!(after_install(NONE, ModuleId::Ai).unwrap(), AI_ONLY);
        assert_eq!(
            after_install(NONE, ModuleId::Voice).unwrap_err(),
            "请先重新安装问答"
        );
        assert_eq!(after_install(AI_ONLY, ModuleId::Voice).unwrap(), ALL);
        assert_eq!(after_install(ALL, ModuleId::Ai).unwrap(), ALL);
    }

    #[test]
    fn module_ids_parse_strictly() {
        assert_eq!(ModuleId::parse("ai").unwrap(), ModuleId::Ai);
        assert_eq!(ModuleId::parse("voice").unwrap(), ModuleId::Voice);
        assert!(ModuleId::parse("plugin").is_err());
        assert!(ModuleId::parse("").is_err());
    }
}
