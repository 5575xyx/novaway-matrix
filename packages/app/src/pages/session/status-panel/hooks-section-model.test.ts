import { describe, expect, test } from "bun:test"
import { activeHooksLabel, formatHookElapsed } from "./hooks-section-model"

describe("hooks section model", () => {
  test("labels the running hook count", () => {
    expect(activeHooksLabel([])).toBe("0")
    expect(activeHooksLabel([{} as never, {} as never])).toBe("2")
  })

  test("shows milliseconds for fast hooks and seconds afterwards", () => {
    expect(formatHookElapsed(1_000, 1_250)).toBe("250ms")
    expect(formatHookElapsed(1_000, 1_999)).toBe("999ms")
    expect(formatHookElapsed(1_000, 3_000)).toBe("2s")
    expect(formatHookElapsed(0, 65_000)).toBe("1m 5s")
    // Clock skew (hook started "in the future") must not produce negative text.
    expect(formatHookElapsed(5_000, 4_000)).toBe("0ms")
    // Non-finite input falls back to zero elapsed rather than "NaNms".
    expect(formatHookElapsed(Number.NaN, 1_000)).toBe("1s")
  })
})
