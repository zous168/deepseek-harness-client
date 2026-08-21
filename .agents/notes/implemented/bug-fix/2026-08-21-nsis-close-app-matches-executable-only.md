# Agent Note: NSIS close-app matches only DeepSeekHarness.exe

Status: implemented

English | [中文](2026-08-21-nsis-close-app-matches-executable-only.zh.md)

## Problem

The Windows NSIS installer must replace files under the install directory. electron-builder's default close-app check, when PowerShell is available, treats any process whose executable path starts with `$INSTDIR` as the running application. A browser tab titled DeepSeek Harness, the installer window, Cursor on this repo, or another process under Program Files can then raise "DeepSeek Harness cannot be closed" while `DeepSeekHarness.exe` is not running.

## Decision

[`apps/desktop/installer.nsh`](../../../../apps/desktop/installer.nsh) supplies `customCheckAppRunning`. It finds and closes only `${APP_EXECUTABLE_FILENAME}` (`DeepSeekHarness.exe`) with `tasklist /FI "IMAGENAME eq …"` plus an anchored `findstr`. It does not use an `$INSTDIR` prefix, `FindWindow`, or `nsProcess` substring search. `electron-builder.yml` sets `nsis.include` to that file. A running `DeepSeekHarness.exe` still gets the close prompt and `taskkill`; other processes do not.

## Alternatives considered

**Leave electron-builder's default check.** Rejected: 26.15.3 already has an exact `tasklist` fallback, but the PowerShell `$INSTDIR` prefix path wins on a normal Windows machine.

**Empty `customCheckAppRunning`.** Rejected: a genuinely running `DeepSeekHarness.exe` would leave files in use and can corrupt the upgrade.

**Match the product window title.** Rejected: the packaged window title is `DeepSeek Harness`, and so are GitHub Release tabs, the installer caption, and this repository's editor title.

## Consequences

Package tests pin `nsis.include` and the exact-image-name script. The check is part of `desktop:pack`; an installer built without that include keeps the default false positives. The [packaged window](../feature/2026-08-20-desktop-packaged-window.md) still owns the rest of the NSIS layout.
