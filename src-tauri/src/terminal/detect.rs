//! 05a：检测本机已安装的常见 shell（Nushell / Git Bash / WSL 发行版）。
//!
//! 判定逻辑 `detect_with` 是纯函数：文件存在判断、PATH 查找和 WSL 发行版列表由调用方注入，
//! 便于单测。真实环境由 `detect_installed` 组装；WSL 发行版读注册表，不启动 wsl.exe，
//! 避免拉起 WSL 服务或卡住。只检测不写设置，去重与写入由前端完成。

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DetectedShell {
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

/// 检测所需的外部环境（测试时注入假实现）
pub struct DetectEnv<'a> {
    /// `%ProgramFiles%`
    pub program_files: Option<PathBuf>,
    /// `%LOCALAPPDATA%`
    pub local_app_data: Option<PathBuf>,
    /// 文件是否存在
    pub exists: &'a dyn Fn(&Path) -> bool,
    /// 在 PATH 中查找可执行文件（传入带扩展名的文件名）
    pub which: &'a dyn Fn(&str) -> Option<PathBuf>,
    /// `System32\wsl.exe`（存在时）
    pub wsl_program: Option<PathBuf>,
    /// 已注册的 WSL 发行版名称
    pub wsl_distros: Vec<String>,
}

/// Docker Desktop / Rancher Desktop 注册的内部发行版不是可交互 shell
fn is_internal_distro(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("docker-desktop") || lower.starts_with("rancher-desktop")
}

fn first_existing(env: &DetectEnv, candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates
        .iter()
        .flatten()
        .find(|p| (env.exists)(p))
        .cloned()
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// 按固定顺序给出检测结果：Nushell → Git Bash → WSL 各发行版
pub fn detect_with(env: &DetectEnv) -> Vec<DetectedShell> {
    let mut out = Vec::new();
    let pf = env.program_files.as_deref();
    let lad = env.local_app_data.as_deref();

    let nu = (env.which)("nu.exe").or_else(|| {
        first_existing(
            env,
            &[
                pf.map(|p| p.join(r"nu\bin\nu.exe")),
                lad.map(|p| p.join(r"Programs\nu\bin\nu.exe")),
            ],
        )
    });
    if let Some(p) = nu {
        out.push(DetectedShell {
            name: "Nushell".into(),
            program: path_string(&p),
            args: Vec::new(),
        });
    }

    // 只认 Git for Windows 的 bin\bash.exe（会设置 MSYS 环境）；System32\bash.exe 是 WSL 旧入口
    let bash = first_existing(
        env,
        &[
            pf.map(|p| p.join(r"Git\bin\bash.exe")),
            lad.map(|p| p.join(r"Programs\Git\bin\bash.exe")),
        ],
    );
    if let Some(p) = bash {
        out.push(DetectedShell {
            name: "Git Bash".into(),
            program: path_string(&p),
            args: vec!["--login".into(), "-i".into()],
        });
    }

    if let Some(wsl) = env.wsl_program.as_deref() {
        for distro in &env.wsl_distros {
            let distro = distro.trim();
            if distro.is_empty() || is_internal_distro(distro) {
                continue;
            }
            out.push(DetectedShell {
                name: format!("WSL: {distro}"),
                program: path_string(wsl),
                args: vec!["-d".into(), distro.to_string()],
            });
        }
    }
    out
}

fn which_in_path(file_name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(file_name))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        RRF_RT_REG_SZ,
    };

    let mut out = Vec::new();
    let mut key = HKEY::default();
    let opened = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Lxss"),
            Some(0),
            KEY_READ,
            &mut key,
        )
    };
    if opened != ERROR_SUCCESS {
        return out; // 未安装 WSL 或没有任何发行版
    }

    for index in 0u32.. {
        // 子键名是发行版 GUID（38 字符），256 足够
        let mut sub_name = [0u16; 256];
        let mut sub_len = sub_name.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key,
                index,
                Some(PWSTR(sub_name.as_mut_ptr())),
                &mut sub_len,
                None,
                None,
                None,
                None,
            )
        };
        if status != ERROR_SUCCESS {
            break; // ERROR_NO_MORE_ITEMS 或读取失败
        }
        let mut sub_key: Vec<u16> = sub_name[..sub_len as usize].to_vec();
        sub_key.push(0);

        let mut data = [0u16; 512];
        let mut size = std::mem::size_of_val(&data) as u32;
        let status = unsafe {
            RegGetValueW(
                key,
                PCWSTR(sub_key.as_ptr()),
                w!("DistributionName"),
                RRF_RT_REG_SZ,
                None,
                Some(data.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS {
            continue;
        }
        let chars = (size as usize / 2).min(data.len());
        let name = String::from_utf16_lossy(&data[..chars]);
        let name = name.trim_end_matches('\0').trim();
        if !name.is_empty() {
            out.push(name.to_string());
        }
    }

    unsafe {
        let _ = RegCloseKey(key);
    }
    out
}

#[cfg(not(windows))]
fn wsl_distros() -> Vec<String> {
    Vec::new()
}

/// 用真实环境检测
pub fn detect_installed() -> Vec<DetectedShell> {
    let exists = |p: &Path| p.is_file();
    let which = |name: &str| which_in_path(name);
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let wsl = system_root.join(r"System32\wsl.exe");
    let wsl_program = exists(&wsl).then_some(wsl);
    // 没有 wsl.exe 时不必读注册表
    let wsl_distros = if wsl_program.is_some() {
        wsl_distros()
    } else {
        Vec::new()
    };
    let env = DetectEnv {
        program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
        local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        exists: &exists,
        which: &which,
        wsl_program,
        wsl_distros,
    };
    detect_with(&env)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    struct Fake {
        files: HashSet<PathBuf>,
        path_hits: Vec<(String, PathBuf)>,
    }

    impl Fake {
        fn new(files: &[&str]) -> Self {
            Self {
                files: files.iter().map(PathBuf::from).collect(),
                path_hits: Vec::new(),
            }
        }
    }

    fn run(fake: &Fake, wsl: Option<&str>, distros: &[&str]) -> Vec<DetectedShell> {
        let exists = |p: &Path| fake.files.contains(p);
        let which = |name: &str| {
            fake.path_hits
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, p)| p.clone())
        };
        let env = DetectEnv {
            program_files: Some(PathBuf::from(r"C:\Program Files")),
            local_app_data: Some(PathBuf::from(r"C:\Users\u\AppData\Local")),
            exists: &exists,
            which: &which,
            wsl_program: wsl.map(PathBuf::from),
            wsl_distros: distros.iter().map(|s| s.to_string()).collect(),
        };
        detect_with(&env)
    }

    #[test]
    fn nothing_installed_returns_empty() {
        assert!(run(&Fake::new(&[]), None, &[]).is_empty());
    }

    #[test]
    fn nushell_prefers_path_over_fixed_locations() {
        let mut fake = Fake::new(&[r"C:\Program Files\nu\bin\nu.exe"]);
        fake.path_hits.push((
            "nu.exe".into(),
            PathBuf::from(r"C:\Users\u\scoop\shims\nu.exe"),
        ));
        let found = run(&fake, None, &[]);
        assert_eq!(
            found,
            vec![DetectedShell {
                name: "Nushell".into(),
                program: r"C:\Users\u\scoop\shims\nu.exe".into(),
                args: vec![],
            }]
        );
    }

    #[test]
    fn nushell_falls_back_to_program_files_then_local_app_data() {
        let found = run(&Fake::new(&[r"C:\Program Files\nu\bin\nu.exe"]), None, &[]);
        assert_eq!(found[0].program, r"C:\Program Files\nu\bin\nu.exe");

        let found = run(
            &Fake::new(&[r"C:\Users\u\AppData\Local\Programs\nu\bin\nu.exe"]),
            None,
            &[],
        );
        assert_eq!(
            found[0].program,
            r"C:\Users\u\AppData\Local\Programs\nu\bin\nu.exe"
        );
    }

    #[test]
    fn git_bash_uses_login_interactive_args_and_user_install_fallback() {
        let found = run(
            &Fake::new(&[r"C:\Program Files\Git\bin\bash.exe"]),
            None,
            &[],
        );
        assert_eq!(
            found,
            vec![DetectedShell {
                name: "Git Bash".into(),
                program: r"C:\Program Files\Git\bin\bash.exe".into(),
                args: vec!["--login".into(), "-i".into()],
            }]
        );

        let found = run(
            &Fake::new(&[r"C:\Users\u\AppData\Local\Programs\Git\bin\bash.exe"]),
            None,
            &[],
        );
        assert_eq!(
            found[0].program,
            r"C:\Users\u\AppData\Local\Programs\Git\bin\bash.exe"
        );
    }

    #[test]
    fn wsl_lists_each_distro_and_skips_internal_and_blank_ones() {
        let found = run(
            &Fake::new(&[]),
            Some(r"C:\Windows\System32\wsl.exe"),
            &[
                "Ubuntu-22.04",
                "docker-desktop",
                "Docker-Desktop-Data",
                "rancher-desktop",
                " ",
                "Debian",
            ],
        );
        assert_eq!(
            found,
            vec![
                DetectedShell {
                    name: "WSL: Ubuntu-22.04".into(),
                    program: r"C:\Windows\System32\wsl.exe".into(),
                    args: vec!["-d".into(), "Ubuntu-22.04".into()],
                },
                DetectedShell {
                    name: "WSL: Debian".into(),
                    program: r"C:\Windows\System32\wsl.exe".into(),
                    args: vec!["-d".into(), "Debian".into()],
                },
            ]
        );
    }

    #[test]
    fn wsl_distros_ignored_without_wsl_exe() {
        assert!(run(&Fake::new(&[]), None, &["Ubuntu"]).is_empty());
    }

    #[test]
    fn results_follow_fixed_order() {
        let fake = Fake::new(&[
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\nu\bin\nu.exe",
        ]);
        let names: Vec<String> = run(&fake, Some(r"C:\Windows\System32\wsl.exe"), &["Ubuntu"])
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["Nushell", "Git Bash", "WSL: Ubuntu"]);
    }
}
