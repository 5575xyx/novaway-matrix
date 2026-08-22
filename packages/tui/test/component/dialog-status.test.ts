import { describe, expect, test } from "bun:test"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { statusPlugins } from "../../src/component/dialog-status"

describe("statusPlugins", () => {
  test("shows the configured PowersNexus plugin in status", () => {
    expect(statusPlugins(["PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"])).toEqual([
      {
        name: "PowersNexus",
        version: "git+https://gitee.com/nova-way/powersnexus.git",
      },
    ])
  })

  test("uses the containing directory for file plugin index entrypoints", () => {
    const file = pathToFileURL(path.join("C:\\plugins", "demo-plugin", "index.ts")).href
    expect(statusPlugins([file])).toEqual([{ name: "demo-plugin" }])
  })
})
