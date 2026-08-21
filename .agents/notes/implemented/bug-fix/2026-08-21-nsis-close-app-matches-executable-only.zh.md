# Agent Note: NSIS 关闭应用只匹配 DeepSeekHarness.exe

Status: implemented

[English](2026-08-21-nsis-close-app-matches-executable-only.md) | 中文

## 问题

Windows NSIS 安装程序必须替换安装目录下的文件。electron-builder 的默认关闭应用检查在 PowerShell 可用时，会把可执行路径以 `$INSTDIR` 开头的任何进程都当成正在运行的应用。标题为 DeepSeek Harness 的浏览器标签页、安装程序窗口、打开本仓库的 Cursor，或 Program Files 下的其他进程，就会在 `DeepSeekHarness.exe` 并未运行时弹出「DeepSeek Harness 无法关闭」。

## 决策

[`apps/desktop/installer.nsh`](../../../../apps/desktop/installer.nsh) 提供 `customCheckAppRunning`。它只用 `tasklist /FI "IMAGENAME eq …"` 加锚定的 `findstr` 查找并关闭 `${APP_EXECUTABLE_FILENAME}`（`DeepSeekHarness.exe`）。它不使用 `$INSTDIR` 前缀、`FindWindow` 或 `nsProcess` 子串搜索。`electron-builder.yml` 把 `nsis.include` 设为该文件。正在运行的 `DeepSeekHarness.exe` 仍会收到关闭提示并被 `taskkill`；其他进程不会。

## 曾考虑的替代方案

**沿用 electron-builder 的默认检查。** 不予采纳：26.15.3 已有精确 `tasklist` 回退，但在正常 Windows 机器上会走 PowerShell `$INSTDIR` 前缀路径。

**空的 `customCheckAppRunning`。** 不予采纳：真正在跑的 `DeepSeekHarness.exe` 会占用文件，升级可能损坏。

**按产品窗口标题匹配。** 不予采纳：打包窗口标题是 `DeepSeek Harness`，GitHub Release 标签页、安装程序标题和本仓库的编辑器标题也是。

## 后果

包测试钉住 `nsis.include` 和按映像名精确匹配的脚本。该检查属于 `desktop:pack`；没有这份 include 的安装程序仍会保留默认误报。[打包窗口](../feature/2026-08-20-desktop-packaged-window.md) 仍拥有其余 NSIS 布局。
