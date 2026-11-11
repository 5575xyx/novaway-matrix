import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigPlugins } from "@/config/plugins"

/**
 * §12.3 的 `plugins` 命名空间：配置文件里的「这台机器怎么用这批插件」。
 *
 * 纯 Schema + 三个取值函数，所以直接 decode，不用起 config 的 Effect 测试壳。
 */

const decode = Schema.decodeUnknownSync(ConfigPlugins.Info)

describe("plugins 配置命名空间", () => {
  test("文档里那段示例原样能解", () => {
    const info = decode({
      disabled: ["noisy-plugin"],
      config: { acme: { apiKey: "…", region: "cn" } },
      overrides: { acme: { priority: 10 } },
    })
    expect(ConfigPlugins.isDisabled(info, "noisy-plugin")).toBe(true)
    expect(ConfigPlugins.isDisabled(info, "acme")).toBe(false)
    expect(ConfigPlugins.options(info, "acme")).toEqual({ apiKey: "…", region: "cn" })
    expect(ConfigPlugins.priority(info, "acme")).toBe(10)
  })

  test("priority 不收负数与小数：§4.9 的权重是「越大越前」，负数只会让诊断页更难解释", () => {
    expect(() => decode({ overrides: { acme: { priority: -1 } } })).toThrow()
    expect(() => decode({ overrides: { acme: { priority: 1.5 } } })).toThrow()
  })

  test("整段没写时三个取值都回默认，模式由 Host 自己按 env 决定", () => {
    const info = decode({})
    expect(ConfigPlugins.isDisabled(info, "acme")).toBe(false)
    expect(ConfigPlugins.options(info, "acme")).toBeUndefined()
    expect(ConfigPlugins.priority(info, "acme")).toBeUndefined()
  })

  test("设置里没写过这个插件时 options 是 undefined，不是空对象：插件侧要分得清「没配」和「配成空」", () => {
    const info = decode({ config: { acme: { region: "cn" } } })
    expect(ConfigPlugins.options(info, "acme")).toEqual({ region: "cn" })
    expect(ConfigPlugins.options(info, "beta")).toBeUndefined()
  })

  test("disabled 里重复同一个 id 不改变语义", () => {
    const info = decode({ disabled: ["acme", "acme"] })
    expect(ConfigPlugins.isDisabled(info, "acme")).toBe(true)
  })
})
