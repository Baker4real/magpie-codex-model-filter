---
title: Codex 模型过滤
type: readme
status: verified-local
owner: magpie-codex-model-filter
intent: 在 Magpie 设置里勾选要从 Codex 模型选择器隐藏的 Codex 原生模型
tags:
  - magpie
  - codex
  - model-filter
---

# Codex 模型过滤（Magpie 插件）

在 Magpie 的 **设置 › 插件** 里列出 Codex 账号的原生模型，勾选的模型不会出现在
Codex 桌面版的模型选择器里。改动通过 Magpie 官方 CLI（`magpie provider models codex`）
写进 Magpie 自己的 Codex 供应商设置。插件不直接编辑 `magpie-desktop-models.json`，
不改 Codex 的 `config.toml`，也不用会连带第三方同名模型的全局禁用列表。

## 使用

前置条件：Magpie `0.1.3213` 或更新版本（本机在 `0.1.3216` 上验证），且 Codex 供应商已在 Magpie 里打开。

1. 在 Magpie 的插件页添加本目录 `D:\agents\projects\magpie-codex-model-filter`。
2. 打开 **设置 › 插件 › Codex 模型过滤**。面板列出 Codex 账号的全部模型，勾选表示当前隐藏。
3. 勾选或取消后点 **应用**；勾选与 Magpie 当前设置一致时「应用」是灰的。**刷新** 重新读取 Magpie 的设置。
4. 应用后重新打开 Codex 的模型选择器查看变化。

插件行里的 JSON 选项只剩两项，一般不用改：

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `magpiePath` | `D:/Apps/magpie/magpie.exe` | Magpie 可执行文件；写 `magpie` 则从 PATH 查找 |
| `port` | `3477` | 本地服务端口（1024–65535） |

0.1.x 的 `hiddenModels` 选项不再使用：隐藏哪些模型以 Magpie 的 Codex 供应商设置为准，
面板每次打开都从那里读取。

## 「应用」做了什么

面板把勾选结果交给本地服务，服务按目标状态选一条官方命令：

- 全部勾选：`magpie provider models codex none`，不提供任何 Codex 原生模型。
- 全部取消：`magpie provider models codex all`，回到 Magpie 的默认；如果默认列表比账号的
  模型少（例如套用了预设），再写入完整的模型列表。
- 勾选一部分：`magpie provider models codex <要显示的全部模型>`，写入显式列表。之后 Codex
  账号新出的模型不在列表里，默认隐藏，在面板里取消勾选才会出现。

写入后服务重新读取 Magpie 的设置逐个核对，不一致就报「应用失败」并列出模型。然后读取
Codex 的模型目录 `magpie-desktop-models.json`（在 `CODEX_HOME`，默认 `~/.codex`），
看 Codex 那边是否已经同步：

| 面板提示 | 含义 |
| --- | --- |
| 已应用 | 目录已同步，重新打开 Codex 的模型选择器即可 |
| 已应用，Codex 目录待同步 | Magpie 已保存，目录还没重建；重启 Magpie 后再打开模型选择器 |
| 没找到 Codex 的模型目录文件 | Codex 可能没有接入 Magpie，无法确认 Codex 端的显示 |
| 读不了 Codex 的模型目录 | 目录文件存在，但读取或解析失败 |

Codex 供应商被关闭，或 Magpie 输出的模型列表被截断（隐藏模型超过 8 个时 CLI 只列出一部分）
时，面板只说明原因，不读也不写。

## 结构

- `panel/`：Magpie 在设置 › 插件里加载的面板（`magpie.panels`，slot `settings`）。Magpie
  面板的沙箱 CSP 是 `connect-src 'none'`，所以面板进入视野后把自己的 frame 导航到本地服务
  页面 `http://127.0.0.1:<port>/`。
- `lib/page.mjs`：本地服务页面，也就是模型列表本身。它用 Magpie 页面桥接的同一套消息
  （`size`、`theme`）告诉窗口自身高度、接收主题。frame 仍在沙箱里，请求来自 opaque origin
  （`Origin: null`），服务按 CORS 应答。
- `lib/service.mjs`：插件 `main` 启动的 Bun 服务，只监听 `127.0.0.1`，提供 `GET /`、
  `GET /api/state`、`POST /api/apply`、`GET /api/health`。
- `lib/cli.mjs`：用参数数组（不经 shell）运行 Magpie CLI。
- `lib/plan.mjs`、`lib/catalog.mjs`、`lib/config.mjs`：应用计划、目录核对、选项校验。
- `lib/status.mjs`：`status` 与 `reload` 用的查询（插件登记、Magpie 版本、服务健康、本插件日志）
  和重载等待；`lib/preview.mjs`：`preview` 的本地服务与假的 Codex 供应商。

每条 Magpie CLI 命令都会另起一个插件 host，它也会尝试监听同一端口。服务遇到端口占用时在
后台重试 20 次（约 10 秒），仍占用就写日志放弃，不让 host 启动失败。

Node 或 Bun 应通过参数数组直接启动 Magpie 的 GUI exe 并接管 stdout/stderr。在交互式
PowerShell 里用 `&` 调用 GUI 子系统程序不会等它退出，也拿不到 CLI 文本；手动运行 CLI 用同目录的
`magpie.com`。

## 安全

- 服务只接受 Host 为 `127.0.0.1:<port>` 或 `localhost:<port>` 的请求，拒绝跨站来源。
- `/api/state` 和 `/api/apply` 要求服务每次启动时随机生成、嵌在页面里的令牌；预检（OPTIONS）
  只回 CORS 头，不碰 Magpie。
- 只运行 `magpie providers`、`magpie provider models codex` 及其 `none`、`all` 或显式列表；
  `magpie providers` 的输出含账号信息，出错时不转发。
- 不读取或保存账号、Cookie、登录令牌、API 密钥，也不需要 Magpie 管理 API。
- 只有点「应用」才写入，同一时间只允许一次应用，没有后台自动修改。
- 禁用或卸载插件不会恢复模型设置；需要恢复时，先在面板里全部取消勾选并应用，再卸载。

## 验证

```powershell
npm run check
npm run check -- -TestFile test/service.test.mjs
npm run status
npm run reload
npm run preview
```

`check` 检查 JavaScript 语法、运行 Node 测试、用 Magpie 的 Bun 运行时跑冒烟测试，最后做
OKF lint；`-TestFile` 只跑一个测试文件，`MAGPIE_BUN` 可指定 Bun 路径（默认
`D:/Codex/.cache/magpie/bun/1.4.4/magpie-bun.exe`）。

`status` 输出本插件的 `spec`、`off`、`loaded`、`port`，Magpie 版本（`magpie`），本地服务
`/api/health` 的结果（`service`），以及 Magpie 日志里带 `[codex-model-filter]` 的最近 8 行
（`log`）；`magpie plugin --json` 里的供应商、账号、模型等字段和日志的其他行都不转发。`off` 是
「已注册但未加载」的推导值，加载失败也会显示为 off，以 Magpie 界面的开关为准。服务在不在听以
`service` 为准：`Get-NetTCPConnection -State Listen` 列不出 Bun 的监听。Magpie 一直开着日志
写入，PowerShell 的 `[IO.File]::ReadAllLines` 会报占用，`status` 用 Node 的共享读取。
`MAGPIE_EXE` 可指定 Magpie。

`reload` 把插件当前的选项原样写回（`magpie plugin options <spec> <json>`）。Magpie 每次写选项
都会重启整个插件 host，所有插件随之重新加载；脚本等到端口上的页面换成新令牌、并且连续几次
不变，再查 `/api/health`，没换上新进程时退出 1。插件在 Magpie 里关着时不写。

`preview` 在 127.0.0.1 的空闲端口（`npm run preview -- --port <n>` 可指定）起同一个页面和服务，
Codex 供应商换成假数据（三个模型，全部隐藏），并像 Magpie 窗口那样回应面板的主题请求（Magpie
0.1.3216 的配色，`?theme=dark` 换深色）。面板里的「应用」只改假数据。页面直接在顶层打开：
Claude 桌面版的浏览器面板会拦下页面里的 iframe。

`test/invoke-sandbox.ps1` 只在调用者提供的隔离 HOME（必须含 `.codex` 目录）里添加和读取
插件，不用于正式配置。

参考：Magpie 仓库的
[docs/subsystems/plugin-runtime.md](https://github.com/yetone/magpie/blob/main/docs/subsystems/plugin-runtime.md)、
[docs/reference.md](https://github.com/yetone/magpie/blob/main/docs/reference.md)、
[Codex 原生模型过滤源码](https://github.com/yetone/magpie/blob/main/internal/provider/codex_models.go)。
Magpie 更新频繁，按已安装版本取原文的命令见 `AGENTS.md`「Magpie 上游」。
