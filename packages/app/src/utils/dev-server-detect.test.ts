import { describe, expect, test } from "bun:test"
import { createDevServerDetector, normalizeLocalUrl, stripAnsi } from "./dev-server-detect"

describe("stripAnsi", () => {
  test("removes SGR color and cursor movement sequences", () => {
    expect(stripAnsi("\u001b[32mhttp://localhost:3000\u001b[0m")).toBe("http://localhost:3000")
    expect(stripAnsi("\u001b[2K\u001b[1Aplain")).toBe("plain")
    expect(stripAnsi("\u001b]0;title\u0007plain")).toBe("0;title\u0007plain")
    expect(stripAnsi("no escapes")).toBe("no escapes")
  })
})

describe("normalizeLocalUrl", () => {
  test("keeps origin and drops path and search", () => {
    expect(normalizeLocalUrl("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeLocalUrl("http://localhost:3000/dashboard?tab=a")).toBe("http://localhost:3000")
    expect(normalizeLocalUrl("https://127.0.0.1:5173/foo#bar")).toBe("https://127.0.0.1:5173")
  })

  test("rewrites 0.0.0.0 to localhost", () => {
    expect(normalizeLocalUrl("http://0.0.0.0:8080")).toBe("http://localhost:8080")
  })

  test("rejects out-of-range ports and unparseable input", () => {
    expect(normalizeLocalUrl("http://localhost:70000")).toBeUndefined()
    expect(normalizeLocalUrl("http://localhost:0")).toBeUndefined()
    expect(normalizeLocalUrl("http://localhost:-1")).toBeUndefined()
  })

  test("rejects input without a scheme", () => {
    expect(normalizeLocalUrl("3000abc")).toBeUndefined()
    expect(normalizeLocalUrl("localhost:3000")).toBeUndefined()
  })
})

describe("createDevServerDetector", () => {
  test("finds loopback and private addresses", () => {
    const d = createDevServerDetector()
    expect(d.report("Local: http://localhost:3000/")).toEqual(["http://localhost:3000"])
    expect(d.report("on 127.0.0.1:5173")).toEqual([])
    expect(d.report("http://192.168.1.10:3000")).toEqual(["http://192.168.1.10:3000"])
    expect(d.report("http://172.18.0.4:8080")).toEqual(["http://172.18.0.4:8080"])
    expect(d.report("http://10.0.0.2:4000")).toEqual(["http://10.0.0.2:4000"])
    expect(d.report("http://[::1]:9000")).toEqual(["http://[::1]:9000"])
    // RFC1918 段边界（含端点）
    expect(d.report("http://10.255.255.254:3000")).toEqual(["http://10.255.255.254:3000"])
    expect(d.report("http://172.16.0.1:3000")).toEqual(["http://172.16.0.1:3000"])
    expect(d.report("http://172.31.255.254:3000")).toEqual(["http://172.31.255.254:3000"])
  })

  test("ignores public addresses to avoid noise", () => {
    const d = createDevServerDetector()
    expect(d.report("see https://example.com/docs for help")).toEqual([])
    expect(d.report("github: https://github.com/foo/bar")).toEqual([])
    // 11.x 不在 10/8 内；172.15.x 在 172.16/12 之外；192.169 非 192.168 —— 都按公网忽略
    expect(d.report("http://11.0.0.1:3000")).toEqual([])
    expect(d.report("http://172.15.0.1:3000")).toEqual([])
    expect(d.report("http://192.169.0.1:3000")).toEqual([])
  })

  test("matches URLs wrapped in ANSI color codes", () => {
    const d = createDevServerDetector()
    const out = ["  ➜  ", "\u001b[36mLocal:\u001b[0m", "\u001b[36m  http://localhost:5173/\u001b[0m"].join("")
    expect(d.report(out)).toEqual(["http://localhost:5173"])
  })

  test("rejoins a URL split across chunk boundaries", () => {
    const d = createDevServerDetector()
    expect(d.report("Local: http://local")).toEqual([])
    expect(d.report("host:3000/")).toEqual(["http://localhost:3000"])
  })

  test("does not report the same address twice", () => {
    const d = createDevServerDetector()
    expect(d.report("http://localhost:3000")).toEqual(["http://localhost:3000"])
    expect(d.report("http://localhost:3000")).toEqual([])
    expect(d.report("http://localhost:3000/")).toEqual([])
  })

  test("reports distinct ports separately", () => {
    const d = createDevServerDetector()
    expect(d.report("http://localhost:3000")).toEqual(["http://localhost:3000"])
    expect(d.report("http://localhost:3001")).toEqual(["http://localhost:3001"])
  })

  test("recognizes common dev server banners", () => {
    const d = createDevServerDetector()
    const vite = [
      "VITE v5.2.0 ready in 312 ms",
      "",
      "  ➜  Local:   http://localhost:5173/",
      "  ➜  Network: use --host to expose",
    ].join("\n")
    expect(d.report(vite)).toEqual(["http://localhost:5173"])

    const d2 = createDevServerDetector()
    expect(d2.report("▲ Next.js 14.0.0\n  Local: http://localhost:3000\n  Start date: 2026-09-14")).toEqual([
      "http://localhost:3000",
    ])

    const d3 = createDevServerDetector()
    expect(d3.report("Ready on http://127.0.0.1:8080")).toEqual(["http://127.0.0.1:8080"])
  })

  test("survives high-volume output without stale matches leaking past the window", () => {
    const d = createDevServerDetector()
    expect(d.report("http://localhost:3000\n")).toEqual(["http://localhost:3000"])
    const noise = "x".repeat(8192)
    expect(d.report(noise)).toEqual([])
    // 旧地址已在窗口外，但去重集仍保留，不会重新建议
    expect(d.report("http://localhost:3000\n")).toEqual([])
  })

  test("ignores malformed percent-encodings and bare port lists", () => {
    const d = createDevServerDetector()
    expect(d.report("ports: 3000 3001 3002")).toEqual([])
    expect(d.report("use http://localhost:3000, then reload")).toEqual(["http://localhost:3000"])
  })

  test("stops matching before trailing junk so the port stays intact", () => {
    const d = createDevServerDetector()
    expect(d.report("http://localhost:3000abc")).toEqual(["http://localhost:3000"])
  })
})
