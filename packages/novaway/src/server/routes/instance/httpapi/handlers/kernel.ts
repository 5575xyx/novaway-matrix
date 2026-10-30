import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { CAPABILITIES, ToolRegistry } from "@/tool/registry"
import { Service as SkillService } from "@/skill"
import { Service as AgentService } from "@/agent/agent"
import { Service as HookService } from "@/hook/service"
import { ExtensionService } from "@/extension"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ClientCapabilities } from "@/effect/client-capabilities"
import { CliOnly } from "@/cli/cli-only"
import { InstallationVersion } from "@novaway/core/installation/version"

/** Tools hidden behind `tool_search` until the model asks for them. */
const DEFERRED_PREFIXES = ["browser_", "generate_"]

export const kernelHandlers = HttpApiBuilder.group(InstanceHttpApi, "kernel", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const skills = yield* SkillService
    const hooks = yield* HookService
    const extensions = yield* ExtensionService
    const config = yield* Config.Service
    const agents = yield* AgentService
    const flags = yield* RuntimeFlags.Service
    const capabilities = yield* ClientCapabilities.Service
    return handlers.handle("capabilities", () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const feature = cfg.experimental ?? {}
        const [ids, allSkills, registrations, loaded, contributions, allAgents] = yield* Effect.all([
          registry.ids(),
          skills.all(),
          hooks.list(),
          extensions.list(),
          extensions.contributions(),
          agents.list(),
        ])

        // 未配置时默认开启（与 registry/prompt 里的 `?? true` 保持一致）。
        const deferredOn = feature.defer_loading ?? true
        const deferred = deferredOn
          ? ids.filter(
              (id) => CAPABILITIES[id]?.deferLoading === true || DEFERRED_PREFIXES.some((p) => id.startsWith(p)),
            ).length
          : 0
        const budget = feature.tool_result_budget_chars
        const backgroundOn = feature.background_subagents ?? flags.experimentalBackgroundSubagents
        const teamRoles = allAgents.filter((item) => !item.hidden).length
        const teamTools = ["team_create", "team_list", "task_create", "task_list"].filter((id) => ids.includes(id))

        return {
          version: InstallationVersion,
          tools: {
            total: ids.length,
            deferred,
            // Tools that declare a constant read-only capability. Tools whose
            // capability is a function (e.g. `git`) depend on arguments, so they
            // are not counted either way.
            readOnly: ids.filter((id) => CAPABILITIES[id]?.readOnly === true).length,
          },
          skills: allSkills.length,
          hooks: {
            registrations: registrations.length,
            events: new Set(registrations.map((item) => item.event)).size,
          },
          extensions: {
            total: loaded.length,
            enabled: loaded.filter((item) => item.enabled !== false).length,
            contributions: contributions.length,
          },
          features: [
            { id: "permission_mode", enabled: true, detail: cfg.permission_mode ?? "default" },
            {
              id: "tool_result_budget",
              enabled: true,
              detail: String(budget ?? 60_000),
            },
            { id: "defer_loading", enabled: deferredOn, detail: deferredOn ? String(deferred) : undefined },
            {
              id: "background_subagents",
              enabled: backgroundOn,
              detail: backgroundOn ? "on" : "off",
            },
            {
              id: "teams",
              enabled: teamTools.length === 4,
              detail: teamRoles ? String(teamRoles) : undefined,
            },
            { id: "auto_delegate", enabled: feature.auto_delegate !== false },
            { id: "plan_approval", enabled: true },
            {
              id: "async_sources",
              enabled: true,
              detail: [ids.includes("monitor") ? "monitor" : "", ids.includes("subscribe") ? "subscribe" : ""]
                .filter(Boolean)
                .join(", "),
            },
          ],
          client: {
            id: capabilities.client,
            capabilities: capabilities.list(),
            cliOnly: CliOnly.Commands.map((item) => ({ command: item.command, reason: item.reason })),
          },
        }
      }),
    )
  }),
)
