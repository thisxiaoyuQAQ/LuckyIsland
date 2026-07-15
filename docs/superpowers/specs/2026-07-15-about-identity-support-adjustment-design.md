# 关于页身份与支持信息调整设计

> 日期：2026-07-15
> 状态：用户已批准
> 范围：模块 11 Task 9 收尾调整

## 目标

调整关于页公开身份与入口文案，不改变安全诊断和更新预留功能。

## 修改

- 页面作者由 `thisxiaoyuQAQ` 改为 `Zhi Yu`。
- `src-tauri/Cargo.toml` package authors 同步改为 `Zhi Yu`。
- 删除“许可证：MIT License”展示行。
- 替换为可点击官网信息：`官网：li.zyuo.cn`。
- 官网使用 Tauri opener 在系统浏览器打开 `https://li.zyuo.cn`。
- 保留 GitHub 仓库和反馈问题按钮。
- 在 GitHub 按钮区域上方加入温和文案：`如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。`
- 文案不弹窗、不闪烁、不使用强调动画。

## 保持不变

- 五行安全诊断内容与复制逻辑。
- 仓库和 Issue URL。
- 更新检查占位区域。
- 不读取或展示密钥、Token、用户名和私人路径。
- 不处理模块 10 的未跟踪文件。

## 验证

- TypeScript 和三入口构建通过。
- About Rust 测试和 cargo check 通过。
- 真机确认作者、官网跳转和 Star 文案显示。
- Task 9 文件独立提交后继续 Task 10。
