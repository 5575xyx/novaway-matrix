import { describe, expect, test } from "bun:test"
import { findBuiltinExtension } from "@/components/builtin-extensions-data"
import { OFFICE_PLUGINS, officePluginEntries, officeSuggestedItems } from "./office-plugins"

describe("office plugins", () => {
  test("已迁出的办公扩展不再伪装为内置能力", () => {
    const removed = [
      "documents",
      "presentations",
      "spreadsheets",
      "visualize",
      "design",
      "knowledge",
      "meetings",
      "tasks",
      "communication",
    ]
    for (const id of removed) {
      expect(findBuiltinExtension(id)).toBeUndefined()
      expect(officePluginEntries().some((entry) => entry.plugin.id === id)).toBe(false)
      expect(officeSuggestedItems("zh").some((item) => item.pluginID === id)).toBe(false)
    }
  })

  test("每个插件至少有一条提示词，且中英文都齐", () => {
    for (const plugin of OFFICE_PLUGINS) {
      expect(plugin.prompts.length).toBeGreaterThan(0)
      for (const item of plugin.prompts) {
        expect(item.pluginID).toBe(plugin.id)
        expect(item.title.cn.length).toBeGreaterThan(0)
        expect(item.title.en.length).toBeGreaterThan(0)
        expect(item.prompt.cn.length).toBeGreaterThan(0)
        expect(item.prompt.en.length).toBeGreaterThan(0)
      }
    }
  })

  test("提示词 id 全局唯一", () => {
    const ids = OFFICE_PLUGINS.flatMap((plugin) => plugin.prompts.map((item) => item.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("分类过滤与 onlyEnabled 过滤互不干扰", () => {
    const all = officeSuggestedItems("zh")
    const office = officeSuggestedItems("zh", { category: "office" })
    expect(office).toEqual([])
    expect(all.length).toBeGreaterThan(0)
    const excluded = all[0]!.pluginID
    const enabledOnly = officeSuggestedItems("zh", { onlyEnabled: (id) => id !== excluded })
    expect(enabledOnly).toEqual(all.filter((item) => item.pluginID !== excluded))
  })

  test("按语言取文案", () => {
    const zh = officeSuggestedItems("zh")[0]!
    const en = officeSuggestedItems("en")[0]!
    expect(zh.label).not.toBe(en.label)
    expect(officeSuggestedItems("zht")[0]!.label).toBe(zh.label)
  })

  test("插件选择器能拿到扩展定义，且同一插件不会出现两次", () => {
    const entries = officePluginEntries("all")
    expect(entries.length).toBeGreaterThan(0)
    const ids = entries.map((entry) => entry.plugin.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of entries) expect(entry.extension.id).toBe(entry.plugin.id)
  })

  test("职业偏好不会重新启用已迁出的办公扩展", () => {
    const general = officeSuggestedItems("zh", { occupation: "general" })
    const finance = officeSuggestedItems("zh", { occupation: "finance" })
    expect(finance.some((item) => item.category === "finance")).toBe(false)
    expect(finance.map((item) => item.id)).toEqual(general.map((item) => item.id))
  })

  test("默认偏好不传职业时按通用处理", () => {
    expect(officeSuggestedItems("zh").map((item) => item.id)).toEqual(
      officeSuggestedItems("zh", { occupation: "general" }).map((item) => item.id),
    )
  })
})
