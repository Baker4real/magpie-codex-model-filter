# Codex 模型过滤

本目录是 Magpie 设置面板插件：通过官方 Codex 供应商模型设置控制桌面模型选择器，不直接编辑模型目录或 Codex 配置。

## 运行与验证

- 使用方式、安装、恢复与安全边界见 `README.md`。
- 完整验证：`npm run check`。改了插件代码后用 `npm run reload` 让运行中的 Magpie 换上新代码，`npm run status` 看 Magpie 版本、服务健康和本插件日志；看界面用 `npm run preview`（假数据，在浏览器面板里打开），不在真实设置面板里点。
- `test/invoke-sandbox.ps1 -SandboxRoot <隔离目录>` 只用于含 `.codex` 子目录的隔离 HOME。
- 收尾检查只读回读，不在真实 Magpie 里点「应用」；普通代码与文档改动不需要重新应用真实模型设置。
- Codex 和 Claude 常同时改本目录：收尾汇报前跑 `git status --short`，把不是本会话改的文件点名列出，提交只带自己的文件。

## Magpie 上游

Magpie 一天自动更新多次，插件 API 以已安装版本的仓库原文为准，版本号用 `npm run status` 输出的 `magpie`：

```powershell
gh api -H 'Accept: application/vnd.github.raw' "repos/yetone/magpie/contents/<路径>?ref=v<版本>"
```

取回后用 `rg -n` 定位，只读相关段落。usemagpie.ai 的文档页经 WebFetch 要等几分钟，拿到的还是改写摘要。常用路径：`docs/reference.md`（manifest 与 CLI）、`docs/subsystems/plugin-runtime.md`（plugin host 与 panels）、`docs/subsystems/gui-shell.md`、`internal/gui/pluginpage.go`（面板 frame 与 CSP）、`internal/cli/plugins_cli.go`（`plugin options` 与 host 重启）。

## 技术栈与目录

- 零 npm 依赖；Bun 插件服务、Node 测试、PowerShell 验证脚本。
- `panel/` 是 Magpie 设置入口，`lib/` 是本地页面、CLI、计划、目录验收、状态与预览，`test/` 是隔离测试。
- 状态输出只保留白名单字段，避免传播 Magpie 返回的账号等无关信息。
