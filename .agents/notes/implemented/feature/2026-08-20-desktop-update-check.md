# Agent Note: Desktop GitHub Release update check

Status: implemented

English | [中文](2026-08-20-desktop-update-check.zh.md)

## Problem

A packaged `dsh desktop` window has no path from the running installer to a newer GitHub Release. Users who install from a Release or GitHub Packages cannot learn that a later `desktop-v*` or `dsh-v*` tag exists unless they remember to open the repository. Opening a browser download page still leaves the user to fetch a 100MB-class NSIS executable by hand. Silent replace without a prompt would also run an installer the user did not authorize.

## Decision

After the window loads, the Electron shell queries `https://api.github.com/repos/{owner}/{repo}/releases?per_page=30` and compares `app.getVersion()` to non-draft tags prefixed `desktop-v`, `dsh-v`, or `v`. Semver precedence includes prereleases, so `0.1.0` is newer than `0.1.0-rc.8`. It then silently downloads this platform's installer (`DeepSeek Harness-<version>-win-x64.exe`, `DeepSeek Harness-<version>-mac-<arch>.dmg`, or `DeepSeek Harness-<version>-linux-<arch>.AppImage`) into `userData/updates` when the asset URL is HTTPS on `github.com` or `*.githubusercontent.com`. The dialog (`Later` / `Install`) appears only after the file is complete; **Install** opens that artifact and quits this window. **Later** keeps the cached file for the next launch.

The feed is not hardcoded. Preference is `DSH_DESKTOP_UPDATE_REPO`, then `update-feed.json` (packaged `extraResources`, or `apps/desktop/update-feed.json` on a checkout), then `GITHUB_REPOSITORY`, then `git remote get-url origin`. `desktop:pack` stamps that file from the same identity so a packed installer still knows which repository published it. `--no-update-check` skips the query and is stripped from the inner `dsh web` argv. A missing feed, a failed fetch (8s list timeout, 15min download timeout), a size mismatch, or a closed window leaves the running session unchanged.

The packaged window decision remains [desktop packaged window](2026-08-20-desktop-packaged-window.md). Publication of the installer remains [desktop GitHub Packages release](../process/2026-08-20-desktop-github-packages-release.md).

## Verification

`apps/desktop/tests/update.spec.ts` pins feed parsing, tag prefixes, prerelease order, newest non-draft selection, trusted Windows, macOS, and Linux asset selection, silent download then install authorization, cache reuse, size mismatch, skip, and a swallowed fetch failure. `apps/desktop/tests/desktop.spec.ts` pins that `--no-update-check` never reaches the web host. `apps/desktop/tests/pack.spec.ts` pins that the stamped feed file is copied into `extraResources`.

## Alternatives considered

**electron-updater with silent quit-and-install.** Rejected: the request is a silent download plus an install-authorization dialog. electron-updater's default replace path does not own that prompt, and the current NSIS artifact is not published as a signed generic provider feed.

**`GET /releases/latest`.** Rejected: GitHub omits prereleases from that endpoint, and the current product version is a prerelease (`0.1.0-rc.8`). The list endpoint is the one that can offer `desktop-v0.1.0-rc.9` to an `rc.8` window.

**Hardcode one `owner/repo` in the shell.** Rejected: official and fork publications publish from different repositories. Pack-time identity plus an env override keep the same binary buildable from either checkout.

**Block first paint until the Releases request finishes.** Rejected: the 8s timeout would delay the window on a slow or filtered network. The check starts after `loadURL` and never fails boot.

**Compare versions against the npm registry.** Rejected: the Windows installer is a GitHub Release / GitHub Packages artifact, not the npmjs `@deepseek-ai/dsh-desktop` tarball that ships only the Electron main script.

## Consequences

A running window can cache a newer Windows, macOS, or Linux installer without interrupting first paint, then ask before opening it. Operators disable the query with `--no-update-check` or by omitting a resolvable feed. GitHub unauthenticated rate limits and private repositories without a token make the check a no-op; that is acceptable because the window already runs. The Windows installer still uses its own elevation prompt when the NSIS payload requires it. The macOS DMG is unsigned, so Gatekeeper may require a manual open.
