import { Effect, Layer } from "effect"
import { Elicitation } from "@/mcp/elicitation"

/**
 * MCP 测试用的 elicitation 桩：一律 `cancel`。
 *
 * 真实实现要等界面回答，测试里没人回答就会挂住；默认 `cancel` 既符合协议
 * （服务器会走自己的降级路径），也不会给测试引入等待。
 */
export function layer(overrides: Partial<Elicitation.Interface> = {}) {
  return Layer.succeed(Elicitation.Service, {
    ask: () => Effect.succeed({ action: "cancel" as const }),
    reply: () => Effect.void,
    reject: () => Effect.void,
    list: () => Effect.succeed([]),
    complete: () => Effect.void,
    ...overrides,
  } satisfies Elicitation.Interface)
}

export * as TestElicitation from "./elicitation"
