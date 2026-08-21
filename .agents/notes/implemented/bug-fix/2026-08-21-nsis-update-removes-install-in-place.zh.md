# Agent Note: NSIS 升级就地删除上一版安装

Status: implemented

[English](2026-08-21-nsis-update-removes-install-in-place.md) | 中文

## 问题

升级已打包的 Windows 安装在解压新文件之前就失败了。electron-builder 的升级路径会带 `--updated` 运行已装版本的卸载程序，而该卸载程序在删除任何东西之前，先把每个已安装文件搬到 `$PLUGINSDIR\old-install`，以便失败时回滚整棵树。目标前缀比安装目录长：`C:\Program Files\DeepSeekHarness` 是 32 个字符，而 `%TEMP%\nsXXXXX.tmp\old-install` 是 57 个。`resources\runtime` 装着部署好的 CLI 闭包，其最深的 `node_modules` 条目本身已达 239 个字符，因此搬过去后有 11 个越过了 260 个字符的 `MAX_PATH` 上限。`Rename` 失败，卸载程序中止，安装程序重试五次后报告「DeepSeek Harness 无法关闭」——这是一条关于运行中进程的消息，而该失败并没有运行中的进程，重试也永远无法解除。

## 决策

[`apps/desktop/installer.nsh`](../../../../apps/desktop/installer.nsh) 提供 `customRemoveFiles`，用 `SetOutPath $TEMP` 加 `RMDir /r $INSTDIR` 替换 electron-builder 的「先搬后删」代码块。每个路径都保持其安装时的长度，因此删除不再取决于临时目录前缀。这放弃了搬运带来的失败回滚：删除中途失败时，剩下的文件交给新文件覆盖，而不是恢复上一版。

[`apps/desktop/scripts/pack.ts`](../../../../apps/desktop/scripts/pack.ts) 还会在恢复 workspace 闭包之后，从部署好的运行时中删除 `.js.map`、`.mjs.map`、`.cjs.map`、`.d.ts.map` 与 `.css.map`。打包宿主执行的是已构建的 JavaScript，从不读取它们；插件客户端 bundle 的 map 请求会返回 404，而不是让响应失败。这些文件占 518MB 部署树中的 108MB。类型声明保留：打包运行时携带 TypeScript 与语言服务器能力，它们在运行时读取 `.d.ts`。

卸载程序是随其所属产物一起构建的，因此本修复只能从下一次升级起在一台机器上生效。升级早于本修复的安装仍会运行旧的「先搬后删」卸载程序，仍会失败；这类安装需要用它自己的卸载程序移除一次，其非升级路径本来就是就地删除。

关闭应用的检查仍见 [NSIS 关闭应用只匹配 DeepSeekHarness.exe](2026-08-21-nsis-close-app-matches-executable-only.md)。其余 NSIS 布局仍见 [桌面打包窗口](../feature/2026-08-20-desktop-packaged-window.md)。

## 验证

`apps/desktop/tests/pack.spec.ts` 钉住 `customRemoveFiles` 的宏体，以及 sourcemap 清理会删除这五种 map 后缀、保留 `.js` 与 `.d.ts`、对不存在的目录返回零。

## 曾考虑的替代方案

**保留搬运，改为缩短打包路径。** 不予采纳：被搬运的是*已安装*版本的文件，不是新进来的那一版，因此缩短新安装程序所带的内容无法修复正在失败的那次升级。

**在 electron-builder 走到 `uninstallOldVersion` 之前，由新安装程序先删掉上一版安装。** 不予采纳：此刻唯一会运行的钩子是 `customCheckAppRunning`，而向导式安装程序把它插在未提权的外层实例中；`customInit` 则运行在 `.onInit`，早于用户确认向导。

**用 `customUnInstallCheck` 吞掉失败。** 不予采纳：它在五次重试循环之后才运行，用户仍会看到对话框，而每次尝试都会重新遍历整棵树。

**连同 map 一起剥离 `.d.ts`。** 不予采纳：这能再省 43MB，但打包运行时会解析 `typescript/lib/lib.*.d.ts`，语言服务器能力也会读取声明。

## 后果

从任何携带本卸载程序的版本升级，都会直接删除上一棵树，没有临时目录副本，也没有 `MAX_PATH` 暴露面，同时无法回滚中途失败的删除。安装程序也不再附带 sourcemap，因此插件客户端 bundle 在 devtools 中没有 map。早于本变更构建的现有安装需要手动卸载一次。
