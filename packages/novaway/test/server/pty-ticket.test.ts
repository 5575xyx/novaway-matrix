import { describe, expect, test } from "bun:test"
import * as Headers from "effect/unstable/http/Headers"
import { hasPtyConnectToken } from "../../src/server/shared/pty-ticket"

describe("pty connect token header", () => {
  // Header names are case-insensitive, and both `fetch` and the HTTP server
  // lowercase them on the wire. Comparing a camel-case spelling directly makes
  // every `connectToken` request 403, which strands the terminal on a blank
  // screen. These cases pin the acceptance rules.
  test("accepts the lowercased header the app client sends on the wire", () => {
    expect(hasPtyConnectToken({ "x-novaway-ticket": "1" })).toBe(true)
  })

  test("accepts the camel-case spelling regardless of casing", () => {
    expect(hasPtyConnectToken({ "x-NovaWay-ticket": "1" })).toBe(true)
    expect(hasPtyConnectToken({ "X-NOVAWAY-TICKET": "1" })).toBe(true)
  })

  test("still accepts the pre-rename legacy header", () => {
    expect(hasPtyConnectToken({ "x-opencode-ticket": "1" })).toBe(true)
  })

  test("rejects a wrong value", () => {
    expect(hasPtyConnectToken({ "x-novaway-ticket": "0" })).toBe(false)
  })

  test("rejects a missing header", () => {
    expect(hasPtyConnectToken({})).toBe(false)
  })

  test("rejects an unrelated header", () => {
    expect(hasPtyConnectToken({ "content-type": "1" })).toBe(false)
  })

  // `HttpServerRequest.headers` is an effect `Headers` value, which normalizes
  // names to lowercase. Read it through the real type so the check can't drift
  // back to a case-sensitive lookup.
  test("reads a lowercased effect Headers value", () => {
    expect(hasPtyConnectToken(Headers.fromInput({ "x-NovaWay-ticket": "1" }))).toBe(true)
    expect(hasPtyConnectToken(Headers.fromInput({ "x-novaway-ticket": "1" }))).toBe(true)
    expect(hasPtyConnectToken(Headers.fromInput({}))).toBe(false)
  })
})
