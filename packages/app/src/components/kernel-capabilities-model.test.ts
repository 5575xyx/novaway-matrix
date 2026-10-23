import { describe, expect, test } from "bun:test"
import {
  activeFeatures,
  featureDetail,
  featureLabel,
  orderFeatures,
  summarize,
  type Capability,
} from "./kernel-capabilities-model"

const caps = (input: Partial<Capability> = {}): Capability => ({
  version: "1.0.0",
  tools: { total: 70, deferred: 12, readOnly: 5 },
  skills: 76,
  hooks: { registrations: 3, events: 2 },
  extensions: { total: 2, enabled: 2, contributions: 9 },
  features: [],
  ...input,
})

// Stand-in translator: returns the key when there is no translation.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars
    ? `${key}:${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}`
    : key

describe("kernel capabilities model", () => {
  test("summarizes counts, including deferred tools", () => {
    const summary = summarize(caps(), t)
    expect(summary.version).toBe("1.0.0")
    expect(summary.tools).toBe("settings.kernel.toolsDeferred:count=70,deferred=12")
    expect(summary.hooks).toBe("settings.kernel.hooks:count=3,events=2")
  })

  test("says so when no hooks are registered", () => {
    const summary = summarize(caps({ hooks: { registrations: 0, events: 0 } }), t)
    expect(summary.hooks).toBe("settings.kernel.hooksNone")
  })

  test("orders known features first and keeps unknown ones visible", () => {
    const ordered = orderFeatures([
      { id: "custom_thing", enabled: true },
      { id: "async_sources", enabled: true },
      { id: "permission_mode", enabled: true },
    ])
    expect(ordered.map((item) => item.id)).toEqual(["permission_mode", "async_sources", "custom_thing"])
  })

  test("featureLabel falls back to the raw id for unknown features", () => {
    expect(featureLabel("permission_mode", (key) => key)).toBe("permission_mode")
    expect(featureLabel("permission_mode", () => "权限模式")).toBe("权限模式")
  })

  test("formats large budgets and leaves small details alone", () => {
    expect(featureDetail({ id: "tool_result_budget", enabled: true, detail: "60000" })).toBe("60k")
    expect(featureDetail({ id: "tool_result_budget", enabled: true, detail: "800" })).toBe("800")
    expect(featureDetail({ id: "permission_mode", enabled: true, detail: "plan" })).toBe("plan")
    expect(featureDetail({ id: "teams", enabled: true })).toBeUndefined()
  })

  test("activeFeatures hides disabled capabilities", () => {
    const list = activeFeatures([
      { id: "defer_loading", enabled: false },
      { id: "teams", enabled: true },
    ])
    expect(list.map((item) => item.id)).toEqual(["teams"])
  })
})
