import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { Elicitation } from "@/mcp/elicitation"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Elicitation.defaultLayer)

const writeHooks = (dir: string, config: Record<string, unknown>) =>
  Effect.promise(() => Bun.write(path.join(dir, "hooks.json"), JSON.stringify(config)))

const answerHook = (event: "Elicitation" | "ElicitationResult", action: string) => ({
  [event]: [
    {
      hooks: [
        {
          type: "command",
          command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"${event}","action":"${action}"}}'`,
        },
      ],
    },
  ],
})

/**
 * MCP elicitation 的三段式：钩子先答 → 界面再答 → `ElicitationResult` 可改写。
 *
 * 这些用例把每一步单独钉住，因为它们出错的症状完全不同：
 * 钩子不生效会让本该自动化的流程弹窗；界面路径挂掉会让工具调用永久卡住；
 * `ElicitationResult` 不生效则是「用户点了同意但服务器收到取消」这种最难查的问题。
 */
describe("mcp.elicitation", () => {
  it.instance("Elicitation hook answers without bothering the UI", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* writeHooks(dir, {
        Elicitation: [
          {
            matcher: "github",
            hooks: [
              {
                type: "command",
                command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"token":"t-1"}}}'`,
              },
            ],
          },
        ],
      })
      const elicitation = yield* Elicitation.Service
      const result = yield* elicitation.ask({
        serverName: "github",
        params: { message: "API token?" },
      })
      expect(result).toEqual({ action: "accept", content: { token: "t-1" } })
      // 没经过界面：队列必须是空的。
      expect(yield* elicitation.list()).toEqual([])
    }),
  )

  it.instance("an Elicitation hook that blocks declines the request", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* writeHooks(dir, { Elicitation: [{ hooks: [{ type: "command", command: "exit 2" }] }] })
      const elicitation = yield* Elicitation.Service
      const result = yield* elicitation.ask({ serverName: "github", params: { message: "Really?" } })
      expect(result).toEqual({ action: "decline" })
    }),
  )

  it.instance("UI reply resolves the pending request", () =>
    Effect.gen(function* () {
      const elicitation = yield* Elicitation.Service
      const fiber = yield* elicitation
        .ask({ serverName: "github", params: { message: "Name?", requestedSchema: { type: "object" } } })
        .pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        elicitation.list().pipe(Effect.map((items) => items[0])),
        "elicitation request never reached the UI",
      )
      expect(pending.serverName).toBe("github")
      expect(pending.mode).toBe("form")
      expect(pending.requestedSchema).toEqual({ type: "object" })
      yield* elicitation.reply({ requestID: pending.id, action: "accept", content: { name: "nova" } })
      const result = yield* Fiber.join(fiber)
      expect(result).toEqual({ action: "accept", content: { name: "nova" } })
      expect(yield* elicitation.list()).toEqual([])
    }),
  )

  it.instance("rejecting a request cancels it on the protocol side", () =>
    Effect.gen(function* () {
      const elicitation = yield* Elicitation.Service
      const fiber = yield* elicitation.ask({ serverName: "github", params: { message: "?" } }).pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        elicitation.list().pipe(Effect.map((items) => items[0])),
        "elicitation request never reached the UI",
      )
      yield* elicitation.reject(pending.id)
      expect(yield* Fiber.join(fiber)).toEqual({ action: "cancel" })
    }),
  )

  it.instance("an aborted call cancels instead of hanging", () =>
    Effect.gen(function* () {
      const elicitation = yield* Elicitation.Service
      const controller = new AbortController()
      const fiber = yield* elicitation
        .ask({ serverName: "github", params: { message: "?" }, signal: controller.signal })
        .pipe(Effect.forkScoped)
      yield* pollWithTimeout(
        elicitation.list().pipe(Effect.map((items) => items[0])),
        "elicitation request never reached the UI",
      )
      controller.abort()
      expect(yield* Fiber.join(fiber)).toEqual({ action: "cancel" })
      expect(yield* elicitation.list()).toEqual([])
    }),
  )

  it.instance("a configured timeout gives up with cancel", () =>
    Effect.gen(function* () {
      const elicitation = yield* Elicitation.Service
      const result = yield* elicitation.ask({ serverName: "github", params: { message: "?" }, timeoutMs: 20 })
      expect(result).toEqual({ action: "cancel" })
      expect(yield* elicitation.list()).toEqual([])
    }),
  )

  it.instance("ElicitationResult hook can rewrite the user's answer", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* writeHooks(dir, answerHook("ElicitationResult", "decline"))
      const elicitation = yield* Elicitation.Service
      const fiber = yield* elicitation.ask({ serverName: "github", params: { message: "?" } }).pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        elicitation.list().pipe(Effect.map((items) => items[0])),
        "elicitation request never reached the UI",
      )
      yield* elicitation.reply({ requestID: pending.id, action: "accept", content: { a: 1 } })
      expect(yield* Fiber.join(fiber)).toEqual({ action: "decline" })
    }),
  )

  it.instance("complete marks a URL request without ending the wait", () =>
    Effect.gen(function* () {
      const elicitation = yield* Elicitation.Service
      const fiber = yield* elicitation
        .ask({
          serverName: "github",
          params: { message: "Open the link", mode: "url", url: "https://example.com", elicitationId: "e-1" },
        })
        .pipe(Effect.forkScoped)
      const pending = yield* pollWithTimeout(
        elicitation.list().pipe(Effect.map((items) => items[0])),
        "elicitation request never reached the UI",
      )
      expect(pending.mode).toBe("url")
      expect(pending.url).toBe("https://example.com")
      yield* elicitation.complete({ serverName: "github", elicitationId: "e-1" })
      // 只是「服务器说完成了」，用户可能还没确认：请求仍然挂着。
      expect(yield* elicitation.list()).toEqual([{ ...pending, completed: true }])
      yield* elicitation.reply({ requestID: pending.id, action: "accept" })
      expect(yield* Fiber.join(fiber)).toEqual({ action: "accept" })
    }),
  )
})
