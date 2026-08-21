# Agent Note: Packaged desktop window over the web profile

Status: implemented

English | [中文](2026-08-20-desktop-packaged-window.zh.md)

## Problem

`dsh web` serves the assembled GUI in a browser tab. That is the right development and LAN path, but it is not a packaged client: there is no native window, no installer icon, and no launch mode that keeps the product out of the default browser. Adding a desktop product by cloning Host or Client packages into an electron family would split the same capabilities across two trees. Implementing the documented `file://` plus IPC carrier in the same change would also invent a second transport before a window existed.

## Decision

`dsh desktop` launches `@deepseek-ai/dsh-desktop`, an Electron application that boots the existing `web` profile as a child and loads the printed loopback URL. The window title is `DeepSeek Harness`. The window is `frame: false`: there is no OS title bar. Drag is only `[data-dsh-app-drag]` handles the Web chrome opts into — the empty spacer between the session title cluster and header utilities, the empty spacer between the sidebar brand and collapse control, the blank-session header strip, and the boot-page wordmark plus its top strip — never a header, hero column, or other content box, and never `#root` (an ancestor `no-drag` swallows descendant `drag` on Windows). While the framework-free boot page is visible or no chrome handle exists, the shell injects one `#dsh-desktop-drag-fallback` top strip and marks the boot wordmark; chrome handles replace that fallback. Controls on a handle stay `no-drag`. Electron hit-tests `-webkit-app-region` independently of overlay paint, so an open `[aria-modal="true"]`, `[role="dialog"]`, or `body > [role="presentation"]` tree turns those handles off. The settings panel portals to `document.body` the same way `Modal` does, so sidebar `overflow` stacking cannot trap the dialog under the injected window-button cluster. A leftover sibling drag strip is removed on inject. The shell injects minimize / maximize / close through a sandboxed preload. Session-header utilities (including Session log) clear that cluster via a `header[class*="header"]` padding rule that beats the conversation header's class padding. Edge resize stays on `thickFrame`. The window and electron-builder icon are the DeepSeek whale mark already used as the Web favicon, painted white on the brand-blue plate `#4D6BFE` at `apps/desktop/icons/icon.svg` and rasterized to `icons/icon.png` for installers.

The desktop package is an application in `apps/`, not a capability family. It adds no Host or Client plugins. The launcher alias accepts the same `--patch` and dump flags as `dsh web`; leftover tokens reach the web-app command line. The host always receives `--no-open`. When the caller omits `--port`, the host receives `--port 0` so two windows do not collide on 3080.

An unpackaged checkout starts `apps/cli/lib/bin.js` under the launcher's real Node (`DSH_NODE_EXECUTABLE`). The Win32 folder-dialog worker spawns under that same Node so its IPC channel stays a Node child, not a second Electron app. A packed installer deploys `@deepseek-ai/dsh` into `extraResources/runtime` and starts `runtime/lib/bin.js` with `ELECTRON_RUN_AS_NODE=1`. `pnpm run desktop:pack` is the assembler used locally and by [`Release (desktop)`](../../../../.github/workflows/desktop-release.yml); that workflow publishes the Windows installer to GitHub Packages ([publication](../process/2026-08-20-desktop-github-packages-release.md)). The NSIS installer records publisher `zous168` and defaults to a per-machine install (`perMachine` plus `selectPerMachineByDefault`) so the first page offers all users under Program Files and Windows elevation. An unsigned installer still shows Unknown publisher on the UAC shield; that name comes from an Authenticode certificate, not from this field. The installer closes only `DeepSeekHarness.exe` ([close-app match](../bug-fix/2026-08-21-nsis-close-app-matches-executable-only.md)). After the window loads, the shell silently downloads a newer Windows installer when one exists, reports that progress in the title-bar meter, and offers a small **安装更新** button ([update check](2026-08-20-desktop-update-check.md)). The npmjs `@deepseek-ai/dsh-desktop` package ships the Electron main script, the window preload, and icons.

This does not implement the `file://` plus IPC carrier described in [GUI layering](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md) and [`dsh-host-webserver`](../../../../packages/host/webserver/README.md). Browser install metadata remains the [Web install manifest](2026-08-06-web-install-manifest.md).

## Alternatives considered

**A new electron package family under `packages/`.** Rejected: products share Host and Client capabilities; a new application needs zero new capability packages. That alternative was already rejected in the GUI layering note.

**Load dist over `file://` and carry fetch over IPC.** Rejected as the first packaged mode: the HTTP host, browser-trust fence, static fallback, and Client boot manifest already work on loopback. The IPC subclass remains the future carrier, not a prerequisite for a native window.

**Reuse the PWA install manifest as the packaged client.** Rejected: a browser-installed shortcut is not a native window or installer, and it cannot ship a DeepSeek application icon to the operating system.

**Open the default browser with a custom icon.** Rejected: the OS browser owns the tab icon; that path cannot satisfy a packaged-window request.

**Keep native caption buttons via `titleBarOverlay`.** Rejected: that still paints the Windows title-bar control cluster. The packaged window is `frame: false`; the desktop shell injects drag CSS and its own window buttons through a sandboxed preload, without a Client plugin.

## Consequences

Contributors and users can run the same Web UI inside a native window whose icon is the DeepSeek whale. The host still binds a loopback port, so desktop and `dsh web` share trust, readiness, and snapshot coverage of the GUI. Window chrome is pinned by package tests on the icon path, ready-URL parse, host argv, and the frameless `BrowserWindow` options plus the injected `[data-dsh-app-drag]` CSS; there is no Electron window snapshot in CI. The Windows installer is a `desktop:pack` output; [`Release (desktop)`](../../../../.github/workflows/desktop-release.yml) publishes it.
