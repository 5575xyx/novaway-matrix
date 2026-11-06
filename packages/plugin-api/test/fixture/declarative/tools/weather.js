// 纯 JS 的声明式工具入口（插件文档 §7.4 + 附录 F）：不 import 任何东西。
// 契约：默认导出一个工厂，宿主在激活时用「插件自己的 PluginContext」调用它拿到 execute，
// 再和 manifest 里的声明（id/description/parameters/safety）合并成一条工具贡献。
// M0 验收要求这个文件在 checkJs + strict 下依然通过 tsgo --noEmit。

/** @typedef {{ city: string }} WeatherArgs */

/**
 * @param {{ http: { fetch: (url: string, init?: RequestInit) => Promise<Response> } }} api
 */
export default (api) => ({
  /**
   * @param {WeatherArgs} args
   * @param {{ abort: AbortSignal }} ctx
   */
  async execute(args, ctx) {
    const url = `https://wttr.in/${encodeURIComponent(args.city)}?format=j1`
    const res = await api.http.fetch(url, { signal: ctx.abort })
    return { output: await res.text() }
  },
})
