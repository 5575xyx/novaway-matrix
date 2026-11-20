import type {
  AgentContribution,
  CommandContribution,
  OfficeEngineContribution,
  PreviewContribution,
  ProviderAdapter,
  PublishDriverContribution,
  SkillContribution,
  SurfaceContribution,
  ToolContribution,
  Registry,
} from "@novaway/plugin-api"
import { createRegistry, type ContributionRegistry } from "./registry"

/**
 * 四个 M0 注册表（§14.3 第 5 步）。
 *
 * 每个文件只做两件事：绑类型、声明同名怎么处理（§4.8 的「可覆盖 / 累加」清单）。
 * 语义全在 `registry.ts` 一处，加码新贡献点时也是这个形状。
 */

/** §4.2 工具是累加型：第三方工具命名空间化后与内置并存，撞名追加后缀，不许静默消失。 */
export function createToolRegistry(input?: { reserved?: ReadonlySet<string> }): ContributionRegistry<ToolContribution> {
  return createRegistry<ToolContribution>({ kind: "tool", policy: "accumulate", reserved: input?.reserved })
}

export function createProviderRegistry(): Registry<ProviderAdapter> {
  const entries = new Map<string, ProviderAdapter>()
  const listeners = new Set<() => void>()
  const change = () => listeners.forEach((listener) => listener())
  return {
    register(item) {
      entries.set(item.id, item)
      change()
      return {
        dispose: () => {
          if (entries.get(item.id) !== item) return
          entries.delete(item.id)
          change()
        },
      }
    },
    resolve(id) {
      return entries.get(id)
    },
    list() {
      return [...entries.values()]
    },
    onDidChange(listener) {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}

export function createOfficeRegistry(): Registry<OfficeEngineContribution> {
  const entries = new Map<string, OfficeEngineContribution>()
  const listeners = new Set<() => void>()
  const change = () => listeners.forEach((listener) => listener())
  return {
    register(item) {
      const previous = entries.get(item.format)
      entries.set(item.format, item)
      change()
      return {
        dispose: () => {
          if (entries.get(item.format) !== item) return
          entries.delete(item.format)
          if (previous) entries.set(previous.format, previous)
          change()
        },
      }
    },
    resolve(id) {
      return entries.get(id)
    },
    list() {
      return [...entries.values()]
    },
    onDidChange(listener) {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}

export function createPublishRegistry(): Registry<PublishDriverContribution> {
  const entries = new Map<string, PublishDriverContribution>()
  const listeners = new Set<() => void>()
  const change = () => listeners.forEach((listener) => listener())
  return {
    register(item) {
      const previous = entries.get(item.id)
      entries.set(item.id, item)
      change()
      return {
        dispose: () => {
          if (entries.get(item.id) !== item) return
          entries.delete(item.id)
          if (previous) entries.set(previous.id, previous)
          change()
        },
      }
    },
    resolve(id) {
      return entries.get(id)
    },
    list() {
      return [...entries.values()]
    },
    onDidChange(listener) {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}

export function createPreviewerRegistry(): ContributionRegistry<PreviewContribution> {
  return createRegistry<PreviewContribution>({ kind: "previewer", policy: "accumulate" })
}

export function createSurfaceRegistry(): ContributionRegistry<SurfaceContribution> {
  return createRegistry<SurfaceContribution>({ kind: "surface", policy: "accumulate" })
}

export function createAgentRegistry(input?: {
  reserved?: ReadonlySet<string>
}): ContributionRegistry<AgentContribution> {
  return createRegistry<AgentContribution>({ kind: "agent", policy: "override", reserved: input?.reserved })
}

/** §4.12 Skill 是目录索引、不执行代码，累加：多一个技能就多一条可发现的说明。 */
export function createSkillRegistry(input?: {
  reserved?: ReadonlySet<string>
}): ContributionRegistry<SkillContribution> {
  return createRegistry<SkillContribution>({ kind: "skill", policy: "accumulate", reserved: input?.reserved })
}

/** §4.12 Command 可覆盖：斜杠命令的语义由名字唯一决定，两条同名命令没有「都保留」的意义。 */
export function createCommandRegistry(input?: {
  reserved?: ReadonlySet<string>
}): ContributionRegistry<CommandContribution> {
  return createRegistry<CommandContribution>({ kind: "command", policy: "override", reserved: input?.reserved })
}

export * as PluginContributions from "."
