# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness Web UI 的打包 Electron 窗口。该 shell 将现有 `web` profile 作为子进程启动，等待 `dsh web:` 就绪行，然后加载该回环 URL。窗口无边框（`frame: false`）：36px 顶栏拖拽带加上侧栏 logo 行与会话 header 可拖拽窗口，shell 注入最小化／最大化／关闭。窗口与安装程序使用 [`icons/icon.svg`](icons/icon.svg) 中品牌蓝底上的 DeepSeek 鲸鱼标。

这是一个应用，不是新的能力族。Host、Client 与 web-app 插件仍留在原处；桌面包只拥有原生窗口和安装程序布局。[`dsh-host-webserver`](../../packages/host/webserver/README.md) 上记录的 `file://` 加 IPC 载体不是这个 shell。

## 运行

在已构建的检出目录中：

```sh
pnpm run build
pnpm dsh desktop
```

`dsh desktop` 是启动器别名：它用本包的 `lib/main.js` 启动 Electron，并转发剩余的 web 应用 flag。宿主始终收到 `--no-open`。调用方省略 `--port` 时，宿主向操作系统申请空闲端口。检出目录启动在 CLI 的 Node（`DSH_NODE_EXECUTABLE`）下运行 web 宿主。打包启动设置 `ELECTRON_RUN_AS_NODE=1`，让已部署的 `dsh` bin 按 Node 运行。窗口加载后，shell 查询 GitHub Releases 是否有更新的 `desktop-v*` 或 `dsh-v*` tag，并静默下载当前平台的安装程序（Windows NSIS `.exe`、macOS `.dmg` 或 Linux `.AppImage`）；仅在该文件已缓存后，对话框才请求安装授权。`--no-update-check` 跳过该查询。订阅源是 `DSH_DESKTOP_UPDATE_REPO`，或打包时从 `GITHUB_REPOSITORY` 或 `origin` 写入的 `update-feed.json`。

```sh
dsh desktop --port 8080
dsh desktop --patch ./extra.yml
dsh desktop --dump-config
dsh desktop --no-update-check
```

`--dump-config` 与 `--dump-default-config` 打印 web profile 配置树，不会启动 Electron。

## 打包

```sh
pnpm run desktop:pack
```

打包脚本把鲸鱼标栅格化为 `icons/icon.png`，将 `@deepseek-ai/dsh` 部署到 `runtime/`，然后为当前操作系统运行 electron-builder。Windows NSIS 安装程序默认进行全局（所有用户）安装，写入 Program Files，并请求提升权限。macOS 检出目录写出未签名的主机架构 DMG（Apple Silicon 为 `mac-arm64`，Intel 为 `mac-x64`）。Linux 检出目录写出主机架构 AppImage（CI 运行器为 `linux-x64`）。安装程序输出到 `release/`。[`Release (desktop)`](../../.github/workflows/desktop-release.yml) 在 `windows-2025` 上打包 Windows、在 `macos-15` 上打包 macOS、在 `ubuntu-24.04` 上打包 Linux，再把这些产物作为 `@<owner>/dsh-desktop` 发布到 GitHub Packages，同时挂到该 tag 的 GitHub Release（[发布](../../.agents/notes/implemented/process/2026-08-20-desktop-github-packages-release.md)）。从 `dsh-v<version>` 或 `desktop-v<version>` 触发工作流并将 `publish` 设为 `true`。

## 模型体验

无。该包是现有 Web UI 外的原生窗口；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **窗口加载回环 HTTP，而不是 `file://`** — 宿主仍会绑定本地 webserver。IPC 载体尚未交付。
- **源码启动需要已构建的 CLI 与前端产物** — `dsh desktop` 解析 `apps/cli/lib/bin.js` 以及宿主已经要求的 web dist。
- **原生安装程序不是 npmjs 产物** — `desktop:pack` 为当前操作系统写入 `release/`；GitHub Packages 与 GitHub Release 承载 Windows `.exe`、macOS `.dmg` 与 Linux `.AppImage`。macOS DMG 未签名（没有 Apple Developer 身份）。
- **更新安装需要授权** — 下载是静默的；只有用户选择 **Install** 后才会运行安装程序。检查失败或被跳过时，正在运行的窗口不变。
