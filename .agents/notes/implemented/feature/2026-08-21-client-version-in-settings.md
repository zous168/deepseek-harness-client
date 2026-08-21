# Agent Note: Settings names the version the client artifacts were built from

Status: implemented

English | [中文](2026-08-21-client-version-in-settings.zh.md)

## Problem

A running window could not name its own build. The sidebar brand row carries a 7-character commit badge, but `ui-brand-official` replaces that row in official builds, so a released desktop or web user sees no build identity at all. Support then cannot distinguish "this machine is on an older installer" from "this behavior is a defect in the current release" — the packaged Windows installer reproduced exactly that, where a first-run report matched symptoms fixed several releases earlier and only a filesystem inspection could settle which build was running.

## Decision

`DSH_CLIENT_VERSION` joins `DSH_CLIENT_COMMIT_HASH` as a public client build value. [`repositoryVersion`](../../../../scripts/client-build-environment.ts) reads the workspace root manifest, whose version the dsh release family shares across every member, and [`scripts/build.ts`](../../../../scripts/build.ts) puts it in the build-process environment so Vite and tsdown inline the same literal. The official profile requires it exactly like the commit hash, so an official artifact set that embedded no version fails the build-record assertion instead of shipping anonymous.

[`VersionRow`](../../../../packages/client/ui-settings-general/src/client/VersionRow.tsx) registers into `settings.general.item` at order 100, last in the column, and reads the inlined value at render. An unbuilt source run has no literal to inline and renders `开发构建` rather than a fabricated number. The settings shell owns the row because build identity belongs to no feature.

The row reports the client artifacts, not the Host process. `host.describe.version` remains the `'0.0.1'` placeholder it already was; filling it is a separate question about what a remote browser should learn about its server.

## Verification

`packages/client/ui-settings-general/tests/components.client.spec.tsx` renders both the embedded and unbuilt cases. `tests/apply.client.spec.ts` pins the registration id, order, and locale namespace. `scripts/client-build-environment.client.spec.ts` pins the official profile's exact key set, the missing-version rejection, and manifest reading. `apps/web/tests/snapshots/settings-chrome/dialog*.expected.md` pin the rendered row in both languages with the version tokenized, so a release does not rewrite a golden.

## Alternatives considered

**Read `host.describe.version`.** Rejected for this change: the field is a placeholder whose real value would have to travel through `ApiProxyDefaults` into every composing app and about twenty test call sites, and it answers a different question — which server is attached, not which bundle is running. A desktop window ships both together.

**Reuse the sidebar commit badge.** Rejected: official builds replace that row, which is exactly the case that needed identity, and a commit hash does not tell a user which release to compare against.

**Register the row only when a version is embedded.** Rejected: the conditional registration made the unbuilt case invisible rather than explained, and left a branch in `apply` that no test could reach.

## Consequences

Every official artifact set carries its version, and Settings shows it in both languages. A new public `DSH_CLIENT_*` key is inlined into published bytes, which the official-profile assertion now covers. The settings goldens tokenize any `x.y.z` string in the dialog, so a future row whose visible value is a version number is tokenized too.
