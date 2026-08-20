# Agent Note: Desktop installer publication to GitHub Packages

Status: implemented

English | [中文](2026-08-20-desktop-github-packages-release.zh.md)

## Problem

`pnpm run desktop:pack` assembled a Windows installer only on a local checkout. There was no CI job that produced those bytes, and no registry that accepted the installer: the dsh npm sequence publishes `@deepseek-ai/dsh-desktop` (the Electron main script) to npmjs.com, which is not an installer, and GitHub Packages npm refuses a scope that does not match the repository owner.

## Decision

[`Release (desktop)`](../../../../.github/workflows/desktop-release.yml) is a dispatch-only native pack matrix plus a credentialed publish job. Pack runs `pnpm run build:official` then `pnpm run desktop:pack` on `windows-2025` (NSIS `.exe`), `macos-15` (unsigned host-arch `.dmg`), and `ubuntu-24.04` (host-arch `.AppImage`) and uploads each artifact. Publish downloads those bytes and runs [`scripts/release/publish-desktop-github-packages.ts`](../../../../scripts/release/publish-desktop-github-packages.ts): it publishes `@<owner>/dsh-desktop` to `https://npm.pkg.github.com` (the owner scope is the GitHub Packages rule) with the present installers as the packaged files, then creates or updates the GitHub Release for the tag so a browser can download the same bytes.

Publication is accepted only from `dsh-v<version>` or `desktop-v<version>` matching the repository version. The job uses `GITHUB_TOKEN` (`packages: write`, `contents: write`). It does not publish to npmjs.com and does not rewrite the in-repo `@deepseek-ai/dsh-desktop` name.

`desktop:pack` deploys `@deepseek-ai/dsh` with `--legacy` and a hoisted linker, omits `--prod` so web-host packages the CLI also lists as devDependencies stay in the runtime, points electron-builder at the already-unpacked Electron dist, and restores `package.json` after moving `electron` into `devDependencies` for the builder. The packaged host starts `extraResources/runtime/lib/bin.js`, which is where `pnpm deploy` places the CLI entry. Pack also stamps `update-feed.json` from `DSH_DESKTOP_UPDATE_REPO`, `GITHUB_REPOSITORY`, or `origin` so the running window can query that repository's Releases ([update check](../feature/2026-08-20-desktop-update-check.md)).

## Alternatives considered

**Publish the installer through the existing `Release (dsh)` npmjs sequence.** Rejected: that sequence uploads library tarballs; a 100MB-class NSIS executable is not an npmjs library payload, and `@deepseek-ai/dsh-desktop` already means the Electron main script.

**Publish `@deepseek-ai/dsh-desktop` to GitHub Packages unchanged.** Rejected: GitHub Packages requires the npm scope to equal the repository owner, so a fork such as `zous168/deepseek-harness-client` cannot write `@deepseek-ai/*`.

**GitHub Release assets only.** Rejected as the only destination: the request is a GitHub Packages publication. The Release remains the browser download of the same bytes.

**Run pack on every pull request.** Rejected: electron-builder on Windows is a long job and is not a pull-request signal; dispatch is the rehearsal, matching the Python release dry-run stance more than the cheap dsh tarball pack.

## Consequences

A matching tag plus `workflow_dispatch` with `publish=true` puts the Windows, macOS, and Linux installers on GitHub Packages as `@<owner>/dsh-desktop` and on the tag's GitHub Release. Local `desktop:pack` remains the assembler for the current OS. The macOS DMG is unsigned.
