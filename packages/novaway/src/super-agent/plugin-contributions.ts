import type {
  AgentRuntimeContribution,
  AgentTemplateContribution,
  RepairStrategyContribution,
  SuperAgentPolicyContribution,
  SuperAgentStrategyContribution,
  SuperAgentSurfaceContribution,
  TaskKindContribution,
  VerifierContribution,
} from "@novaway/plugin-api"
import { AgentRuntimeRegistry, type AgentRuntimeAdapter } from "./adapter"
import { RepairStrategyRegistry, type RepairStrategy } from "./repair"
import { VerifierRegistry, type Verifier } from "./verification"

export type SuperAgentContributionRegistry<T extends { id: string }> = {
  register(item: T, ownerID?: string): { dispose(): void }
  resolve(id: string): T | undefined
  list(): readonly T[]
  release(ownerID: string): void
}

function registry<T extends { id: string }>(): SuperAgentContributionRegistry<T> {
  const entries = new Map<string, { item: T; ownerID?: string }>()
  return {
    register(item, ownerID) {
      if (entries.has(item.id)) throw new Error(`Super-Agent contribution already registered: ${item.id}`)
      entries.set(item.id, { item, ...(ownerID ? { ownerID } : {}) })
      return {
        dispose: () => {
          if (entries.get(item.id)?.item === item) entries.delete(item.id)
        },
      }
    },
    resolve: (id) => entries.get(id)?.item,
    list: () => [...entries.values()].map((entry) => entry.item),
    release(ownerID) {
      for (const [id, entry] of entries) if (entry.ownerID === ownerID) entries.delete(id)
    },
  }
}

export type SuperAgentContributionRegistries = {
  agentRuntimes: SuperAgentContributionRegistry<AgentRuntimeContribution>
  strategies: SuperAgentContributionRegistry<SuperAgentStrategyContribution>
  taskKinds: SuperAgentContributionRegistry<TaskKindContribution>
  verifiers: SuperAgentContributionRegistry<VerifierContribution>
  repairStrategies: SuperAgentContributionRegistry<RepairStrategyContribution>
  agentTemplates: SuperAgentContributionRegistry<AgentTemplateContribution>
  policies: SuperAgentContributionRegistry<SuperAgentPolicyContribution>
  surfaces: SuperAgentContributionRegistry<SuperAgentSurfaceContribution>
}
export function createSuperAgentContributionRegistries(): SuperAgentContributionRegistries {
  return {
    agentRuntimes: registry(),
    strategies: registry(),
    taskKinds: registry(),
    verifiers: registry(),
    repairStrategies: registry(),
    agentTemplates: registry(),
    policies: registry(),
    surfaces: registry(),
  }
}

export type KernelContributionBindings = {
  runtimes: AgentRuntimeRegistry
  verifiers: VerifierRegistry
  repairStrategies: RepairStrategyRegistry
  dispose(): void
}


/**
 * Binds executable plugin contributions to the kernel registries. Manifest-only
 * declarations remain visible to the plugin host but are deliberately skipped
 * here until their entry exports the corresponding executable contract.
 */
export function bindExecutableSuperAgentContributions(
  contributions: SuperAgentContributionRegistries | undefined,
): KernelContributionBindings {
  const runtimes = new AgentRuntimeRegistry()
  const verifiers = new VerifierRegistry()
  const repairStrategies = new RepairStrategyRegistry()
  const disposables: Array<{ dispose(): void }> = []

  for (const contribution of contributions?.agentRuntimes.list() ?? []) {
    const candidate = contribution as AgentRuntimeContribution & Partial<AgentRuntimeAdapter> & {
      adapter?: AgentRuntimeAdapter
    }
    const adapter = candidate.adapter ?? candidate
    if (
      typeof adapter.discover === "function" &&
      typeof adapter.start === "function" &&
      typeof adapter.events === "function" &&
      typeof adapter.dispose === "function"
    ) {
      const executable = {
        ...adapter,
        type: adapter.type ?? candidate.runtimeType,
        version: adapter.version ?? candidate.version,
      } as AgentRuntimeAdapter
      disposables.push(runtimes.register(executable))
    }
  }

  for (const contribution of contributions?.verifiers.list() ?? []) {
    const candidate = contribution as VerifierContribution & Partial<Verifier>
    if (typeof candidate.verify === "function") {
      disposables.push(verifiers.register({ id: candidate.id, version: candidate.version, verify: candidate.verify }))
    }
  }

  for (const contribution of contributions?.repairStrategies.list() ?? []) {
    const candidate = contribution as RepairStrategyContribution & Partial<RepairStrategy>
    if (typeof candidate.create === "function") {
      disposables.push(repairStrategies.register({ id: candidate.id, version: candidate.version, create: candidate.create }))
    }
  }

  return {
    runtimes,
    verifiers,
    repairStrategies,
    dispose() {
      for (const disposable of disposables.reverse()) disposable.dispose()
    },
  }
}
