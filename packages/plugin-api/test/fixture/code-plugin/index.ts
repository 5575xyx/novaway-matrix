import { definePlugin, defineTool } from "@novaway/plugin-api"
import type { HttpClient } from "@novaway/plugin-api"

/**
 * 第三方代码型插件 fixture（`scope` 非 builtin，拿到的是 PluginContext）。
 *
 * 工具入口有两个 ctx：`execute` 的第二个参数是内核给的工具执行上下文（没有 http/secrets），
 * 插件自己的 API 只能从 `activate(ctx)` 闭包注入（插件文档 §4.2「两个 ctx 不许混」，附录 F 已按此改正）。
 */
const weatherTool = (http: HttpClient) =>
  defineTool({
    id: "weather",
    description: "Get current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
    safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
    async execute(args: { city: string }, toolCtx) {
      if (toolCtx.abort.aborted) return { output: "cancelled" }
      const res = await http.fetch(`https://wttr.in/${encodeURIComponent(args.city)}?format=j1`)
      toolCtx.metadata({ title: args.city })
      return { output: await res.text() }
    },
  })

export default definePlugin({
  async activate(ctx) {
    ctx.tools.register(weatherTool(ctx.http))

    await ctx.storage.set("lastCity", "Oslo")
    const cached = await ctx.storage.get<string>("lastCity")
    if (cached !== undefined) ctx.log.info("cache hit", { cached })

    const token = await ctx.secrets.read("acme_token")
    if (token === undefined) ctx.log.warn("acme_token missing")

    ctx.interceptors.register({
      id: "log-weather",
      hook: "tool.execute.after",
      filter: { tool: ["acme-weather_weather"] },
      handler: (input) => {
        ctx.log.debug("weather called", { input })
      },
    })

    // 第三方只读 provider/surface：这两个注册表的 register 返回类型是 never，编译期就挡住写入。
    ctx.providers.resolve("openai")
    ctx.surfaces.list()
  },
})
