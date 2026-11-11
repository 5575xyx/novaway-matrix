import { describe, expect, it } from "bun:test"
import { resolveEditorPath, resolveWindowsCommand, type EditorDefinition, type EditorSystem } from "./editors"

describe("external editor discovery", () => {
  it("resolves an installed macOS app bundle without reading editor settings", async () => {
    const editor: EditorDefinition = {
      id: "vscode",
      name: "Visual Studio Code",
      commands: {},
      applications: ["Visual Studio Code"],
    }
    const system: EditorSystem = {
      platform: "darwin",
      home: "/Users/test",
      env: {},
      exists: async (path) => path === "/Applications/Visual Studio Code.app",
      findCommand: async () => undefined,
    }
    expect(await resolveEditorPath(editor, system)).toBe("/Applications/Visual Studio Code.app")
  })

  it("resolves executable candidates from PATH and PATHEXT", () => {
    const found = resolveWindowsCommand(
      "code.cmd",
      {
        PATH: "C:\\Apps;C:\\Windows",
        PATHEXT: ".EXE;.CMD",
      },
      (path) => path === "C:\\Apps\\code.cmd",
    )
    expect(found).toBe("C:\\Apps\\code.cmd")
  })

  it("handles Windows paths when tests run on another platform", () => {
    const found = resolveWindowsCommand(
      "Code.exe",
      {
        PATH: "C:\\Program Files\\Editor;C:\\Windows",
        PATHEXT: ".EXE;.CMD",
      },
      (path) => path === "C:\\Program Files\\Editor\\Code.exe",
    )
    expect(found).toBe("C:\\Program Files\\Editor\\Code.exe")
  })

  it("returns no path when no allowed executable exists", () => {
    const found = resolveWindowsCommand(
      "unknown.exe",
      {
        PATH: "C:\\Apps",
        PATHEXT: ".EXE;.CMD",
      },
      () => false,
    )
    expect(found).toBeUndefined()
  })
})
