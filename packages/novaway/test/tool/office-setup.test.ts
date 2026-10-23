import { describe, expect, test } from "bun:test"
import { explainFeishuCode, feishuMode, feishuView, tencentDocsConfigured, verifyFeishuApp } from "@/tool/office-setup"

const env = {} as NodeJS.ProcessEnv

describe("office_setup config view", () => {
  test("detects a complete feishu app setup", () => {
    const view = feishuView({ feishuAppId: "cli_x", feishuAppSecret: "secret" }, env)
    expect(view.hasAppId).toBe(true)
    expect(view.hasAppSecret).toBe(true)
    expect(feishuMode(view)).toBe("app")
  })

  test("detects a webhook-only setup", () => {
    const view = feishuView({ feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/x" }, env)
    expect(feishuMode(view)).toBe("webhook")
  })

  test("flags a half-configured app as incomplete", () => {
    expect(feishuMode(feishuView({ feishuAppId: "cli_x" }, env))).toBe("incomplete")
    expect(feishuMode(feishuView({ feishuAppSecret: "secret" }, env))).toBe("incomplete")
  })

  test("reports missing when nothing is set", () => {
    expect(feishuMode(feishuView({}, env))).toBe("missing")
    expect(feishuMode(feishuView(undefined, env))).toBe("missing")
  })

  test("falls back to environment variables", () => {
    const view = feishuView(undefined, {
      FEISHU_APP_ID: "cli_env",
      FEISHU_APP_SECRET: "secret_env",
      FEISHU_USER_ID: "ou_x",
    } as NodeJS.ProcessEnv)
    expect(feishuMode(view)).toBe("app")
    expect(view.hasUserId).toBe(true)
  })

  test("never exposes secret values", () => {
    const view = feishuView({ feishuAppId: "cli_x", feishuAppSecret: "super-secret" }, env)
    expect(JSON.stringify(view)).not.toContain("super-secret")
    expect(JSON.stringify(view)).not.toContain("cli_x")
  })

  test("detects the tencent docs token", () => {
    expect(tencentDocsConfigured({ tencentDocsToken: "t" }, env)).toBe(true)
    expect(tencentDocsConfigured({}, env)).toBe(false)
    expect(tencentDocsConfigured(undefined, { TENCENT_DOCS_TOKEN: "t" } as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe("office_setup feishu errors", () => {
  test("explains common error codes", () => {
    expect(explainFeishuCode(0)).toBeUndefined()
    expect(explainFeishuCode(10014)).toContain("App Secret")
    expect(explainFeishuCode(10003)).toContain("App ID")
    expect(explainFeishuCode(99991663)).toContain("机器人")
    expect(explainFeishuCode(-1)).toContain("网络")
    expect(explainFeishuCode(424242)).toBeUndefined()
  })

  test("accepts valid credentials", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: any, init: any) => {
      const body = JSON.parse(String(init.body))
      expect(body.app_id).toBe("cli_x")
      expect(body.app_secret).toBe("secret")
      return new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      const result = await verifyFeishuApp("cli_x", "secret")
      expect(result.ok).toBe(true)
      expect(result.code).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })

  test("surfaces a rejected secret without leaking it", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 10014, msg: "app secret invalid" }), {
        status: 400,
      })) as unknown as typeof fetch
    try {
      const result = await verifyFeishuApp("cli_x", "super-secret")
      expect(result.ok).toBe(false)
      expect(result.code).toBe(10014)
      expect(JSON.stringify(result)).not.toContain("super-secret")
      expect(explainFeishuCode(result.code)).toContain("App Secret")
    } finally {
      globalThis.fetch = original
    }
  })

  test("reports network failures", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("fetch failed")
    }) as unknown as typeof fetch
    try {
      const result = await verifyFeishuApp("cli_x", "secret")
      expect(result.ok).toBe(false)
      expect(result.code).toBe(-1)
    } finally {
      globalThis.fetch = original
    }
  })
})
