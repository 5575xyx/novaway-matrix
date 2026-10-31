import { describe, expect, test } from "bun:test"
import { findBuiltinExtension } from "@/components/builtin-extensions-data"
import { OFFICE_PLUGINS, officePluginEntries, officeSuggestedItems } from "./office-plugins"

describe("office plugins", () => {
  test("每个插件都落在真实存在的内置扩展上", () => {
    for (const plugin of OFFICE_PLUGINS) {
      expect(findBuiltinExtension(plugin.id)).toBeDefined()
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
    expect(office.length).toBeGreaterThan(0)
    expect(office.length).toBeLessThan(all.length)
    const enabledOnly = officeSuggestedItems("zh", { onlyEnabled: (id) => id !== "documents" })
    expect(enabledOnly.some((item) => item.pluginID === "documents")).toBe(false)
    expect(enabledOnly.length).toBe(all.length - OFFICE_PLUGINS.find((p) => p.id === "documents")!.prompts.length)
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

  test("财务提示词只在财务职业下出现", () => {
    const general = officeSuggestedItems("zh", { occupation: "general" })
    const finance = officeSuggestedItems("zh", { occupation: "finance" })
    expect(general.some((item) => item.category === "finance")).toBe(false)
    expect(finance.some((item) => item.category === "finance")).toBe(true)
  })

  test("财务职业把财务组排在最前，其余条目一条不少", () => {
    const general = officeSuggestedItems("zh", { occupation: "general" })
    const finance = officeSuggestedItems("zh", { occupation: "finance" })
    const financeCount = finance.filter((item) => item.category === "finance").length
    expect(financeCount).toBeGreaterThan(0)
    // 前 financeCount 条必须全是财务组
    expect(finance.slice(0, financeCount).every((item) => item.category === "finance")).toBe(true)
    // 财务组之外的内容和非财务职业完全一致（只换优先级，不换集合）
    expect(finance.slice(financeCount).map((item) => item.id)).toEqual(general.map((item) => item.id))
  })

  test("默认偏好不传职业时按通用处理", () => {
    expect(officeSuggestedItems("zh").map((item) => item.id)).toEqual(
      officeSuggestedItems("zh", { occupation: "general" }).map((item) => item.id),
    )
  })
})
