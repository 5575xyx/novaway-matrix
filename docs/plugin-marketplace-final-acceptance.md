# NovaWay Plugin Marketplace Acceptance Report

Date: 2026-11-17
Repository: https://github.com/NovaWay-AI/novaway-plugins
Commit: `working tree after local expanded-capability acceptance` (`xiaoming <626@example.com>`)
Releases: `com.novaway.marketplace-smoke-v0.1.0`, `com.novaway.marketplace-smoke-v0.1.1`, `com.novaway.marketplace-capability-smoke-v0.1.0`, `com.novaway.marketplace-capability-smoke-v0.2.2`, `com.novaway.marketplace-capability-smoke-v0.2.3`, `com.novaway.marketplace-capability-smoke-v0.4.3`

## Result

The core marketplace lifecycle and the expanded local and remote public-artifact capability gate pass. The v0.4.3 artifact is published, its catalog digest matches, and a real NovaWay install/discovery/activation test consumes Agent, Skill, Tool, Command, Interceptor, Provider, Office, Surface, Previewer, Super-Agent, MCP, Output Style, LSP, HTTP Route, Trigger, Fast Path, Routing Policy, Worker Type, Watchdog Policy, Channel, Lifecycle Hook, Publish Driver, Scheduler, Event Source and Storage contributions and verifies cleanup. All third-party contribution families advertised by the official catalog now have executable consumer evidence.

## Public release evidence

- Raw catalog: `https://raw.githubusercontent.com/NovaWay-AI/novaway-plugins/main/catalog/index.json`
- Release 0.1.1: `https://github.com/NovaWay-AI/novaway-plugins/releases/tag/com.novaway.marketplace-smoke-v0.1.1`
- Release 0.1.1 asset: `com.novaway.marketplace-smoke-0.1.1.zip`
- Release 0.1.1 size: `1878` bytes
- Release 0.1.1 SHA-256: `b003d4f13d09048d37b3460ceb91531fffbc06ae2023b8bc696924919e66c547`
- Release 0.1.0 remains available for downgrade/rollback testing.
- Capability Release v0.4.3: `https://github.com/NovaWay-AI/novaway-plugins/releases/tag/com.novaway.marketplace-capability-smoke-v0.4.3`.
- Capability v0.4.3 artifact: `16106` bytes, SHA-256 `7f9cc00cd13b076dd6bcce0651ac82c5d62592c68eb3fe7cba6b286fcdd9ba30`.

## Passed evidence

- Local catalog validation: `Validated 2 stable catalog entries`
- Local artifact build and digest validation.
- Public catalog fetch and NovaWay catalog parsing.
- Public Release asset download during the public lifecycle run.
- Public ZIP installation into NovaWay marketplace staging.
- SHA-256 verification against the public catalog.
- Plugin Host discovery: `marketplace-smoke`, status `installed`, no diagnostics.
- Public physical reinstall and rollback.
- Public version-change update `0.1.0 → 0.1.1`, rollback to `0.1.0`, and versioned uninstall.
- Local marketplace/host/skill/HTTP acceptance suite: `64 pass`, `0 fail`, `452 expect() calls`; the expanded archive suite adds `27 pass`, `0 fail`, `86 expect() calls`; the operation matrix suite adds `4 pass`, `0 fail`, `59 expect() calls`; the TUI suite adds `1010 pass`, `1 skip`, `0 fail`, `9887 expect() calls`.
- NovaWay, app, SDK, SDK-v2-latest, TUI, and plugin-api typechecks for the changed marketplace/API surfaces.
- Durable HTTP lifecycle operations now expose a shared multidimensional state matrix: installation status, activation status, consumer status, cleanup status, `requiresRestart`, phase, progress, error code, recovery hint, and one durable operation ID.
- The Web/Desktop shared marketplace UI polls and renders operation history; the TUI exposes the same history through `/marketplace`; the CLI exposes `novaway marketplace operations --json`. All three use the generated operation-history API rather than local lifecycle state.
- Marketplace v2 activation accepts Claude/NovaWay directory Skill declarations such as `contributes.skills: ["./skills"]`, safely expands `SKILL.md` files, and is covered by the immutable public Release test.
- Public expanded capability acceptance: `1 pass`, `0 fail`, `93 expect() calls`; the test downloads the immutable v0.4.3 artifact, verifies catalog metadata and digest, installs it through `Marketplace.installZip`, discovers/activates it with Plugin Host v2, executes representative consumers for every published contribution family, and verifies deactivation cleanup.
- Artifact security tests cover HTTPS/private-DNS checks, bounded manual redirects, final response-host validation, decompressed-byte limits, central-directory duplicate-entry rejection, unsupported POSIX node types, independent duplicate-content extraction (no hardlinks), path traversal, and ZIP symlink rejection.
- The immutable public Release cold-start test downloads Release `com.novaway.marketplace-smoke-v0.1.1`, verifies size `1878` and SHA-256 `b003d4f13d09048d37b3460ceb91531fffbc06ae2023b8bc696924919e66c547`, installs it into an isolated XDG marketplace, starts a fresh NovaWay process, discovers and enables `marketplace-smoke`, and consumes its real Skill: `1 pass`, `12 expect() calls`.
- The immutable public Release cold-start evidence is recorded in `docs/plugin-marketplace-public-cold-start-evidence-2026-11-16.json`.
- The expanded immutable capability evidence is recorded in `docs/plugin-marketplace-capability-evidence-2026-11-16.json`; it covers the v0.4.3 Agent, Skill, Tool, Command, Interceptor, Provider, Office, Surface, Previewer, Super-Agent, declarative, Publish Driver, Scheduler and Event Source registration, representative execution, lifecycle release, and successful remote publish verification (`44004904185`).

## Acceptance gates closed

- Core cross-client lifecycle evidence is closed for Web and Desktop (shared app surface), TUI (`/marketplace`), and CLI (`novaway marketplace operations`). All clients consume the same durable operation-history API and render phase, installation, activation, consumer, cleanup, restart, progress, failure, and recovery metadata.
- The operation state model is multidimensional rather than a single overloaded enum. It persists `draining`, `cleanup-pending`, `deactivating`, `disabled-pending-restart`, disposal/cleanup outcome, and recovery metadata across cold starts.
- Final-host redirect validation, duplicate-entry and POSIX-node corpus, independent-file hardlink regression, decompression limits, ZIP traversal, and symlink checks pass.
- Fresh-process evidence uses the immutable public Release artifact, not a local fixture. The test verifies the published byte count and digest before Plugin Host discovery, v2 activation, and real Skill consumption.
- A controlled Chromium flow now passes discovery, official-source rendering, search/category/source filtering, detail and permission display, NovaWay/Claude/ZCode source add/edit/enable/disable/refresh/remove, source preflight success/failure, install in-progress staging and completion, update, rollback, uninstall, failed-install recovery, source removal with installed-package retention, offline cached-catalog error display, an independent empty catalog tab, long-text no-overflow layout, verified source metadata, and Installed extension enable/disable. Evidence is recorded in `docs/plugin-marketplace-browser-evidence-2026-11-16.json`.
- External remote CI: workflow run `43900469421` on commit `0c0ca142a5a07e88499d0db0e4d476b690ac4036` completed successfully. Job `133415356749` passed SDK regeneration, workspace/App SDK synchronization, Chromium dependency installation, and the controlled marketplace browser gate; artifact `plugin-marketplace-browser-1` (`14239984646`, 203240 bytes) was retained for 14 days.

## Remaining acceptance gates

- The v0.4.3 official publish workflow passed: run `44004904185` on commit `bcd6d43d5d77a829c560560a1665f43d8aa49223` verified the immutable all-capability asset and catalog digest.
- All contribution families currently advertised by `NovaWay Official Plugins` have an official artifact and public consumer evidence.
- Future archive formats, signing, mirrors, or frontend-specific workflows still require their own consumer and regression evidence.
