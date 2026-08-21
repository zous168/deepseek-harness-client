# Agent Note: 基于 web profile 的打包桌面窗口

Status: implemented

[English](2026-08-20-desktop-packaged-window.md) | 中文

## 问题

`dsh web` 在浏览器标签页中提供组装后的 GUI。这是正确的开发与局域网路径，但不是打包客户端：没有原生窗口、没有安装程序图标，也没有让产品离开默认浏览器的启动模式。若靠克隆 Host 或 Client 包组成 electron 族来增加桌面产品，会把同一组能力拆进两棵树。若在同一次变更中实现文档所述的 `file://` 加 IPC 载体，也会在窗口尚不存在时再发明一套传输。

## 决策

`dsh desktop` 启动 `@deepseek-ai/dsh-desktop`：这是一个 Electron 应用，将现有 `web` profile 作为子进程启动，并加载打印出的回环 URL。窗口标题为 `DeepSeek Harness`。窗口为 `frame: false`：没有操作系统标题栏。可拖的只有 Web chrome 主动标出的 `[data-dsh-app-drag]` 把手——会话标题簇与 header 工具之间的空 spacer、侧栏品牌与折叠控件之间的空 spacer、空白会话 header 条，以及启动页字标和它的顶栏条——不是整块 header、欢迎列或其他内容盒，也不是 `#root`（Windows 上祖先 `no-drag` 会吞掉子孙 `drag`）。启动页仍可见或页面尚未标出 chrome 把手时，shell 会注入一条 `#dsh-desktop-drag-fallback` 顶栏并标出启动页字标；chrome 把手出现后会撤掉该回退条。把手上的控件仍是 `no-drag`。Electron 命中 `-webkit-app-region` 时不看叠层绘制，因此打开 `[aria-modal="true"]`、`[role="dialog"]` 或 `body > [role="presentation"]` 树会关掉这些把手。设置面板与 `Modal` 一样挂到 `document.body`，侧栏 `overflow` 层叠就不会把对话框压在注入的窗口按钮簇下面。注入时会去掉残留的并列拖拽带。桌面壳通过沙箱 preload 注入最小化／最大化／关闭。会话 header 右侧控件（含 Session log）用 `header[class*="header"]` 的 padding 避开该按钮簇，以压过会话 header 的 class padding。边缘缩放仍由 `thickFrame` 处理。窗口与 electron-builder 图标使用 Web favicon 已经使用的 DeepSeek 鲸鱼标，以白色画在品牌蓝底 `#4D6BFE` 上，源文件位于 `apps/desktop/icons/icon.svg`，并栅格化为安装程序使用的 `icons/icon.png`。

桌面包是 `apps/` 中的应用，不是能力族。它不新增 Host 或 Client 插件。启动器别名接受与 `dsh web` 相同的 `--patch` 和 dump flag；剩余 token 交给 web 应用命令行。宿主始终收到 `--no-open`。调用方省略 `--port` 时，宿主收到 `--port 0`，避免两个窗口抢占 3080。

未打包的检出目录在启动器的真正 Node（`DSH_NODE_EXECUTABLE`）下启动 `apps/cli/lib/bin.js`。Win32 文件夹对话框 worker 在同一个 Node 下启动，让 IPC 保持为 Node 子进程，而不是第二个 Electron 应用。打包后的安装程序把 `@deepseek-ai/dsh` 部署到 `extraResources/runtime`，并以 `ELECTRON_RUN_AS_NODE=1` 启动 `runtime/lib/bin.js`。`pnpm run desktop:pack` 是本地与 [`Release (desktop)`](../../../../.github/workflows/desktop-release.yml) 共用的组装器；该工作流把 Windows 安装程序发布到 GitHub Packages（[发布](../process/2026-08-20-desktop-github-packages-release.md)）。NSIS 安装程序默认全局安装（`perMachine` 与 `selectPerMachineByDefault`），首页面向所有用户、写入 Program Files，并触发 Windows 提权。窗口加载后，若 GitHub Release 上有更新的 Windows 安装程序，shell 会静默下载并在安装前请求授权（[更新检查](2026-08-20-desktop-update-check.md)）。npmjs 上的 `@deepseek-ai/dsh-desktop` 包交付 Electron 主进程脚本、窗口 preload 和图标。

这并不实现 [GUI 分层](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 与 [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) 中描述的 `file://` 加 IPC 载体。浏览器安装元数据仍由 [Web 安装 manifest](2026-08-06-web-install-manifest.md) 负责。

## 曾考虑的替代方案

**在 `packages/` 下新建 electron 包族。** 不予采纳：产品共享 Host 与 Client 能力；新应用不需要任何新的能力包。GUI 分层 Note 已经否决过这一方案。

**通过 `file://` 加载 dist，并用 IPC 承载 fetch。** 不作为第一种打包模式：HTTP 宿主、浏览器信任栅栏、静态回退和 Client 启动 manifest 已在回环上工作。IPC 子类仍是未来载体，不是原生窗口的前提。

**把 PWA 安装 manifest 当作打包客户端。** 不予采纳：浏览器安装的快捷方式不是原生窗口或安装程序，也无法把 DeepSeek 应用图标交给操作系统。

**用自定义图标打开默认浏览器。** 不予采纳：标签页图标由操作系统浏览器持有；这条路径无法满足打包窗口请求。

**用 `titleBarOverlay` 保留原生标题栏按钮。** 不予采纳：那仍会画出 Windows 标题栏按钮簇。打包窗口使用 `frame: false`；桌面壳通过沙箱 preload 注入拖拽 CSS 和自己的窗口按钮，不新增 Client 插件。

## 后果

贡献者与用户可以在以 DeepSeek 鲸鱼标为图标的原生窗口中运行同一套 Web UI。宿主仍会绑定回环端口，因此桌面与 `dsh web` 共享信任、就绪信号，以及 GUI 的快照覆盖。窗口外壳由包测试钉住图标路径、就绪 URL 解析、宿主 argv，以及无边框 `BrowserWindow` 选项与注入的 `[data-dsh-app-drag]` CSS；CI 中没有 Electron 窗口快照。Windows 安装程序是 `desktop:pack` 的输出；[`Release (desktop)`](../../../../.github/workflows/desktop-release.yml) 负责发布。
