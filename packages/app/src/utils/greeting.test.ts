import { describe, expect, test } from "bun:test"
import { greetingKeyAt } from "./greeting"

// 档位取自 ZCode `getChatEmptyGreetingMessageId`：5-9 清晨 / 9-12 上午 / 12-14 午间 /
// 14-18 下午 / 18-23 晚间 / 其余深夜。边界值归下一档（与上游一致的左闭右开）。
describe("greetingKeyAt", () => {
  test("按小时分档", () => {
    expect(greetingKeyAt(5)).toBe("chat.empty.greeting.morningEarly")
    expect(greetingKeyAt(8)).toBe("chat.empty.greeting.morningEarly")
    expect(greetingKeyAt(9)).toBe("chat.empty.greeting.morning")
    expect(greetingKeyAt(11)).toBe("chat.empty.greeting.morning")
    expect(greetingKeyAt(12)).toBe("chat.empty.greeting.noon")
    expect(greetingKeyAt(13)).toBe("chat.empty.greeting.noon")
    expect(greetingKeyAt(14)).toBe("chat.empty.greeting.afternoon")
    expect(greetingKeyAt(17)).toBe("chat.empty.greeting.afternoon")
    expect(greetingKeyAt(18)).toBe("chat.empty.greeting.evening")
    expect(greetingKeyAt(22)).toBe("chat.empty.greeting.evening")
  })

  test("夜里落到深夜档", () => {
    for (const hour of [23, 0, 1, 4]) {
      expect(greetingKeyAt(hour)).toBe("chat.empty.greeting.lateNight")
    }
  })
})
