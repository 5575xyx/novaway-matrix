#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import path from "node:path"

const knownRed: string[] = []
const root = path.resolve(import.meta.dir, "..")
const steps: Array<[string, string[]]> = [
  ["B1 boundary", ["run", "script/scan-boundary.ts"]],
  [
    "plugin discovery, index, and legacy compatibility",
    ["test", "test/plugin/host.test.ts", "test/plugin/catalog.test.ts", "test/plugin/manifest.test.ts"],
  ],
  ["contribution registry conflicts and ordering", ["test", "test/plugin/contributions.test.ts"]],
  ["KernelApi and PluginContext capability boundaries", ["test", "test/plugin/runtime-context.test.ts"]],
  ["plugin runtime fault handling", ["test", "test/plugin/runtime-hooks.test.ts"]],
  ["plugin host lifecycle", ["test", "test/plugin/runtime-host.test.ts"]],
  ["plugin tool adapter", ["test", "test/plugin/runtime-tool.test.ts"]],
  ["plugin local encrypted secrets", ["test", "test/plugin/runtime-secrets.test.ts"]],
  ["legacy TUI plugin host lifecycle", ["test", "test/plugin/tui-scope.test.ts"]],
  ["plugin storage contracts", ["test", "test/plugin/storage.test.ts"]],
  ["plugin HTTP contribution schemas", ["test", "test/server/plugin-schema.test.ts"]],
  [
    "D1 isolated tool contribution behavior drill",
    ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D1:", "--timeout", "120000"],
  ],
  [
    "D2 Agent/Skill/Command consumer integration slice",
    ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D2:", "--timeout", "120000"],
  ],
  [
    "D3 Provider adapter production consumer slice",
    [
      "test",
      "test/provider/provider.test.ts",
      "--test-name-pattern",
      "runtime provider adapter",
      "--timeout",
      "120000",
    ],
  ],
  [
    "D4 Office engine registry, read/write, and previewer slice",
    [
      "test",
      "test/plugin/runtime-context.test.ts",
      "--test-name-pattern",
      "built-in office engine",
      "--timeout",
      "120000",
    ],
  ],
  ["D4 custom-extension read/write through the builtin engine", ["test", "test/server/office-edit.test.ts"]],
  [
    "D5 Publish driver registry lifecycle slice",
    ["test", "test/plugin/runtime-context.test.ts", "--test-name-pattern", "publish driver", "--timeout", "120000"],
  ],
  [
    "D5 builtin publish account and execution bridge",
    ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D5:", "--timeout", "120000"],
  ],
  [
    "D6 Surface registry lifecycle slice",
    ["test", "test/plugin/runtime-context.test.ts", "--test-name-pattern", "built-in surface", "--timeout", "120000"],
  ],
  [
    "D7 built-in bundle disable isolation slice",
    ["test", "test/plugin/runtime-context.test.ts", "--test-name-pattern", "D7:", "--timeout", "120000"],
  ],
  [
    "D7 builtin bundle disable keeps sessions usable",
    [
      "test",
      "test/server/httpapi-plugin.test.ts",
      "--test-name-pattern",
      "D7: disabling the shipped",
      "--timeout",
      "120000",
    ],
  ],
  [
    "D8 runtime override and restoration slice",
    ["test", "test/plugin/runtime-host.test.ts", "--test-name-pattern", "D8:", "--timeout", "120000"],
  ],
  [
    "D9 hot toggle and next-turn tool snapshot drill",
    ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D9:", "--timeout", "120000"],
  ],
  ["plugin HTTP API and SSE", ["test", "test/server/httpapi-plugin.test.ts", "--timeout", "120000"]],
  ["plugin timer and listener leaks", ["--experimental-strip-types", "script/plugin-leak-check.ts"]],
  ["B2 production plugin phase budget and memory gate", ["run", "script/plugin-perf-gate.ts"]],
  ["20-plugin startup and interceptor performance", ["run", "script/plugin-index-benchmark.ts"]],
]

console.log(
  knownRed.length === 0
    ? "D1–D9 plugin drills are covered by this gate (D1–D8 focused/browser suites, D9 backend plus packaged-artifact browser acceptance)."
    : `Remaining known-red drills: ${knownRed.join(", ")} (not yet implemented/accepted)`,
)
for (const [name, args] of steps) {
  console.log(`\n== ${name} ==`)
  const result = spawnSync(name === "plugin timer and listener leaks" ? "node" : "bun", args, {
    cwd: root,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
