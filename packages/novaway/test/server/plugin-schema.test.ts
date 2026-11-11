import { describe, expect, test } from "bun:test"
import { contributionKinds } from "@novaway/plugin-api"
import { PluginContribution, PluginDiagnostic } from "../../src/server/routes/instance/httpapi/groups/plugin"

describe("plugin HTTP contribution schema", () => {
  test("accepts every contribution kind in contribution entries and diagnostics", () => {
    for (const kind of contributionKinds) {
      const entry = {
        pluginID: "fixture",
        kind,
        name: `fixture_${kind}`,
        localName: kind,
        scope: "project" as const,
        origin: "extension" as const,
        adapter: "v2" as const,
        status: "installed" as const,
      }
      expect(PluginContribution.make(entry).kind).toBe(kind)
      expect(
        PluginDiagnostic.make({
          pluginID: "fixture",
          scope: "project",
          severity: "info",
          code: "contribution.declared",
          message: `declared ${kind}`,
          contribution: { kind, name: entry.name, localName: kind, status: "installed" },
        }).contribution?.kind,
      ).toBe(kind)
    }
  })
})
