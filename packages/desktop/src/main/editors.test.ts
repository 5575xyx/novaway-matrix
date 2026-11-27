import { describe, expect, it } from "bun:test"
import {
  discoverGenericEditors,
  parseRegistryDefault,
  resolveEditorPath,
  resolveOfficeAppPath,
  resolveWindowsCommand,
  type EditorDefinition,
  type EditorSystem,
  type OfficeAppDefinition,
} from "./editors"

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

  it("discovers an editor installed through a Windows desktop shortcut", async () => {
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: {},
      exists: async (path) => path === "E:\\DevelopmentTool\\openidea\\openidea.exe",
      findCommand: async () => undefined,
      listShortcuts: async () => [
        { name: "OpenIDEA", target: "E:\\DevelopmentTool\\openidea\\openidea.exe" },
      ],
    }
    expect(await discoverGenericEditors(system)).toEqual([
      {
        id: expect.stringMatching(/^detected:/),
        name: "OpenIDEA",
        path: "E:\\DevelopmentTool\\openidea\\openidea.exe",
      },
    ])
  })

  it("discovers an unlisted editor executable from PATH", async () => {
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { PATH: "C:\\Tools" },
      exists: async (path) => path === "C:\\Tools\\AcmeEditor.exe",
      findCommand: async () => undefined,
      listFiles: async (path) =>
        path === "C:\\Tools"
          ? ["AcmeEditor.exe", "AcmeEditorUpdater.exe", "ByteCodeGenerator.exe", "UtcDecoderHost.exe", "editorconfig.exe"]
          : [],
    }
    const editors = await discoverGenericEditors(system)
    expect(editors).toEqual([
      {
        id: expect.stringMatching(/^detected:/),
        name: "AcmeEditor",
        path: "C:\\Tools\\AcmeEditor.exe",
      },
    ])
  })
})


describe("registry App Paths parsing", () => {
  it("reads the default value from Chinese and English reg output", () => {
    expect(parseRegistryDefault("\r\n    (默认)    REG_SZ    C:\\Office\\WINWORD.EXE\r\n")).toBe(
      "C:\\Office\\WINWORD.EXE",
    )
    expect(parseRegistryDefault("\r\n    (Default)    REG_SZ    C:\\Office\\EXCEL.EXE\r\n")).toBe(
      "C:\\Office\\EXCEL.EXE",
    )
  })

  it("strips surrounding quotes and rejects empty values", () => {
    expect(parseRegistryDefault('    (默认)    REG_SZ    "C:\\Program Files\\App\\wps.exe"')).toBe(
      "C:\\Program Files\\App\\wps.exe",
    )
    expect(parseRegistryDefault("错误: 系统找不到指定的注册表项或值。")).toBeUndefined()
    expect(parseRegistryDefault("    (默认)    REG_SZ    ")).toBeUndefined()
  })
})

describe("office app discovery", () => {
  const word: OfficeAppDefinition = {
    id: "word",
    name: "Microsoft Word",
    executable: "WINWORD.EXE",
    extensions: ["doc", "docx"],
    applications: ["Microsoft Word"],
    fallbackPaths: ["Microsoft Office/root/Office16/WINWORD.EXE"],
  }

  it("prefers the registered App Paths entry on Windows", async () => {
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { ProgramFiles: "C:\\Program Files" },
      exists: async (path) => path === "D:\\Office\\WINWORD.EXE",
      findCommand: async () => undefined,
      queryAppPath: async (exe) => (exe === "WINWORD.EXE" ? "D:\\Office\\WINWORD.EXE" : undefined),
    }
    expect(await resolveOfficeAppPath(word, system)).toBe("D:\\Office\\WINWORD.EXE")
  })

  it("falls back to the standard install layout when the registry misses", async () => {
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { ProgramFiles: "C:\\Program Files" },
      exists: async (path) => path === "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
      findCommand: async () => undefined,
      queryAppPath: async () => undefined,
    }
    expect(await resolveOfficeAppPath(word, system)).toBe(
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    )
  })

  it("resolves macOS app bundles", async () => {
    const system: EditorSystem = {
      platform: "darwin",
      home: "/Users/test",
      env: {},
      exists: async (path) => path === "/Applications/Microsoft Word.app",
      findCommand: async () => undefined,
    }
    expect(await resolveOfficeAppPath(word, system)).toBe("/Applications/Microsoft Word.app")
  })

  it("scans versioned WPS directories and picks the newest", async () => {
    const wps: OfficeAppDefinition = {
      id: "wps-word",
      name: "WPS 文字",
      executable: "wps.exe",
      extensions: ["docx"],
      versionedPaths: [
        { roots: ["LOCALAPPDATA"], prefix: "Kingsoft/WPS Office/", relative: "office6/wps.exe" },
      ],
    }
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      exists: async (path) => path.endsWith("12.1.0.21915\\office6\\wps.exe"),
      findCommand: async () => undefined,
      queryAppPath: async () => undefined,
      listDir: async (path) =>
        path === "C:\\Users\\test\\AppData\\Local\\Kingsoft\\WPS Office"
          ? ["11.8.2.12055", "12.1.0.21915"]
          : [],
    }
    expect(await resolveOfficeAppPath(wps, system)).toBe(
      "C:\\Users\\test\\AppData\\Local\\Kingsoft\\WPS Office\\12.1.0.21915\\office6\\wps.exe",
    )
  })
})

describe("versioned editor installs", () => {
  it("resolves OpenIDEA from a versioned user installation", async () => {
    const openidea: EditorDefinition = {
      id: "openidea",
      name: "OpenIDEA",
      commands: { win32: ["openidea.exe"] },
      fallbackPaths: { win32: ["Programs/OpenIDEA/OpenIDEA.exe"] },
      versionedPaths: [
        { roots: ["LOCALAPPDATA"], prefix: "Programs/OpenIDEA", relative: "bin/idea64.exe" },
      ],
    }
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      exists: async (path) => path.endsWith("OpenIDEA 2025.1\\bin\\idea64.exe"),
      findCommand: async () => undefined,
      queryAppPath: async () => undefined,
      listDir: async (path) =>
        path === "C:\\Users\\test\\AppData\\Local\\Programs"
          ? ["OpenIDEA 2024.3", "OpenIDEA 2025.1"]
          : [],
    }
    expect(await resolveEditorPath(openidea, system)).toBe(
      "C:\\Users\\test\\AppData\\Local\\Programs\\OpenIDEA 2025.1\\bin\\idea64.exe",
    )
  })

  it("resolves Zed from the standard per-user installation directory", async () => {
    const zed: EditorDefinition = {
      id: "zed",
      name: "Zed",
      commands: {},
      fallbackPaths: { win32: ["Programs/Zed/Zed.exe"] },
    }
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      exists: async (path) => path === "C:\\Users\\test\\AppData\\Local\\Programs\\Zed\\Zed.exe",
      findCommand: async () => undefined,
      queryAppPath: async () => undefined,
    }
    expect(await resolveEditorPath(zed, system)).toBe(
      "C:\\Users\\test\\AppData\\Local\\Programs\\Zed\\Zed.exe",
    )
  })

  it("resolves IntelliJ installations managed by JetBrains Toolbox", async () => {
    const idea: EditorDefinition = {
      id: "idea",
      name: "IntelliJ IDEA",
      commands: {},
      versionedPaths: [
        {
          roots: ["LOCALAPPDATA"],
          prefix: "JetBrains/Installations/IntelliJ IDEA",
          relative: "bin/idea64.exe",
        },
      ],
    }
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      exists: async (path) => path.endsWith("IntelliJ IDEA 2025.3\\bin\\idea64.exe"),
      findCommand: async () => undefined,
      queryAppPath: async () => undefined,
      listDir: async (path) =>
        path === "C:\\Users\\test\\AppData\\Local\\JetBrains\\Installations"
          ? ["IntelliJ IDEA 2024.3", "IntelliJ IDEA 2025.3"]
          : [],
    }
    expect(await resolveEditorPath(idea, system)).toBe(
      "C:\\Users\\test\\AppData\\Local\\JetBrains\\Installations\\IntelliJ IDEA 2025.3\\bin\\idea64.exe",
    )
  })

  it("finds JetBrains IDEs under Program Files with the newest version", async () => {
    const idea: EditorDefinition = {
      id: "idea",
      name: "IntelliJ IDEA",
      commands: {},
      versionedPaths: [{ roots: ["ProgramFiles"], prefix: "JetBrains/IntelliJ IDEA", relative: "bin/idea64.exe" }],
    }
    const system: EditorSystem = {
      platform: "win32",
      home: "C:\\Users\\test",
      env: { ProgramFiles: "C:\\Program Files" },
      exists: async (path) => path === "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe",
      findCommand: async () => undefined,
      listDir: async (path) =>
        path === "C:\\Program Files\\JetBrains" ? ["IntelliJ IDEA 2024.3", "IntelliJ IDEA 2025.2", "WebStorm 2025.2"] : [],
    }
    expect(await resolveEditorPath(idea, system)).toBe(
      "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe",
    )
  })
})
