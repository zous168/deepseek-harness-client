# Agent Note: 桌面更新匹配 GitHub 带点的安装程序名

Status: implemented

[English](2026-08-21-desktop-update-github-asset-name.md) | 中文

## 问题

打包窗口向 GitHub Releases 查询更新的安装程序，然后选择 `name` 等于 `DeepSeek Harness-<version>-<os>-<arch>.<ext>` 的资源。GitHub Releases 会把上传文件名里的空格换成 `.`，因此存下来的资源是 `DeepSeek.Harness-<version>-<os>-<arch>.<ext>`。相等检查失败，`offerDesktopUpdate` 不画进度、也不出现安装按钮，正在运行的旧构建即使已有更新的非 draft tag，也会报告没有更新。

## 决策

[`apps/desktop/src/update.ts`](../../../../apps/desktop/src/update.ts) 把打包和发布的安装程序命名为 `DeepSeek.Harness-<version>-…`。[`selectDesktopInstallerAsset`](../../../../apps/desktop/src/update.ts) 在比较名称前把空格折成 `.`，因此仍带空格的打包文件也能对上同一份 Release 资源。[`apps/desktop/electron-builder.yml`](../../../../apps/desktop/electron-builder.yml) 写出该带点的 `artifactName`，使磁盘上的文件名与 GitHub 存储的名称一致。发布辅助函数把两种拼写解析成同一个平台 id。

已经带上旧的精确名称检查的窗口仍然选不中今天的 Release 资源。那一次升级必须从发行页安装；之后的窗口使用本匹配器。

更新检查决策仍见 [桌面更新检查](../feature/2026-08-20-desktop-update-check.md)。

## 验证

`apps/desktop/tests/update.spec.ts` 钉住带点的 GitHub 名称以及带空格的打包名称的选择。`apps/desktop/tests/pack.spec.ts` 钉住带点的 `artifactName`。`scripts/release/publish-desktop-github-packages.spec.ts` 钉住 `desktopInstallerPlatformId` 的两种拼写。

## 曾考虑的替代方案

**保留带空格的打包名，只改匹配器。** 不予采纳：每次发布都会继续让 GitHub 去存一个它立刻会改写的名字，本地打包输出也会一直和 Release 资源对不上。

**再上传一份带空格名称的资源。** 不予采纳：GitHub 仍会改写第二次上传，旧窗口还是找不到。

## 后果

新的打包写出 `DeepSeek.Harness-…`。带本匹配器的窗口可以下载该资源。已经带上精确空格名检查的窗口仍然不能，必须手动安装一次。
