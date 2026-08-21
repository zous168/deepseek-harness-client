# Agent Note: NSIS update removes the previous install in place

Status: implemented

English | [中文](2026-08-21-nsis-update-removes-install-in-place.zh.md)

## Problem

Upgrading a packaged Windows install failed before the new files were extracted. electron-builder's update path runs the installed build's uninstaller with `--updated`, and that uninstaller relocates every installed file into `$PLUGINSDIR\old-install` before deleting anything, so a rollback can restore the tree. The destination prefix is longer than the install directory: `C:\Program Files\DeepSeekHarness` is 32 characters, while `%TEMP%\nsXXXXX.tmp\old-install` is 57. `resources\runtime` carries the deployed CLI closure, whose deepest `node_modules` entries already reach 239 characters, so eleven of them crossed the 260-character `MAX_PATH` limit once relocated. `Rename` failed, the uninstaller aborted, and setup retried five times before reporting "DeepSeek Harness cannot be closed" — a message about a running process, for a failure that has no running process and that retrying can never clear.

## Decision

[`apps/desktop/installer.nsh`](../../../../apps/desktop/installer.nsh) supplies `customRemoveFiles`, which replaces electron-builder's relocate-then-delete block with `SetOutPath $TEMP` plus `RMDir /r $INSTDIR`. Every path stays at its installed length, so removal never depends on the temp-directory prefix. This gives up the rename's restore-on-failure step: a partial delete leaves whatever remains for the new files to overwrite, rather than restoring the previous build.

[`apps/desktop/scripts/pack.ts`](../../../../apps/desktop/scripts/pack.ts) also deletes `.js.map`, `.mjs.map`, `.cjs.map`, `.d.ts.map`, and `.css.map` from the deployed runtime after the workspace closure is restored. The packaged host executes built JavaScript and never reads them; a plugin client-bundle map request answers 404 rather than failing the response. Those files are 108MB of the 518MB deploy tree. Type declarations stay: the packaged runtime carries TypeScript and the language-server capability, which read `.d.ts` at run time.

An uninstaller is built into the artifact it ships with, so this fix reaches a machine only from the next upgrade onward. Upgrading an installation that predates it still runs the old relocate-then-delete uninstaller and still fails; that install must be removed once through its own uninstaller, whose non-update path already deletes in place.

The close-app check remains [NSIS close-app matches only DeepSeekHarness.exe](2026-08-21-nsis-close-app-matches-executable-only.md). The rest of the NSIS layout remains [desktop packaged window](../feature/2026-08-20-desktop-packaged-window.md).

## Verification

`apps/desktop/tests/pack.spec.ts` pins the `customRemoveFiles` body and that source-map pruning deletes the five map suffixes, keeps `.js` and `.d.ts`, and reports zero for an absent directory.

## Alternatives considered

**Keep the relocation and shorten the packaged paths.** Rejected: the files being relocated belong to the *installed* build, not the incoming one, so shortening what the new installer ships cannot fix the upgrade that fails.

**Delete the previous install from the new installer before electron-builder reaches `uninstallOldVersion`.** Rejected: the only hook that runs at that point is `customCheckAppRunning`, which an assisted installer inserts in the outer, unelevated instance, and `customInit` runs in `.onInit` before the user has accepted the wizard.

**Swallow the failure with `customUnInstallCheck`.** Rejected: it runs after the five-attempt loop, so the user still sees the dialog and each attempt re-walks the whole tree.

**Strip `.d.ts` alongside the maps.** Rejected: it would save a further 43MB, but the packaged runtime resolves `typescript/lib/lib.*.d.ts` and the language-server capability reads declarations.

## Consequences

An upgrade from any build that carries this uninstaller removes the previous tree directly, with no temp-directory copy and no `MAX_PATH` exposure, and cannot roll back a partial delete. The installer also stops shipping source maps, so plugin client bundles have no maps in devtools. Existing installations built before this change need one manual uninstall.
