import { describe, expect, test } from "bun:test"
import type { Instance } from "../../src/plugin/host"
import { PluginCatalog } from "../../src/plugin/catalog"

function instance(input: {
  id: string
  scope?: Instance["scope"]
  status?: Instance["status"]
  origin?: Instance["origin"]
  adapter?: Instance["adapter"]
  contributes?: Instance["manifest"]["contributes"]
}): Instance {
  return {
    id: input.id,
    status: input.status ?? "installed",
    scope: input.scope ?? "project",
    origin: input.origin ?? "extension",
    adapter: input.adapter ?? "legacy-extension",
    manifest: {
      name: input.id,
      apiVersion: 2,
      contributes: input.contributes ?? {},
    },
    location: { kind: "directory", root: `/plugins/${input.id}`, label: "project" },
    issues: [],
    diagnostics: [],
    contributions: 0,
  }
}

describe("PluginCatalog", () => {
  test("normalizes legacy Extension declarations through the shared registry", () => {
    const plugin = instance({ id: "old-tools" })
    const entries = PluginCatalog.list([plugin], undefined, [
      { extension: "old-tools", root: "/plugins/old-tools", kind: "tool", path: "tools/search.ts" },
      { extension: "old-tools", root: "/plugins/old-tools", kind: "hook", path: "hooks/hooks.json" },
    ])

    expect(entries.map((item) => [item.kind, item.name, item.path])).toEqual([
      ["tool", "old-tools_search", "tools/search.ts"],
      ["interceptor", "old-tools_hooks", "hooks/hooks.json"],
    ])
  })

  test("indexes TUI exports from static package metadata without loading plugin code", () => {
    const plugin = instance({ id: "tui-package", origin: "tui", adapter: "legacy-tui" })
    plugin.location = { kind: "spec", spec: "tui-package", declaredBy: "tui.json", tui: true }

    const declarations = PluginCatalog.tuiContribution(
      plugin,
      { exports: { "./tui": { import: "./dist/tui.js" } } },
      "/plugins/tui-package",
    )
    expect(declarations).toEqual([
      {
        extension: "tui-package",
        root: "/plugins/tui-package",
        kind: "surface",
        name: "tui",
        path: "dist/tui.js",
      },
    ])
    expect(PluginCatalog.list([plugin], undefined, declarations)).toMatchObject([
      { pluginID: "tui-package", kind: "surface", name: "tui-package_tui", adapter: "legacy-tui" },
    ])
    expect(
      PluginCatalog.tuiContribution(plugin, { exports: { "./tui": "../outside.js" } }, "/plugins/tui-package"),
    ).toEqual([])
  })

  test("preserves previewer dispatch metadata from declarative manifests", () => {
    const plugin = instance({
      id: "preview",
      contributes: {
        previewers: [
          {
            id: "foo-preview",
            match: { extension: [".foo"] },
            viewId: "novaway.office.file",
            priority: 100,
            readOnly: false,
          },
        ],
      },
    })

    expect(PluginCatalog.list([plugin], { kind: "previewer" })).toMatchObject([
      {
        pluginID: "preview",
        kind: "previewer",
        name: "preview_foo-preview",
        localName: "foo-preview",
        match: { extension: [".foo"] },
        viewId: "novaway.office.file",
        priority: 100,
        readOnly: false,
      },
    ])
  })

  test("filters legacy declarations using the same kind and slot query", () => {
    const plugin = instance({ id: "legacy" })
    const entries = PluginCatalog.list([plugin], { kind: "tool" }, [
      { extension: "legacy", root: "/plugins/legacy", kind: "tool", path: "tools/search.ts" },
      { extension: "legacy", root: "/plugins/legacy", kind: "command", path: "commands/run.ts" },
    ])

    expect(entries.map((item) => item.kind)).toEqual(["tool"])
    expect(
      PluginCatalog.list([plugin], { slot: "sidebar.item" }, [
        {
          extension: "legacy",
          root: "/plugins/legacy",
          kind: "tool",
          path: "tools/search.ts",
        },
      ]),
    ).toEqual([])
  })
})
