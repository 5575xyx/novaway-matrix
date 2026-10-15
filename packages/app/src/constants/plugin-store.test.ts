import { describe, expect, test } from "bun:test"
import { normalizeSourceUrl, parsePluginCatalog } from "./plugin-store"

// 目录是**外部输入**（来自用户配置的市场源 URL），必须防御性解析：
// 缺 spec 的条目无法安装，直接丢弃；非法条目不能让整个列表爆掉。
describe("parsePluginCatalog", () => {
  test("保留合法条目并带出可选字段", () => {
    expect(
      parsePluginCatalog([
        { name: "example", spec: "example-plugin@1.2.3", description: "demo", author: "acme", tags: ["git", "ui"] },
      ]),
    ).toEqual([
      { name: "example", spec: "example-plugin@1.2.3", description: "demo", author: "acme", tags: ["git", "ui"] },
    ])
  })

  test("缺 spec 或类型不对的条目被丢弃", () => {
    const result = parsePluginCatalog([
      { name: "no-spec" },
      { spec: "" },
      { spec: 123 },
      null,
      "string",
      { spec: "ok@1.0.0" },
    ])
    expect(result.map((entry) => entry.spec)).toEqual(["ok@1.0.0"])
  })

  test("spec 重复时只保留第一条", () => {
    expect(parsePluginCatalog([{ spec: "a@1" }, { spec: "a@1" }])).toHaveLength(1)
  })

  test("name 缺失时回落到 spec", () => {
    expect(parsePluginCatalog([{ spec: "only-spec@1" }])[0]?.name).toBe("only-spec@1")
  })

  test("tags 里混入非字符串会被过滤", () => {
    expect(parsePluginCatalog([{ spec: "a@1", tags: ["x", 1, null, "y"] }])[0]?.tags).toEqual(["x", "y"])
  })

  test("整体不是数组时返回空", () => {
    expect(parsePluginCatalog({ spec: "a@1" })).toEqual([])
    expect(parsePluginCatalog(null)).toEqual([])
  })
})

describe("normalizeSourceUrl", () => {
  test("去掉尾部斜杠", () => {
    expect(normalizeSourceUrl("https://example.com/plugins/")).toBe("https://example.com/plugins")
  })

  test("只接受 http(s)，其余返回 undefined", () => {
    expect(normalizeSourceUrl("file:///etc/passwd")).toBeUndefined()
    expect(normalizeSourceUrl("ftp://example.com")).toBeUndefined()
    expect(normalizeSourceUrl("not a url")).toBeUndefined()
    expect(normalizeSourceUrl("   ")).toBeUndefined()
  })

  test("保留 http（内网源自建场景）", () => {
    expect(normalizeSourceUrl("http://127.0.0.1:8080/catalog.json")).toBe("http://127.0.0.1:8080/catalog.json")
  })
})
