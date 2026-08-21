# Agent Note: 设置页给出客户端产物的构建版本

Status: implemented

[English](2026-08-21-client-version-in-settings.md) | 中文

## 问题

运行中的窗口说不出自己是哪个构建。侧边栏品牌行带有 7 字符 commit 徽标，但官方构建中该行被 `ui-brand-official` 替换，因此已发布的桌面或 Web 用户完全看不到构建身份。支持排查于是无法区分「这台机器装的是旧安装包」和「这是当前发布版的缺陷」——打包的 Windows 安装程序就复现了这一点：一份首次运行的反馈，症状与数个版本前已修复的问题一致，最后只能靠翻文件系统才确定跑的是哪个构建。

## 决策

`DSH_CLIENT_VERSION` 与 `DSH_CLIENT_COMMIT_HASH` 并列成为公开的客户端构建值。[`repositoryVersion`](../../../../scripts/client-build-environment.ts) 读取工作区根 manifest——dsh 发布家族的全部成员共享该版本——[`scripts/build.ts`](../../../../scripts/build.ts) 将其放入构建进程环境，使 Vite 与 tsdown 内联同一个字面量。官方 profile 像要求 commit hash 一样要求它，因此未嵌入版本的官方产物集会在构建记录断言处失败，而不是匿名发布。

[`VersionRow`](../../../../packages/client/ui-settings-general/src/client/VersionRow.tsx) 以 order 100 注册进 `settings.general.item`，位于该列最后，并在渲染时读取被内联的值。未经构建的源码运行没有可内联的字面量，于是渲染 `开发构建`，而不是编造一个版本号。构建身份不属于任何单一功能，因此该行由设置外壳持有。

该行报告的是客户端产物，不是 Host 进程。`host.describe.version` 仍是原有的 `'0.0.1'` 占位符；填充它是另一个问题——远程浏览器应当了解其服务端的哪些信息。

## 验证

`packages/client/ui-settings-general/tests/components.client.spec.tsx` 渲染已嵌入与未构建两种情形。`tests/apply.client.spec.ts` 钉住注册的 id、order 与 locale namespace。`scripts/client-build-environment.client.spec.ts` 钉住官方 profile 的精确 key 集合、缺少版本时的拒绝，以及 manifest 读取。`apps/web/tests/snapshots/settings-chrome/dialog*.expected.md` 以令牌化的版本钉住两种语言下渲染出的该行，因此发版不会改写 golden。

## 曾考虑的替代方案

**读取 `host.describe.version`。** 本次不予采纳：该字段是占位符，要填上真实值就得让它经 `ApiProxyDefaults` 传入每个组装应用以及约二十处测试调用点，而且它回答的是另一个问题——连的是哪个服务端，而非跑的是哪份 bundle。桌面窗口两者是一起发布的。

**复用侧边栏的 commit 徽标。** 不予采纳：官方构建会替换该行，而那恰恰是需要身份信息的场景；而且 commit hash 无法告诉用户该与哪个发布版对照。

**仅在嵌入了版本时才注册该行。** 不予采纳：条件注册让未构建的情形变成不可见而非被解释，还在 `apply` 里留下一个测试无法覆盖的分支。

## 后果

每个官方产物集都带上自身版本，设置页在两种语言下都会显示。一个新的公开 `DSH_CLIENT_*` key 被内联进已发布字节，官方 profile 断言现已覆盖它。设置 golden 会令牌化对话框中任何 `x.y.z` 字符串，因此今后可见值为版本号的行也会一并被令牌化。
