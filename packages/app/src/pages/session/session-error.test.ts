import { describe, expect, test } from "bun:test"
import { classifyError, readableErrorText } from "./session-error"

describe("readableErrorText", () => {
  test("strips the Error: prefix from plain text", () => {
    expect(readableErrorText("Error: something broke")).toBe("something broke")
  })

  test("reads a JSON payload embedded after a prefix", () => {
    const raw = 'custom stream failed 400: {"error":{"message":"upstream_400","type":"upstream_400","param":"","code":null}}'
    expect(readableErrorText(raw)).toBe("upstream_400")
  })

  test("reads a double-escaped payload", () => {
    // 上游把 payload 当成 JSON 字符串又转义了一层（实际观测到的形态）。
    const raw = 'custom stream failed 400: {\\"error\\":{\\"message\\":\\"upstream_400\\",\\"type\\":\\"upstream_400\\"}}'
    expect(readableErrorText(raw)).toBe("upstream_400")
  })

  test("keeps the type when it differs from the message", () => {
    const raw = '{"error":{"message":"boom","type":"server_error"}}'
    expect(readableErrorText(raw)).toBe("boom (server_error)")
  })

  test("reads a JSON string containing JSON", () => {
    const inner = JSON.stringify({ error: { message: "no auth available" } })
    expect(readableErrorText(JSON.stringify(inner))).toBe("no auth available")
  })

  test("falls back to the original text when nothing parses", () => {
    expect(readableErrorText("plain failure")).toBe("plain failure")
  })
})

describe("classifyError", () => {
  const cases: Array<[string, ReturnType<typeof classifyError>]> = [
    ['custom stream failed 400: {"error":{"message":"upstream_400"}}', "upstream"],
    ['custom stream failed 502: {"error":{"message":"auth.unavailable: no auth available"}}', "auth"],
    ["all eligible accounts are cooling down", "rateLimit"],
    ["fetch failed", "network"],
    ["context length exceeded", "context"],
    ['{"error":{"message":"model not found"}}', "model"],
    ["boom", "unknown"],
  ]

  for (const [raw, kind] of cases) {
    test(`${kind}: ${raw.slice(0, 40)}`, () => {
      expect(classifyError(raw)).toBe(kind)
    })
  }

  test("uses the error name when the payload is empty", () => {
    expect(classifyError("", "MessageAbortedError")).toBe("aborted")
  })
})
