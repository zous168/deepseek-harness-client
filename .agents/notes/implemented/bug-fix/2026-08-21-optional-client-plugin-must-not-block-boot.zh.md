# Agent Note: 可选客户端插件不得阻断 Web 启动

Status: implemented

[English](2026-08-21-optional-client-plugin-must-not-block-boot.md) | 中文

## 问题

`details` 是 `single` 槽。已交付的会话 DetailsPanel 已经占用 priority 0。名册中较后的插件（例如 `aws-wechat-console`）若以同一 priority 注册同一格，apply 会失败。`AppWebEntry` 把每一个失败 fiber 都当成启动失败，于是这一插件把不依赖框架的启动页留住，其余 Web UI 再也挂不上。

## 决策

结算仍等待整份名册（[web 配置树启动](../architecture/2026-07-24-web-config-tree-boot-and-transport-layering.md)）。仅当某个 `immediately` 外壳 entry 在 import、apply 或等待服务上失败时，启动页才留下。较后的名册 entry 失败只写入控制台，不占用任何槽；`uiRenderer.mount` 仍会运行。动态 Cordis 包已经通过 client-runner guard 隔离这条路径（分配唯一且更低的 priority）；本决策是静态图上的对应规则。

## 曾考虑的替代方案

**对名册每一行都 fail-loud。** 不予采纳：第三方或用户插件拿不到 `details`，不是扣住已交付外壳的理由。

**把 `details` 改成 list 槽。** 不予采纳：该列按设计只有一个占用者；可叠加的控制台应进入 `shell.overlay` 或 `conversation.view`。

**在静态图上自动分配 priority。** 不予采纳：静态插件是第一方组合；静默遮蔽会把已交付名册里的真正重复藏起来。

## 后果

可选客户端插件 apply 失败时，贡献者与用户仍能运行 Web UI。启动页仍是渲染器或其他 `immediately` 外壳 entry 缺失时的报告。包测试钉住两种结果：较后的抛错行仍会挂载，抛错的 `immediately` 行则留在启动页。
