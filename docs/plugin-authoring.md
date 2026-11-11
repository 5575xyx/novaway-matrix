# Plugin authoring (M0)

NovaWay Plugin Manifest is the only native plugin format; `apiVersion: 2` identifies its current schema, not a parallel format. Claude plugins are supported through input normalization. Existing NovaWay Extension, config, and TUI inputs are temporary development bridges, to be removed as their consumers enter the unified Host. The current Host still discovers and validates rather than activating plugin code; the activation resource owner is an independently tested runtime component, not yet a connected Host execution path.

## Manifest

The canonical TypeScript contract is `packages/plugin-api/src/manifest.ts`, exported from `packages/plugin-api/src/index.ts`. Runtime parsing and legacy normalization are implemented in `packages/novaway/src/plugin/manifest.ts`; keep this guide and the fixture in `packages/plugin-api/test/fixture/declarative/plugin.json` aligned with those definitions.

A minimal declarative plugin manifest:

```json
{
  "name": "example-weather",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "declarative",
  "contributes": {
    "tools": [
      {
        "id": "weather",
        "description": "Get a weather report",
        "parameters": { "type": "object", "properties": {} }
      }
    ]
  }
}
```

`name` must use lowercase letters, digits, hyphens, or underscores, and start with a letter or digit. `apiVersion` must be supported by the host. `contributes` uses the keys exported as `contributesKeys` by `@novaway/plugin-api`; declarations are statically indexed without importing the plugin entrypoint. Per-item entries (such as tools and commands) appear in `/plugin/contributions` and as contribution metadata in `/plugin/diagnostics`. `lifecycleHooks` and `storage` are plugin-level settings, not named registry entries; their validity is reported as manifest issues instead. `scheduler` and `event-source` are runtime registry kinds reserved by the Super-Agent API and are not M0 static manifest declarations.

## Code plugins and capabilities

Code plugins with a `main` entry export `activate(api)`; plugins made only of per-tool `entry` modules may omit `main`, and the Host imports each entry factory only after its `activationEvents` match. Static tool schemas can be discovered before activation, but they do not mean executable code is loaded or callable. Capability declarations do not imply that M0 executes the plugin or grants those capabilities. Runtime activation, permissions, and lifecycle guarantees must not be inferred from successful discovery or a visible contribution.

## Compatibility inputs

- Extension packages and Claude plugin manifests are normalized from their manifest files.
- `novaway.json` `plugin` entries become `legacy-config-plugin` instances; their runtime contributions require the legacy loader.
- TUI `plugin` entries are represented as `legacy-tui` instances; their static TUI exports are indexed without executing the TUI entrypoint.

Use `/plugin`, `/plugin/contributions`, and `/plugin/diagnostics` to inspect discovered instances, indexed declarations, and validation issues. Diagnostics include statically indexed contribution kind/name/status metadata; they do not report runtime registration collisions because M0 does not activate plugin code. A listed plugin is not necessarily active.

## Validation

Run `bun run verify:plugins` from `packages/novaway` for the M0 boundary, host/catalog, runtime-hook, storage, HTTP API, leak-smoke, and index-performance checks. Run `bun run typecheck` from the same package for TypeScript validation. The compatibility snapshot in `test/plugin/manifest.test.ts` protects normalized legacy declarations; it is not a comparison against a previously released runtime binary.
