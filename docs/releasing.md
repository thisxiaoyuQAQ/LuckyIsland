# LuckyIsland 稳定版本发布

LuckyIsland 的正式发布路径是 GitHub Actions。`scripts/release-local.ps1` 只用于 CI 故障或紧急维护，不能与 CI 同时发布同一版本。

## 签名密钥

Tauri updater 使用一对 minisign 密钥：

- 公钥提交在 `src-tauri/tauri.conf.json`，安装中的旧版本依靠它验证更新；
- 私钥只保存在维护者的仓库外安全位置和 GitHub Actions Secrets；
- 密码不得写入仓库、`.env`、日志、Artifact 或 Release。

GitHub 仓库需配置：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

私钥应做加密离线备份，并把恢复步骤保存在仓库外。丢失私钥后，已安装版本不能信任用另一把密钥签出的更新；公钥轮换需要独立迁移设计，不能直接替换配置。

## CI 主路径

`.github/workflows/release.yml` 只响应 `v*` tag：

1. 校验 tag 与 package/Cargo/Tauri 版本一致；
2. 运行前端、TypeScript、构建和 Rust 测试；
3. 构建 Windows x86_64 NSIS 与签名 updater 资产；
4. 创建 draft Release；
5. 下载并验证安装器、`.sig`、`latest.json`、稳定 tag URL 和 draft metadata；
6. 校验通过后才转为 published/latest；
7. 再次回读 published metadata 验证。

任一步失败都不会发布不完整的 stable Release。失败的 draft 应先调查，不应以手工上传缺失资产绕过验证。

发布前：

- `main` 必须包含目标版本；
- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处版本一致；
- tag 必须为对应的 `vX.Y.Z`；
- 两个 Secrets 已配置；
- 不要同时运行本机发布。

## 本机紧急备用

默认只做 dry-run：

```powershell
./scripts/release-local.ps1 -Tag v0.2.1
```

脚本拒绝非 Windows、非 `main`、脏工作树、tag 不在 HEAD、缺签名环境、版本不一致、测试失败或不完整资产。它会执行完整构建并打印预期 GitHub 操作，但不会写 GitHub。

真正发布是外部写操作，必须另行确认后才使用：

```powershell
./scripts/release-local.ps1 -Tag v0.2.1 -Publish
```

`-Publish` 仍采用 draft-first：本地资产预检 → 创建 draft → 重新下载 → 校验 draft → 发布 → 校验 published。已有同 tag Release 时拒绝覆盖。

## 信任和平台边界

- Tauri updater 签名认证更新来源和资产完整性，并阻止坏签名安装；不得提供绕过入口。
- updater 签名不等于 Windows Authenticode。没有代码签名证书时，SmartScreen 仍可能提示未知发布者。
- 发布失败不会修改已安装版本；不得删除现有稳定资产后原地替换。
- 同一版本不得由 CI 和本机路径并发发布。
- 回滚应发布更高版本号的修复版本；默认 updater 不允许静默降级。
