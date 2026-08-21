# Agent Note: Desktop GitHub Release update check

Status: implemented

[English](2026-08-20-desktop-update-check.md) | 中文

## 问题

已打包的 `dsh desktop` 窗口没有从正在运行的安装程序通向更新 GitHub Release 的路径。从 Release 或 GitHub Packages 安装的用户除非记得打开仓库，否则无法知道后来的 `desktop-v*` 或 `dsh-v*` tag 已经存在。打开浏览器下载页仍要用户手工获取百兆级 NSIS 可执行文件。未经提示就静默替换，也会运行用户未授权的安装程序。

## 决策

窗口加载后，Electron shell 查询 `https://api.github.com/repos/{owner}/{repo}/releases?per_page=30`，并将 `app.getVersion()` 与非 draft、前缀为 `desktop-v`、`dsh-v` 或 `v` 的 tag 比较。Semver 优先级包含预发布，因此 `0.1.0` 新于 `0.1.0-rc.8`。若资源 URL 为 `github.com` 或 `*.githubusercontent.com` 上的 HTTPS，则静默把当前平台的安装程序（`DeepSeek.Harness-<version>-win-x64.exe`、`DeepSeek.Harness-<version>-mac-<arch>.dmg` 或 `DeepSeek.Harness-<version>-linux-<arch>.AppImage`）下载到 `userData/updates`。资源名在比较前会把空格折成 `.`，因为 GitHub Releases 存的是带点的拼写（[资源名](../bug-fix/2026-08-21-desktop-update-github-asset-name.md)）。会话留在当前窗口：没有全窗口下载页。已接收字节会画在标题栏旁的细进度上（窗口按钮左侧的百分比与短条，`pointer-events: none`），并通过 `BrowserWindow.setProgressBar` 画在本进程图标上；每次注入窗口 chrome 会重发最近一次进度，避免随后的文档加载丢掉该进度。命中缓存则不出现该进度。文件完整后，标题栏旁的小 **安装更新** 按钮替换进度；点击它会打开该产物并退出当前窗口。不点该按钮则保留缓存文件供下次启动。

订阅源不硬编码。优先级为 `DSH_DESKTOP_UPDATE_REPO`，然后是 `update-feed.json`（打包后的 `extraResources`，或检出目录中的 `apps/desktop/update-feed.json`），然后是 `GITHUB_REPOSITORY`，最后是 `git remote get-url origin`。`desktop:pack` 用同一套身份写入该文件，使打包安装程序仍知道发布仓库。`--no-update-check` 跳过查询，并从内部 `dsh web` argv 中去掉。缺少订阅源、拉取失败（列表 8 秒超时、下载 15 分钟超时）、大小不匹配或窗口已关闭时，正在运行的会话不变。

打包窗口决策仍见 [桌面打包窗口](2026-08-20-desktop-packaged-window.md)。安装程序发布仍见 [桌面 GitHub Packages 发布](../process/2026-08-20-desktop-github-packages-release.md)。

## 验证

`apps/desktop/tests/update.spec.ts` 钉住订阅源解析、tag 前缀、预发布排序、最新非 draft 选择、受信任的 Windows、macOS 与 Linux 资源选择、下载进度后再请求安装授权、流式进度、缓存复用、大小不匹配、跳过，以及被吞掉的拉取失败。`apps/desktop/tests/desktop.spec.ts` 钉住 `--no-update-check` 不会到达 web 宿主，静默标题栏进度与任务栏进度跟随已接收字节，以及下载完成后变成 **安装更新** 按钮。`apps/desktop/tests/pack.spec.ts` 钉住写入的订阅源文件会被复制进 `extraResources`。

## 曾考虑的替代方案

**用 electron-updater 静默退出并安装。** 不予采纳：需求是在进程内显示下载进度，再给出标题栏旁的小安装按钮。electron-updater 的默认替换路径并不拥有该提示，且当前 NSIS 产物也未作为签名的 generic 提供方订阅源发布。

**`GET /releases/latest`。** 不予采纳：该端点会忽略预发布，而当前产品版本就是预发布（`0.1.0-rc.8`）。列表端点才能向 `rc.8` 窗口提供 `desktop-v0.1.0-rc.9`。

**在 shell 中写死一个 `owner/repo`。** 不予采纳：官方与 fork 从不同仓库发布。打包时身份加上环境变量覆盖，让同一套二进制可从任一检出目录构建。

**等 Releases 请求结束后再绘制窗口。** 不予采纳：8 秒超时会在慢速或被过滤的网络上推迟窗口。检查在 `loadURL` 之后开始，且不会让启动失败。

**对照 npm registry 比较版本。** 不予采纳：Windows 安装程序是 GitHub Release / GitHub Packages 产物，不是只交付 Electron 主进程脚本的 npmjs `@deepseek-ai/dsh-desktop` tarball。

## 后果

正在运行的窗口可以在不打断首次绘制的情况下缓存更新的 Windows、macOS 或 Linux 安装程序，在进程内报告该静默下载，然后在打开它之前询问。运营方可使用 `--no-update-check` 或省略可解析的订阅源来禁用查询。GitHub 未认证速率限制以及没有 token 的私有仓库会让检查成为空操作；这可以接受，因为窗口已经在运行。当 NSIS 载荷需要提升权限时，Windows 安装程序仍使用自己的提权提示。macOS DMG 未签名，因此 Gatekeeper 可能要求手动打开。
