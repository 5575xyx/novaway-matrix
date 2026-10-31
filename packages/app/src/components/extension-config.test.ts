import { describe, expect, test } from "bun:test"
import { BUILTIN_EXTENSIONS } from "./builtin-extensions-data"
import { extensionConfigPatch, extensionEnabled, type ExtensionConfigView } from "./extension-config"

const skill = BUILTIN_EXTENSIONS.find((item) => item.id === "documents")!
const browser = BUILTIN_EXTENSIONS.find((item) => item.id === "browser-use")!
const computer = BUILTIN_EXTENSIONS.find((item) => item.id === "computer-use")!

describe("extensionEnabled", () => {
  test("技能型扩展默认开，出现在 skills.disabled 里才算关", () => {
    expect(extensionEnabled({}, skill)).toBe(true)
    expect(extensionEnabled({ skills: { disabled: ["office-document"] } }, skill)).toBe(false)
    // 别的技能被关掉不影响这个扩展
    expect(extensionEnabled({ skills: { disabled: ["office-ppt"] } }, skill)).toBe(true)
  })

  test("浏览器默认开，只有显式 enabled:false 才关", () => {
    expect(extensionEnabled({}, browser)).toBe(true)
    expect(extensionEnabled({ browser: { enabled: false } }, browser)).toBe(false)
    expect(extensionEnabled({ browser: { enabled: true } }, browser)).toBe(true)
  })

  test("电脑控制默认关，必须显式打开", () => {
    expect(extensionEnabled({}, computer)).toBe(false)
    expect(extensionEnabled({ experimental: { computer_control: true } }, computer)).toBe(true)
  })
})

describe("extensionConfigPatch", () => {
  test("开关技能只改对应的技能名，保留其它已关闭项", () => {
    const config: ExtensionConfigView = { skills: { disabled: ["office-ppt", "wxgzh-ops"] } }
    const off = extensionConfigPatch(config, skill, false) as { skills: { disabled: string[] } }
    expect(new Set(off.skills.disabled)).toEqual(new Set(["office-ppt", "wxgzh-ops", "office-document"]))
    const on = extensionConfigPatch(off as ExtensionConfigView, skill, true) as { skills: { disabled: string[] } }
    expect(new Set(on.skills.disabled)).toEqual(new Set(["office-ppt", "wxgzh-ops"]))
  })

  test("补丁能把自己读回来", () => {
    const off = extensionConfigPatch({}, browser, false) as ExtensionConfigView
    expect(extensionEnabled(off, browser)).toBe(false)
    const on = extensionConfigPatch(off, browser, true) as ExtensionConfigView
    expect(extensionEnabled(on, browser)).toBe(true)
  })
})
