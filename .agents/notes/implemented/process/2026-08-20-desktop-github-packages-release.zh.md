# Agent Note: 将桌面安装程序发布到 GitHub Packages

Status: implemented

[English](2026-08-20-desktop-github-packages-release.md) | 中文

## 问题

`pnpm run desktop:pack` 只能在本地 checkout 组装 Windows 安装程序。没有 CI 作业产出这些字节，也没有注册表接收安装程序：dsh 的 npm 序列把 `@deepseek-ai/dsh-desktop`（Electron 主进程脚本）发布到 npmjs.com，那不是安装程序；GitHub Packages 的 npm 注册表拒绝与仓库所有者不一致的 scope。

## 决策

[`Release (desktop)`](../../../../.github/workflows/desktop-release.yml) 是仅手动触发的原生打包矩阵，外加一个带凭证的发布作业。打包在 `windows-2025`（NSIS `.exe`）、`macos-15`（未签名的主机架构 `.dmg`）与 `ubuntu-24.04`（主机架构 `.AppImage`）上运行 `pnpm run build:official` 再运行 `pnpm run desktop:pack`，并分别上传产物。发布作业下载这些字节并运行 [`scripts/release/publish-desktop-github-packages.ts`](../../../../scripts/release/publish-desktop-github-packages.ts)：它先把已存在的安装程序挂到 GitHub Release，再把每个文件作为 `@<owner>/dsh-desktop-<os>-<arch>` 发布到 `https://npm.pkg.github.com`（所有者 scope 是 GitHub Packages 的规则）。合并成一个 tarball 会超过 Packages 的 256 MiB 上限；electron-builder 把 CI 上的 AppImage 命名为 `linux-x86_64`。

仅当 tag 为与仓库版本匹配的 `dsh-v<version>` 或 `desktop-v<version>` 时才接受发布。作业使用 `GITHUB_TOKEN`（`packages: write`、`contents: write`）。它不发布到 npmjs.com，也不改写仓库内的 `@deepseek-ai/dsh-desktop` 名称。

`desktop:pack` 用 `--legacy` 与 hoisted linker 部署 `@deepseek-ai/dsh`，省略 `--prod`，以免 CLI 同时列为 devDependencies 的 web 宿主包从运行时中被裁掉，并且不设置 `link-workspace-packages`，以便复制而不是链接 workspace 包。部署后断言存在 `runtime/lib/bin.js` 与 `runtime/node_modules/@deepseek-ai/dsh-app-boot`；electron-builder 指向已经解包的 Electron dist，并在把 `electron` 移入 `devDependencies` 供构建器使用后恢复 `package.json`。extraResources 的 FileMatcher 会丢掉 `node_modules`，因此 `afterPack` 把已部署的树（解引用链接）拷进解包后的 `resources/runtime` 并再次断言这些启动路径。部署之后还会补拷被 legacy hoisting 或 `link:` override 漏掉的 workspace 包（首先是 `@deepseek-ai/cosmokit`）。打包后的宿主启动该 `runtime/lib/bin.js`。打包还会根据 `DSH_DESKTOP_UPDATE_REPO`、`GITHUB_REPOSITORY` 或 `origin` 写入 `update-feed.json`，让正在运行的窗口能查询该仓库的 Releases（[更新检查](../feature/2026-08-20-desktop-update-check.md)）。

## 曾考虑的替代方案

**通过现有 `Release (dsh)` npmjs 序列发布安装程序。** 不予采纳：该序列上传的是库 tarball；百 MB 级的 NSIS 可执行文件不是 npmjs 库 payload，且 `@deepseek-ai/dsh-desktop` 已经表示 Electron 主进程脚本。

**把未改名的 `@deepseek-ai/dsh-desktop` 发到 GitHub Packages。** 不予采纳：GitHub Packages 要求 npm scope 等于仓库所有者，因此 `zous168/deepseek-harness-client` 这类 fork 不能写入 `@deepseek-ai/*`。

**只使用 GitHub Release 资产。** 不作为唯一目的地：需求是发布到 GitHub Packages。Release 仍是同一份字节的浏览器下载入口。

**在每个 pull request 上运行打包。** 不予采纳：Windows 上的 electron-builder 是长作业，不是 pull request 信号；手动触发即排练，更接近 Python 发布的 dry-run 立场，而不是廉价的 dsh tarball 打包。

## 后果

匹配的 tag 加上 `workflow_dispatch` 且 `publish=true`，会把 Windows、macOS 与 Linux 安装程序放到该 tag 的 GitHub Release，并在对应文件存在时作为 `@<owner>/dsh-desktop-win-x64`、`@<owner>/dsh-desktop-mac-arm64`、`@<owner>/dsh-desktop-linux-x86_64` 放到 GitHub Packages。本地 `desktop:pack` 仍是当前操作系统的组装器。macOS DMG 未签名。
