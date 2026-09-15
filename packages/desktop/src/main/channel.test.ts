import { describe, expect, test } from "bun:test"

import { resolveChannel } from "./channel"

describe("resolveChannel", () => {
  test("识别构建期注入的三个合法值", () => {
    expect(resolveChannel("dev")).toBe("dev")
    expect(resolveChannel("beta")).toBe("beta")
    expect(resolveChannel("prod")).toBe("prod")
  })

  test("undefined 回退到 dev", () => {
    expect(resolveChannel(undefined)).toBe("dev")
  })

  test("拼错的大小写或空值回退到 dev", () => {
    // 回归防护：历史上 constants.ts 读 import.meta.env.NovaWay_CHANNEL (PascalCase)，
    // 但 electron-vite 只 define 了 NOVAWAY_CHANNEL，undefined 回退 "dev"
    // 让 UPDATER_ENABLED 恒为 false，整个 updater 被 tree-shake 掉，自动更新静默失效。
    expect(resolveChannel("")).toBe("dev")
    expect(resolveChannel("NovaWay_PROD")).toBe("dev")
    expect(resolveChannel("release")).toBe("dev")
  })
})
