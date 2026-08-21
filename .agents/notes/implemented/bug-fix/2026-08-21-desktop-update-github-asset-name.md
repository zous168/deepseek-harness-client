# Agent Note: Desktop update matches GitHub's dotted installer names

Status: implemented

English | [中文](2026-08-21-desktop-update-github-asset-name.zh.md)

## Problem

The packaged window queries GitHub Releases for a newer installer, then selects the asset whose `name` equals `DeepSeek Harness-<version>-<os>-<arch>.<ext>`. GitHub Releases replace spaces in uploaded file names with `.`, so the stored asset is `DeepSeek.Harness-<version>-<os>-<arch>.<ext>`. The equality check fails, `offerDesktopUpdate` returns without progress or an install button, and a running older build reports no update even though a newer non-draft tag exists.

## Decision

[`apps/desktop/src/update.ts`](../../../../apps/desktop/src/update.ts) names packed and published installers `DeepSeek.Harness-<version>-…`. [`selectDesktopInstallerAsset`](../../../../apps/desktop/src/update.ts) compares names after folding spaces to `.`, so a leftover packed file that still uses a space matches the same Release asset. [`apps/desktop/electron-builder.yml`](../../../../apps/desktop/electron-builder.yml) writes that dotted `artifactName` so the file on disk matches the name GitHub stores. The publish helper parses either spelling into the same platform id.

A window that shipped the old exact-name check still cannot select today's Release assets. That hop has to be installed from the Release page; later windows use this matcher.

The update-check decision remains [desktop update check](../feature/2026-08-20-desktop-update-check.md).

## Verification

`apps/desktop/tests/update.spec.ts` pins selection of the dotted GitHub name and of the spaced packed name. `apps/desktop/tests/pack.spec.ts` pins the dotted `artifactName`. `scripts/release/publish-desktop-github-packages.spec.ts` pins both spellings of `desktopInstallerPlatformId`.

## Alternatives considered

**Keep the spaced packed name and rewrite only the matcher.** Rejected: every publish would keep asking GitHub to store a name it immediately rewrites, and local pack output would keep disagreeing with the Release asset.

**Upload a second asset under the spaced name.** Rejected: GitHub still rewrites the second upload, so the old window still finds nothing.

## Consequences

New packs write `DeepSeek.Harness-…`. A window with this matcher can download that asset. Windows that already shipped the exact spaced name still cannot, and must take one manual install.
