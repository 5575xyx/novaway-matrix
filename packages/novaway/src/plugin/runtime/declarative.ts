import type { ContributionKind } from "@novaway/plugin-api"
import { createRegistry, type ContributionRegistry } from "../contributions/registry"

export type DeclarativeContribution = { id: string; [key: string]: unknown }

export const declarativeContributionKeys = [
  "mcpServers",
  "outputStyles",
  "lspServers",
  "httpRoutes",
  "triggers",
  "fastPath",
  "routingPolicies",
  "workerTypes",
  "watchdogPolicies",
  "channels",
  "schedulers",
  "eventSources",
  "lifecycleHooks",
] as const

export type DeclarativeContributionKey = (typeof declarativeContributionKeys)[number]
export type DeclarativeRegistries = {
  [K in DeclarativeContributionKey]: ContributionRegistry<DeclarativeContribution>
}

export function createDeclarativeRegistries(): DeclarativeRegistries {
  return Object.fromEntries(
    declarativeContributionKeys.map((key) => [
      key,
      createRegistry<DeclarativeContribution>({
        kind: kindFor(key),
        policy: "accumulate",
      }),
    ]),
  ) as DeclarativeRegistries
}

function kindFor(key: DeclarativeContributionKey): ContributionKind {
  if (key === "lifecycleHooks") return "event-source"
  const kinds: Record<Exclude<DeclarativeContributionKey, "lifecycleHooks">, ContributionKind> = {
    mcpServers: "mcp",
    outputStyles: "output-style",
    lspServers: "lsp",
    httpRoutes: "http-route",
    triggers: "trigger",
    fastPath: "fast-path",
    routingPolicies: "routing-policy",
    workerTypes: "worker-type",
    watchdogPolicies: "watchdog-policy",
    channels: "channel",
    schedulers: "scheduler",
    eventSources: "event-source",
  }
  return kinds[key]
}
