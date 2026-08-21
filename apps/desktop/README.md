# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Packaged Electron window for the DeepSeek Harness Web UI. The shell boots the existing `web` profile as a child, waits for the `dsh web:` ready line, and loads that loopback URL. The window is frameless (`frame: false`): only `[data-dsh-app-drag]` handles drag the window. Web chrome opts those in; while the boot page is visible or no chrome handle exists, the shell injects one top-strip fallback and marks the boot wordmark. Session content, header controls, and any open modal stay clickable. The shell injects minimize / maximize / close. The window and installer use the DeepSeek whale mark on the brand-blue plate from [`icons/icon.svg`](icons/icon.svg).

This is an application, not a new capability family. Host, Client, and web-app plugins stay where they are; the desktop package only owns the native window and the installer layout. The `file://` plus IPC carrier documented on [`dsh-host-webserver`](../../packages/host/webserver/README.md) is not this shell.

## Run

From a built checkout:

```sh
pnpm run build
pnpm dsh desktop
```

`dsh desktop` is a launcher alias: it starts Electron with this package's `lib/main.js` and forwards leftover web-app flags. The host always receives `--no-open`. When the caller omits `--port`, the host asks the OS for a free port. A checkout launch runs the web host under the CLI's Node (`DSH_NODE_EXECUTABLE`). A packaged launch sets `ELECTRON_RUN_AS_NODE=1` so the deployed `dsh` bin can run as Node. After the window loads, the shell queries GitHub Releases for a newer `desktop-v*` or `dsh-v*` tag and silently downloads this platform's installer (Windows NSIS `.exe`, macOS `.dmg`, or Linux `.AppImage`); a dialog asks for install authorization only after that file is cached. `--no-update-check` skips the query. The feed is `DSH_DESKTOP_UPDATE_REPO` or the `update-feed.json` stamped at pack time from `GITHUB_REPOSITORY` or `origin`.

```sh
dsh desktop --port 8080
dsh desktop --patch ./extra.yml
dsh desktop --dump-config
dsh desktop --no-update-check
```

`--dump-config` and `--dump-default-config` print the web profile tree and do not start Electron.

## Pack

```sh
pnpm run desktop:pack
```

The pack script rasterizes the whale mark to `icons/icon.png`, deploys `@deepseek-ai/dsh` into `runtime/`, and runs electron-builder for the current OS. The Windows NSIS installer names `zous168` as publisher, defaults to a per-machine (all users) install under Program Files, and requests elevation. It closes only `DeepSeekHarness.exe`; a browser tab or other window whose title contains DeepSeek Harness is not the running application. A macOS checkout writes an unsigned host-arch DMG (`mac-arm64` on Apple Silicon, `mac-x64` on Intel). A Linux checkout writes a host-arch AppImage (`linux-x86_64` on the CI runner). Installers land in `release/`. [`Release (desktop)`](../../.github/workflows/desktop-release.yml) packs Windows on `windows-2025`, macOS on `macos-15`, and Linux on `ubuntu-24.04`, then publishes each installer to GitHub Packages as `@<owner>/dsh-desktop-<os>-<arch>` (GitHub Packages rejects one tarball over 256 MiB) plus a GitHub Release for the tag ([publication](../../.agents/notes/implemented/process/2026-08-20-desktop-github-packages-release.md)). Dispatch the workflow from `dsh-v<version>` or `desktop-v<version>` with `publish=true`.

## Model Experience

None. The package is a native window around the existing Web UI; nothing here enters a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The window loads loopback HTTP, not `file://`** — the host still binds a local webserver. The IPC carrier remains unshipped.
- **Source launches need built CLI and frontend artifacts** — `dsh desktop` resolves `apps/cli/lib/bin.js` and the web dist the host already requires.
- **Native installers are not npmjs artifacts** — `desktop:pack` writes `release/` for the current OS; GitHub Packages and the GitHub Release carry the Windows `.exe`, the macOS `.dmg`, and the Linux `.AppImage`. The macOS DMG is unsigned (no Apple Developer identity).
- **Update install requires authorization** — the download is silent; the installer runs only after the user chooses **Install**. A failed or skipped check leaves the running window unchanged.
