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
    output_buffer: Arc<Mutex<String>>,
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

fn push_output(app: &AppHandle, term_id: &str, output_buffer: &Arc<Mutex<String>>, data: String) {
    if let Ok(mut b) = output_buffer.lock() {
        b.push_str(&data);
        // 限制缓存，避免长期运行占内存。保留最后约 200KB 可见输出。
        const MAX: usize = 200_000;
        if b.len() > MAX {
            let mut drain_to = b.len() - MAX;
            while drain_to < b.len() && !b.is_char_boundary(drain_to) {
                drain_to += 1;
            }
            b.drain(..drain_to);
        }
    }
    let _ = app.emit(
        "term://output",
        TermOutput {
            term_id: term_id.to_string(),
            data,
        },
    );
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
    let output_buffer = Arc::new(Mutex::new(String::new()));

    // 快捷命令：spawn 后把命令写入 PTY（PTY 输入缓冲会排队等 shell 就绪）
    if let Some(command) = command.as_deref() {
        let _ = writer.write_all(format!("{command}\r\n").as_bytes());
        let _ = writer.flush();
    }

    // 后台线程：读 PTY 输出，流式 UTF-8 解码（避免 CJK 跨块截断），emit term://output
    let app2 = app.clone();
    let id2 = term_id.clone();
    let output_buffer2 = output_buffer.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut leftover: Vec<u8> = Vec::new();
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            leftover.extend_from_slice(&buf[..n]);
            loop {
                match std::str::from_utf8(&leftover) {
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&leftover).into_owned();
                        push_output(&app2, &id2, &output_buffer2, text);
                        leftover.clear();
                        break;
                    }
                    Err(e) => {
                        let valid = e.valid_up_to();
                        if valid > 0 {
                            let text = std::str::from_utf8(&leftover[..valid]).unwrap().to_string();
                            push_output(&app2, &id2, &output_buffer2, text);
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
        output_buffer,
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

/// 返回该终端已缓存输出。解决前端监听晚于 PTY 初始提示符导致输出丢失的问题。
#[tauri::command]
pub fn term_snapshot(term_id: String, registry: State<'_, TerminalRegistry>) -> Result<String, String> {
    let guard = registry.0.lock().map_err(|e| e.to_string())?;
    let Some(handle) = guard.get(&term_id) else {
        return Ok(String::new());
    };
    Ok(handle
        .output_buffer
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
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

