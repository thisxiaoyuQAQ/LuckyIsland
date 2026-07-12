use std::{process::Stdio, time::Duration};

use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

use super::types::{ProviderError, AI_REQUEST_TIMEOUT};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const PROCESS_STOP_TIMEOUT: Duration = Duration::from_secs(3);

pub struct ProcessOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub async fn run(
    command: Command,
    label: &str,
    token: CancellationToken,
) -> Result<ProcessOutput, ProviderError> {
    run_inner(command, label, None, token).await
}

pub async fn run_with_stdin(
    command: Command,
    label: &str,
    stdin: &[u8],
    token: CancellationToken,
) -> Result<ProcessOutput, ProviderError> {
    run_inner(command, label, Some(stdin), token).await
}

async fn run_inner(
    mut command: Command,
    label: &str,
    stdin: Option<&[u8]>,
    token: CancellationToken,
) -> Result<ProcessOutput, ProviderError> {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    command.kill_on_drop(true);
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| ProviderError::Failed(format!("{label} 启动失败：{error}")))?;
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProviderError::Failed(format!("{label} stdout 不可用")))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProviderError::Failed(format!("{label} stderr 不可用")))?;
    let stdout_task = tokio::spawn(read_all(stdout));
    let stderr_task = tokio::spawn(read_all(stderr));

    enum Exit {
        Done(Result<std::process::ExitStatus, ProviderError>),
        Cancelled,
        Timeout,
    }

    let exit = {
        let wait_for_exit = async {
            if let Some(input) = stdin {
                let mut child_stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| ProviderError::Failed(format!("{label} stdin 不可用")))?;
                child_stdin.write_all(input).await.map_err(|error| {
                    ProviderError::Failed(format!("{label} stdin 写入失败：{error}"))
                })?;
                child_stdin.shutdown().await.map_err(|error| {
                    ProviderError::Failed(format!("{label} stdin 关闭失败：{error}"))
                })?;
                drop(child_stdin);
            }
            child
                .wait()
                .await
                .map_err(|error| ProviderError::Failed(format!("{label} 等待失败：{error}")))
        };
        tokio::pin!(wait_for_exit);
        tokio::select! {
            biased;
            _ = token.cancelled() => Exit::Cancelled,
            status = &mut wait_for_exit => Exit::Done(status),
            _ = tokio::time::sleep(AI_REQUEST_TIMEOUT) => Exit::Timeout,
        }
    };

    match exit {
        Exit::Done(Ok(status)) => Ok(ProcessOutput {
            success: status.success(),
            stdout: join_reader(stdout_task, label, "stdout").await?,
            stderr: join_reader(stderr_task, label, "stderr").await?,
        }),
        Exit::Done(Err(error)) => {
            terminate_tree(&mut child, pid).await;
            let _ = join_reader(stdout_task, label, "stdout").await;
            let _ = join_reader(stderr_task, label, "stderr").await;
            Err(error)
        }
        Exit::Cancelled => {
            terminate_tree(&mut child, pid).await;
            let _ = join_reader(stdout_task, label, "stdout").await;
            let _ = join_reader(stderr_task, label, "stderr").await;
            Err(ProviderError::Cancelled)
        }
        Exit::Timeout => {
            terminate_tree(&mut child, pid).await;
            let _ = join_reader(stdout_task, label, "stdout").await;
            let _ = join_reader(stderr_task, label, "stderr").await;
            Err(ProviderError::Timeout)
        }
    }
}

async fn read_all(mut reader: impl AsyncRead + Unpin) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::new();
    reader.read_to_end(&mut output).await?;
    Ok(output)
}

async fn join_reader(
    task: JoinHandle<std::io::Result<Vec<u8>>>,
    label: &str,
    stream: &str,
) -> Result<Vec<u8>, ProviderError> {
    task.await
        .map_err(|error| ProviderError::Failed(format!("{label} {stream} 读取任务异常：{error}")))?
        .map_err(|error| ProviderError::Failed(format!("{label} {stream} 读取失败：{error}")))
}

#[cfg(windows)]
async fn terminate_tree(child: &mut Child, pid: Option<u32>) {
    if let Some(pid) = pid {
        let mut taskkill = Command::new("taskkill.exe");
        taskkill
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = tokio::time::timeout(PROCESS_STOP_TIMEOUT, taskkill.status()).await;
    }

    if tokio::time::timeout(PROCESS_STOP_TIMEOUT, child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

#[cfg(not(windows))]
async fn terminate_tree(child: &mut Child, _pid: Option<u32>) {
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn cancelled_process_returns_cancelled() {
        let token = CancellationToken::new();
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/C", "ping 127.0.0.1 -n 30 >nul"]);
        let cancel = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            cancel.cancel();
        });

        let result = run(command, "test process", token).await;
        assert!(matches!(result, Err(ProviderError::Cancelled)));
    }
}
