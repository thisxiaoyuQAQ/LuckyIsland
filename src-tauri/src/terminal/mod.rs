use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

/// 一个终端 tab 的服务端状态
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
}

pub struct TerminalRegistry(pub Arc<Mutex<HashMap<String, PtyHandle>>>);

impl TerminalRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

/// 退出时杀掉所有子进程，避免僵尸
pub fn cleanup_all(reg: &TerminalRegistry) {
    if let Ok(mut g) = reg.0.lock() {
        for (_, h) in g.iter_mut() {
            if let Some(c) = h.child.as_mut() {
                let _ = c.kill();
            }
        }
        g.clear();
    }
}

#[derive(Serialize, Clone)]
struct TermOutput {
    term_id: String,
    data: String,
}

/// 默认 shell：PowerShell 7（标准安装路径）→ Windows PowerShell → cmd
fn default_shell() -> CommandBuilder {
    let prog = [r"C:\Program Files\PowerShell\7\pwsh.exe"]
        .iter()
        .find(|p| Path::new(p).exists())
        .map(|p| p.to_string())
        .unwrap_or_else(|| "powershell.exe".to_string());
    let mut cmd = CommandBuilder::new(prog);
    // 让 PowerShell 用 UTF-8 输出，配合前端 xterm 的 UTF-8 解码
    cmd.env("PYTHONUTF8", "1");
    cmd
}

/// 创建一个终端：开 PTY、spawn shell、起后台读线程推 term://output
#[tauri::command]
pub fn term_create(
    app: AppHandle,
    cwd: Option<String>,
    shell: Option<String>,
    command: Option<String>,
    registry: State<'_, TerminalRegistry>,
) -> Result<String, String> {
    let term_id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = match &shell {
        Some(s) => CommandBuilder::new(s),
        None => default_shell(),
    };
    if let Some(c) = cwd.as_deref() {
        cmd.cwd(c);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave); // 释放 slave，子进程由 child 持有

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 快捷命令：spawn 后把命令写入 PTY（PTY 输入缓冲会排队等 shell 就绪）
    if let Some(command) = command.as_deref() {
        let _ = writer.write_all(format!("{command}\r\n").as_bytes());
        let _ = writer.flush();
    }

    // 后台线程：读 PTY 输出，流式 UTF-8 解码（避免 CJK 跨块截断），emit term://output
    let app2 = app.clone();
    let id2 = term_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut leftover: Vec<u8> = Vec::new();
        let mut first_read = true; // 【临时诊断】标记 PTY 是否产出过数据
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            leftover.extend_from_slice(&buf[..n]);
            if first_read {
                first_read = false;
                let _ = app2.emit(
                    "term://output",
                    TermOutput {
                        term_id: id2.clone(),
                        data: "\x1b[33m[诊断: PTY 首次收到数据]\x1b[0m\r\n".into(),
                    },
                );
            }
            loop {
                match std::str::from_utf8(&leftover) {
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&leftover).into_owned();
                        let _ = app2.emit("term://output", TermOutput { term_id: id2.clone(), data: text });
                        leftover.clear();
                        break;
                    }
                    Err(e) => {
                        let valid = e.valid_up_to();
                        if valid > 0 {
                            let text = std::str::from_utf8(&leftover[..valid]).unwrap().to_string();
                            let _ = app2.emit("term://output", TermOutput { term_id: id2.clone(), data: text });
                            leftover.drain(..valid);
                        }
                        match e.error_len() {
                            Some(_) => { leftover.drain(..1); } // 丢弃 1 个无效字节，继续
                            None => break, // 尾部是不完整的多字节序列，等下次
                        }
                    }
                }
            }
        }
        let _ = app2.emit("term://exited", id2.clone());
    });

    let handle = PtyHandle {
        master: pair.master,
        writer,
        child: Some(child),
    };
    registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(term_id.clone(), handle);
    Ok(term_id)
}

#[tauri::command]
pub fn term_write(
    term_id: String,
    data: String,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let mut guard = registry.0.lock().map_err(|e| e.to_string())?;
    let Some(handle) = guard.get_mut(&term_id) else {
        return Ok(());
    };
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn term_resize(
    term_id: String,
    cols: u16,
    rows: u16,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let guard = registry.0.lock().map_err(|e| e.to_string())?;
    let Some(handle) = guard.get(&term_id) else {
        return Ok(());
    };
    handle
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn term_kill(term_id: String, registry: State<'_, TerminalRegistry>) -> Result<(), String> {
    let mut guard = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = guard.remove(&term_id) {
        if let Some(c) = handle.child.as_mut() {
            let _ = c.kill();
        }
    }
    Ok(())
}

/// 在外部 Windows Terminal 打开（spawn wt.exe -d <cwd>）
#[tauri::command]
pub fn term_open_wt(cwd: Option<String>) -> Result<(), String> {
    let mut cmd = std::process::Command::new("wt.exe");
    if let Some(c) = cwd.as_deref() {
        cmd.arg("-d").arg(c);
    }
    cmd.spawn()
        .map_err(|e| format!("打开 Windows Terminal 失败：{e}（是否已安装？）"))?;
    Ok(())
}

/// 【临时诊断】前端注册监听后调用，验证 Rust→前端 事件桥是否通
#[tauri::command]
pub fn term_test_emit(app: AppHandle, term_id: String) -> Result<(), String> {
    let _ = app.emit(
        "term://output",
        TermOutput {
            term_id,
            data: "\x1b[32m[诊断: Rust→前端 桥接 OK]\x1b[0m\r\n".into(),
        },
    );
    Ok(())
}
