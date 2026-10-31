import type { BuiltinExtension } from "./builtin-extensions-data"

/**
 * 内置扩展的开关读写 —— 纯函数，不碰任何上下文。
 *
 * 扩展设置页、办公模式首页的插件选择器、推荐提示词的可用性判断，
 * 读的必须是同一个语义：`config.skills.disabled` 里出现的技能 = 关掉，
 * `config.browser.enabled === false` = 关掉，其余默认开。
 * 之前这套判断只写在设置页组件里，别处只能重新实现一遍，很容易和设置页对不上。
 */
export type ExtensionConfigView = {
  skills?: { disabled?: string[] }
  browser?: unknown
  memory?: { enabled?: boolean }
  experimental?: unknown
  tools?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function extensionEnabled(config: ExtensionConfigView, item: BuiltinExtension): boolean {
  if (item.available === false) return false
  if (item.toggle === "skills") {
    const disabled = new Set(config.skills?.disabled ?? [])
    return (item.skills ?? []).every((name) => !disabled.has(name))
  }
  if (item.toggle === "browser") {
    return !(isRecord(config.browser) && config.browser.enabled === false)
  }
  if (item.toggle === "memory") return config.memory?.enabled !== false
  if (item.toggle === "computer") {
    const experimental = config.experimental
    return isRecord(experimental) && experimental["computer_control"] === true
  }
  if (item.toggle === "tools") {
    const tools = isRecord(config.tools) ? config.tools : {}
    return (item.tools ?? []).every((id) => tools[id] !== false)
  }
  return true
}

/**
 * 把开关写成 `updateConfig` 的补丁。返回 undefined 表示这个条目没有开关落点。
 */
export function extensionConfigPatch(
  config: ExtensionConfigView,
  item: BuiltinExtension,
  enabled: boolean,
): Record<string, unknown> | undefined {
  if (item.toggle === "skills") {
    const current = new Set(config.skills?.disabled ?? [])
    for (const name of item.skills ?? []) {
      if (enabled) current.delete(name)
      else current.add(name)
    }
    return { skills: { ...(config.skills ?? {}), disabled: [...current] } }
  }
  if (item.toggle === "browser") {
    const browser = isRecord(config.browser) ? config.browser : {}
    return { browser: { ...browser, enabled } }
  }
  if (item.toggle === "computer") {
    const experimental = isRecord(config.experimental) ? config.experimental : {}
    return { experimental: { ...experimental, computer_control: enabled } }
  }
  if (item.toggle === "tools") {
    const tools = isRecord(config.tools) ? config.tools : {}
    const next = { ...tools }
    for (const id of item.tools ?? []) next[id] = enabled
    return { tools: next }
  }
  if (item.toggle === "memory") return { memory: { ...(config.memory ?? {}), enabled } }
  return undefined
}
