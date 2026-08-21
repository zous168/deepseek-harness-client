# Agent Note: An optional client plugin must not block web boot

Status: implemented

English | [中文](2026-08-21-optional-client-plugin-must-not-block-boot.zh.md)

## Problem

`details` is a `single` slot. The shipped conversation DetailsPanel already occupies priority 0. A later roster plugin such as `aws-wechat-console` that registers the same cell at the same priority fails to apply. `AppWebEntry` treated every failed fiber as a boot failure, so that one plugin kept the framework-free boot page up and the rest of the Web UI never mounted.

## Decision

Settlement still waits for the whole roster ([web config-tree boot](../architecture/2026-07-24-web-config-tree-boot-and-transport-layering.md)). The boot page stays only when an `immediately` shell entry failed import, apply, or service waiting. A later roster entry that fails is written to the console and occupies no slot; `uiRenderer.mount` still runs. Dynamic Cordis packages already isolate this path through the client-runner guard, which assigns a unique lower priority; this decision is the static graph's matching rule.

## Alternatives considered

**Keep fail-loud for every roster row.** Rejected: a third-party or user plugin that cannot take `details` is not a reason to withhold the shipped shell.

**Change `details` to a list slot.** Rejected: the column has one occupant by design; additive consoles belong in `shell.overlay` or `conversation.view`.

**Auto-assign priorities on the static graph.** Rejected: static plugins are first-party composition; silent shadowing would hide a real duplicate in the shipped roster.

## Consequences

Contributors and users can run the Web UI when an optional client plugin fails to apply. The boot page remains the report for a missing renderer or other `immediately` shell entry. Package tests pin both outcomes: a throwing later row still mounts, and a throwing `immediately` row keeps the boot page.
