import type { ToolContribution } from "./contributions"
import type { KernelApi, PluginActivation, PluginContext } from "./context"

/**
 * 作者 API 只有两个入口函数（附录 F）。
 *
 * 纯函数，无副作用，因此 plugin-api 依旧不产生运行时依赖。
 */
export function defineTool<Args>(tool: ToolContribution<Args>): ToolContribution<Args> {
  return tool
}

/** 第三方默认 `PluginContext`；第一方写 `definePlugin<KernelApi>`。 */
export function definePlugin<Ctx = PluginContext>(plugin: {
  activate: PluginActivation<Ctx>
}): {
  activate: PluginActivation<Ctx>
} {
  return plugin
}

/** 内置插件的特派写法，等价于 `definePlugin<KernelApi>`。 */
export function defineBuiltinPlugin(plugin: { activate: PluginActivation<KernelApi> }) {
  return definePlugin<KernelApi>(plugin)
}
