# NovaWay Plugin Marketplace UI/UX Specification

**Status:** implementation specification
**Scope:** Web/Desktop marketplace surfaces backed by the shared marketplace API
**Last updated:** 2026-11-16

## 1. Product goal

NovaWay's marketplace is an extension discovery and lifecycle product, not a download list or a settings table. A user must be able to answer these questions without opening a terminal:

1. What can this extension do?
2. Who publishes it and which source vouches for it?
3. What permissions and runtime capabilities will it receive?
4. Is it compatible with this NovaWay installation?
5. Is it installed, active, updating, draining, failed, or ready to retry?
6. What happened if the operation did not finish?

The UI must never represent a downloaded artifact as usable until Plugin Host discovery, manifest validation, activation, and consumer registration have succeeded.

## 2. Observable patterns from modern AI extension products

The following patterns are product-level observations from ZCode/Qoder/Codex/Claude Code-style extension experiences and the public Lexora project, rather than claims about private implementation details:

- **Discovery first:** a prominent marketplace entry point, search, categories, curated/recommended results, and an installed view.
- **Cards as scan units:** icon, name, short description, publisher/source, trust marker, version, capability/category tags, and one primary action.
- **Details on demand:** a drawer, modal, or expandable card exposes release notes, compatibility, permissions, capabilities, digest, and source URL without making the directory unreadable.
- **Stateful primary actions:** Install, Installing, Installed, Update, Roll back, Remove, Retry, and restart-required are distinct states, not one generic button.
- **Trust before action:** official/verified/community/unverified status is visible before installation, while permission disclosure is close to the install action.
- **Operations are observable:** long-running actions show progress and durable history; errors explain recovery rather than disappearing into a toast.
- **Source management is secondary:** sources can be configured and maintained, but source administration does not displace discovery from the main content area.
- **Responsive density:** desktop uses a grid of cards; narrow layouts collapse to one column while preserving complete descriptions and accessible actions.

NovaWay adopts these patterns while retaining its stronger lifecycle guarantee: download success is only one phase in a durable install transaction.

## 3. Information architecture

### 3.1 Marketplace shell

1. **Hero/header**
   - Marketplace identity and purpose.
   - Installed count, catalog count, active source count, and update count.
   - Refresh action with loading state.
2. **Source administration**
   - Add/edit source form.
   - Source type: NovaWay, Claude, ZCode, or auto.
   - Enable/disable, refresh/preflight, edit, and remove.
   - Removing a source must not remove installed packages.
3. **Catalog navigation**
   - NovaWay, ZCode, and Claude tabs with counts.
   - Search, category, source, and sort controls.
4. **Durable operation history**
   - Recent install/update/rollback/enable/disable/uninstall/migrate operations.
   - Phase, progress, multidimensional status, restart requirement, error code, and recovery hint.
5. **Results grid**
   - Responsive extension cards.
   - Empty, offline-cache, and error states.
6. **Installed extension view**
   - Active/inactive state and enable/disable controls.
   - Consumer readiness and lifecycle status must come from the backend.

### 3.2 Card contract

Every catalog card should expose, when available:

- extension icon and display name;
- version;
- publisher/source;
- verified, community, or unverified status;
- short description;
- up to three category tags;
- installed/update state;
- primary lifecycle action;
- details action.

The card must have a stable `data-component="market-entry"` hook and expose source/trust as machine-readable attributes for browser acceptance tests and diagnostics.

### 3.3 Details contract

Details must include:

- long description and release notes;
- author and license;
- categories and keywords;
- runtime targets and compatibility range;
- capabilities and permissions;
- artifact kind, repository/source, version/ref/subdirectory;
- SHA-256 when supplied;
- `requiresRestart` and any activation limitation;
- current operation progress/error/recovery information where relevant.

Details are explanatory UI, not an authorization bypass. Installation still uses the secure backend transaction and confirmation rules.

## 4. Lifecycle state presentation

The UI uses separate dimensions because installation and activation are not equivalent:

| Backend state                     | User-facing meaning                      | Primary action     |
| --------------------------------- | ---------------------------------------- | ------------------ |
| `absent`                          | Not installed                            | Install            |
| `staging` / `validating`          | Preparing and checking package           | Installing…        |
| `installed` + `active` + `usable` | Ready and consumable                     | Remove / Update    |
| `updating`                        | Replacing an existing revision           | Updating…          |
| `draining`                        | Old runtime is shutting down safely      | Updating…          |
| `failed`                          | Transaction or activation failed         | Retry / View error |
| `disabled`                        | Installed but intentionally inactive     | Enable / Remove    |
| `disabled-pending-restart`        | Change waits for restart                 | Restart required   |
| `cleanup-pending`                 | Main operation finished; cleanup remains | View operation     |

A card may show more than one tag, but the primary button must reflect the highest-priority actionable state. The renderer must not infer `usable` from an installed record alone.

## 5. Interaction rules

### Search and filters

- Search matches name, package ID, description, long description, keywords, and categories.
- Category, source, and sort controls work independently and preserve the selected tab.
- Switching tabs must not expose a stale source option as an accidental empty result; the selected filter should be reset or visibly explain the empty state.
- Empty results must explain that the filter can be cleared.

### Installation

1. User opens details and reviews source, trust, runtime, capabilities, permissions, and digest.
2. User selects Install or Update.
3. UI immediately shows the durable operation phase.
4. UI polls/shared-subscribes to backend operation history until completion or failure.
5. Completion is shown only after discovery, activation, and real consumer registration report success.
6. Failure shows error code and recovery hint and leaves a retryable operation record.

### Source management

- Built-in official sources cannot be removed.
- Custom source removal removes future catalog availability only; installed packages remain.
- Refresh/preflight errors remain attached to the source and are distinguishable from an offline cached catalog.
- Source trust is displayed on cards and detail content.

### Updates and rollback

- Update actions may show a confirmation when source, permissions, dependencies, conflicts, or digest changes.
- Rollback is available only when a physical previous revision exists.
- A rollback result is a lifecycle operation, not a local optimistic version swap.

## 6. Accessibility and responsive behavior

- All controls have accessible names; icon-only controls have a title/label.
- Search and every select are keyboard reachable and have stable labels.
- Trust is conveyed by text and not color alone; the shield icon is supplemental.
- Focus remains on the triggering control after details expansion and operation refresh.
- Long descriptions, digests, URLs, and source errors wrap without horizontal overflow.
- Cards use one column on narrow layouts, two columns at small desktop widths, and three columns where space permits.
- Status changes are available to screen readers through existing semantic text and operation history; transient toasts are not the sole error channel.

## 7. Component and API boundaries

The App component owns presentation, filtering, and interaction dispatch only. The shared SDK/API owns:

- source persistence and preflight records;
- catalog snapshots and offline cache metadata;
- secure artifact fetching and extraction;
- staging, backup, atomic replacement, rollback, and crash recovery;
- Plugin Host discovery and manifest validation;
- v2 activation/deactivation/disposal;
- consumer registration and readiness;
- durable operation history.

The App must not duplicate lifecycle state or declare an extension usable from a renderer-only flag. Web, Desktop, TUI, and CLI consume the same operation schema.

## 8. Browser acceptance matrix

The Chromium gate must cover at least:

- hero, tabs, search, category, source, and sort controls;
- verified/source metadata on a card;
- details with permissions, compatibility, runtime, and SHA-256;
- install progress from staging to completed;
- failed install and retry;
- update confirmation, rollback, uninstall, and enable/disable;
- source add/edit/disable/enable/refresh/preflight/remove;
- source removal preserving an installed package;
- offline cached catalog error;
- empty catalog and long-text no-overflow behavior;
- operation history with error and recovery details.

Evidence must record the exact command, browser/project, pass/fail count, and whether it ran locally or in external CI. Local CI-equivalent execution is not evidence of a remote CI pass.
