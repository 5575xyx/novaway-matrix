import { describe, expect, test } from "bun:test"
import { parseCookieText } from "../../src/browser/cookies"

describe("browser cookie import", () => {
  test("parses JSON cookie exports without changing values", () => {
    const cookies = parseCookieText(
      JSON.stringify([{ name: "sid", value: "secret", domain: ".example.com", path: "/" }]),
    )
    expect(cookies).toEqual([{ name: "sid", value: "secret", domain: ".example.com", path: "/" }])
  })

  test("parses Netscape cookies.txt and HttpOnly rows", () => {
    const cookies = parseCookieText(
      "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsid\tsecret\n#HttpOnly_.example.com\tTRUE\t/\tFALSE\t0\tsecure\tvalue",
    )
    expect(cookies).toEqual([
      { name: "sid", value: "secret", domain: ".example.com", path: "/", secure: true },
      { name: "secure", value: "value", domain: ".example.com", path: "/", secure: false, httpOnly: true },
    ])
  })
})
