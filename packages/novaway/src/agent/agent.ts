import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SCOUT from "./prompt/scout.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_VERIFICATION from "./prompt/verification.txt"
import PROMPT_COORDINATOR from "./prompt/coordinator.txt"
import { Permission } from "@/permission"
import { filter, mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@novaway/core/global"
import path from "path"
import { Plugin } from "@/plugin"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { type DeepMutable } from "@novaway/core/schema"

export const DEFAULT_AGENT = "creova"

/**
 * Marketplace contributions are namespaced by the plugin registry. Keep old
 * config values usable by resolving an unqualified local id to its unique
 * namespaced contribution (for example agents-orchestrator ->
 * agency-agents_agents-orchestrator).
 */
function agentNameMatches(candidate: string, requested: string) {
  return candidate === requested || candidate.endsWith(`_${requested}`)
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
  tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  disallowedTools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  skills: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  mcpServers: Schema.optional(
    Schema.mutable(Schema.Array(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]))),
  ),
  hooks: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  permissionMode: Schema.optional(
    Schema.Literals(["default", "acceptEdits", "plan", "auto", "bypassPermissions", "unattended"]),
  ),
  maxTurns: Schema.optional(Schema.Finite),
  background: Schema.optional(Schema.Boolean),
  isolation: Schema.optional(Schema.Literals(["worktree"])),
  memory: Schema.optional(Schema.Literals(["user", "project", "local"])),
  initialPrompt: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.String),
  /** Named output style (see `session/output-style.ts`); `default` or absent means none. */
  outputStyle: Schema.optional(Schema.String),
}).annotate({ identifier: "Agent" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultInfo: () => Effect.Effect<Info>
  readonly defaultAgent: () => Effect.Effect<string>
  /** Reload config + agent cache so newly written agent markdown is available. */
  readonly reload: () => Effect.Effect<Info[]>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.ModelNotFoundError
  >
}

type State = Omit<Interface, "generate" | "reload">

export class Service extends Context.Service<Service, Interface>()("@novaway/Agent") {}


export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service
    const flags = yield* RuntimeFlags.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const builtInSkillRules = Object.fromEntries((yield* skill.all()).map((item) => [item.name, "allow"] as const))
        const builtInSkillPermission = Permission.fromConfig({ skill: builtInSkillRules })
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
        ]
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          skill: {
            "*": "deny",
            ...builtInSkillRules,
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          repo_clone: "deny",
          repo_overview: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          creova: {
            name: "creova",
            description: "NovaWay's default general-purpose agent. Follows the active session permission mode.",
            options: {
              category: "核心",
            },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                plan_exit: "allow",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {
              category: "核心",
            },
            mode: "subagent",
            native: true,
          },
          verification: {
            name: "verification",
            description: `Independent, read-only verifier. Spawn it after non-trivial work (3+ file edits, backend/API, dependency or CI changes) and before telling the user the task is complete. It inspects the change, runs the project's checks and adversarial probes, and ends with "VERDICT: PASS|FAIL|PARTIAL" plus command-level evidence. It cannot edit files.`,
            prompt: PROMPT_VERIFICATION,
            mode: "subagent",
            native: true,
            background: true,
            color: "warning",
            tools: [
              "read",
              "grep",
              "glob",
              "list",
              "bash",
              "run_verification",
              "webfetch",
              "websearch",
              "task_status",
              "tool_search",
              "browser_navigate",
              "browser_open",
              "browser_snapshot",
              "browser_click",
              "browser_fill",
              "browser_press",
              "browser_screenshot",
              "browser_console",
              "browser_network",
              "browser_accessibility",
              "browser_close",
              "computer_screenshot",
              "computer_windows",
              "computer_wait_for_window",
            ],
            disallowedTools: [
              "task",
              "write",
              "edit",
              "apply_patch",
              "patch",
              "notebook_edit",
              "todowrite",
              "team_run",
              "orchestrator",
              "workflow",
            ],
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                // The shell tool's id and permission key stay "bash" for
                // compatibility; run_verification asks under "shell".
                bash: "allow",
                shell: "allow",
                run_verification: "allow",
                webfetch: "allow",
                websearch: "allow",
                task_status: "allow",
                tool_search: "allow",
                browser_navigate: "allow",
                browser_open: "allow",
                browser_snapshot: "allow",
                browser_click: "allow",
                browser_fill: "allow",
                browser_press: "allow",
                browser_screenshot: "allow",
                browser_console: "allow",
                browser_network: "allow",
                browser_accessibility: "allow",
                browser_close: "allow",
                computer_screenshot: "allow",
                computer_windows: "allow",
                computer_wait_for_window: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            options: {
              category: "核心",
              displayName: "验证",
            },
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {
              category: "核心",
            },
            mode: "subagent",
            native: true,
          },
          ...(flags.experimentalScout
            ? {
                scout: {
                  name: "scout",
                  permission: Permission.merge(
                    defaults,
                    Permission.fromConfig({
                      "*": "deny",
                      grep: "allow",
                      glob: "allow",
                      webfetch: "allow",
                      websearch: "allow",
                      read: "allow",
                      repo_clone: "allow",
                      repo_overview: "allow",
                      external_directory: {
                        ...readonlyExternalDirectory,
                        [path.join(Global.Path.repos, "*")]: "allow",
                      },
                    }),
                    user,
                  ),
                  description: `Docs and dependency-source specialist. Use this when you need to inspect external documentation, clone dependency repositories into the managed cache, and research library implementation details without modifying the user's workspace.`,
                  prompt: PROMPT_SCOUT,
                  options: {},
                  mode: "subagent" as const,
                  native: true,
                },
              }
            : {}),
          coordinator: {
            name: "coordinator",
            description:
              "Coordinator agent. Delegates research, implementation and verification to workers through the shared task board and agent messaging. Never edits files directly.",
            mode: "primary",
            native: true,
            prompt: PROMPT_COORDINATOR,
            tools: [
              "read",
              "grep",
              "glob",
              "list",
              "task",
              "task_status",
              "task_create",
              "task_get",
              "task_update",
              "task_list",
              "task_stop",
              "task_claim",
              "task_wait",
              "monitor",
              "subscribe",
              "tool_search",
              "agent_message",
              "agent_list",
              "team_create",
              "team_delete",
              "team_list",
              "skill",
              "webfetch",
              "websearch",
              "question",
            ],
            disallowedTools: ["write", "edit", "apply_patch", "patch", "shell", "orchestrator", "workflow"],
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                read: "allow",
                grep: "allow",
                glob: "allow",
                list: "allow",
                task: "allow",
                task_status: "allow",
                task_create: "allow",
                task_get: "allow",
                task_update: "allow",
                task_list: "allow",
                task_stop: "allow",
                task_claim: "allow",
                task_wait: "allow",
                // Monitor runs a command in the background, so a delegation-only
                // agent needs the user's go-ahead for the command itself.
                monitor: "ask",
                subscribe: "ask",
                tool_search: "allow",
                agent_message: "allow",
                agent_list: "allow",
                team_create: "allow",
                team_delete: "allow",
                team_list: "allow",
                skill: "allow",
                webfetch: "allow",
                websearch: "allow",
                question: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            options: {
              category: "核心",
              displayName: "协调者",
            },
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {
              category: "核心",
            },
          },
          title: {
            name: "title",
            mode: "primary",
            options: {
              category: "核心",
            },
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {
              category: "核心",
            },
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] =
              (key === "build" || key === "plan") && agents[DEFAULT_AGENT]
                ? {
                    ...agents[DEFAULT_AGENT],
                    name: key,
                    options: { ...agents[DEFAULT_AGENT].options },
                    permission: [...agents[DEFAULT_AGENT].permission],
                    ...(agents[DEFAULT_AGENT].tools ? { tools: [...agents[DEFAULT_AGENT].tools] } : {}),
                    ...(agents[DEFAULT_AGENT].disallowedTools
                      ? { disallowedTools: [...agents[DEFAULT_AGENT].disallowedTools] }
                      : {}),
                    native: true,
                  }
                : {
                    name: key,
                    mode: "all",
                    permission: Permission.merge(defaults, user),
                    options: {},
                    native: false,
                  }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
          item.tools = Array.isArray(value.tools) ? value.tools : item.tools
          item.disallowedTools = value.disallowedTools ?? item.disallowedTools
          item.skills = value.skills ?? item.skills
          item.mcpServers = value.mcpServers ?? item.mcpServers
          item.hooks = value.hooks ?? item.hooks
          item.permissionMode = value.permissionMode ?? item.permissionMode
          item.maxTurns = value.maxTurns ?? item.maxTurns
          item.background = value.background ?? item.background
          item.isolation = value.isolation ?? item.isolation
          item.memory = value.memory ?? item.memory
          item.initialPrompt = value.initialPrompt ?? item.initialPrompt
          item.effort = value.effort ?? item.effort
          item.outputStyle = value.outputStyle ?? item.outputStyle
        }

        const legacyDefault = cfg.default_agent === "build" || cfg.default_agent === "plan" ? cfg.default_agent : undefined
        if (legacyDefault && !agents[legacyDefault]) {
          agents[legacyDefault] = {
            ...agents[DEFAULT_AGENT],
            name: legacyDefault,
            options: { ...agents[DEFAULT_AGENT].options },
            permission: [...agents[DEFAULT_AGENT].permission],
            native: true,
          }
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
            builtInSkillPermission,
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          // `build` and `plan` remain legacy aliases for the default agent when
          // no compatibility override exists. If either name is explicitly
          // configured, preserve that configured agent so its model, prompt,
          // permissions and execution limits are not silently discarded.
          if ((agent === "build" || agent === "plan") && !agents[agent]) agent = DEFAULT_AGENT
          return agents[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          const defaultAgent = cfg.default_agent
          return pipe(
            agents,
            values(),
            filter(
              (item) =>
                (item.name !== "build" && item.name !== "plan") || item.name === defaultAgent,
            ),
            sortBy(
              [(x) => (defaultAgent ? x.name === defaultAgent : x.name === DEFAULT_AGENT), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultInfo = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          const configuredName =
            c.default_agent === "build" || c.default_agent === "plan" ? DEFAULT_AGENT : c.default_agent
          if (configuredName) {
            const agent =
              agents[configuredName] ??
              (yield* Effect.map(pluginAgents, (items) => items.find((item) => agentNameMatches(item.name, configuredName))))
            if (!agent) throw new Error(`default agent "${configuredName}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${configuredName}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${configuredName}" is hidden`)
            return agent
          }
          const visible =
            Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true) ??
            (yield* Effect.map(pluginAgents, (items) =>
              items.find((item) => item.mode !== "subagent" && item.hidden !== true),
            ))
          if (!visible) throw new Error("no primary visible agent found")
          return visible
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          return (yield* defaultInfo()).name
        })

        return {
          get,
          list,
          defaultInfo,
          defaultAgent,
        } satisfies State
      }),
    )

    const reload = Effect.fn("Agent.reload")(function* () {
      yield* config.invalidate()
      yield* InstanceState.invalidate(state)
      return yield* runtimeList(yield* InstanceState.useEffect(state, (s) => s.list()))
    })

    const pluginAgents = Effect.gen(function* () {
      const serviceOption = yield* Effect.serviceOption(PluginRuntimeService.Service)
      if (Option.isNone(serviceOption)) return [] as Info[]
      const host = yield* serviceOption.value.get
      return host.registries.agents.list().map((entry) => {
        const contribution = entry.item
        return {
          name: entry.name,
          description: contribution.description,
          mode: contribution.mode,
          hidden: false,
          prompt: typeof contribution.prompt === "string" ? contribution.prompt : "",
          permission: Permission.fromConfig(contribution.permission ?? {}),
          options: contribution.options ?? {},
          ...(contribution.model === undefined
            ? {}
            : {
                model: {
                  providerID: ProviderID.make(contribution.model.providerID),
                  modelID: ModelID.make(contribution.model.modelID),
                },
              }),
          ...(contribution.tools === undefined ? {} : { tools: [...contribution.tools] }),
          ...(contribution.disallowedTools === undefined ? {} : { disallowedTools: [...contribution.disallowedTools] }),
        } satisfies Info
      })
    })

    /**
     * Plugin activation happens during instance bootstrap, while Agent state can
     * be materialized earlier by tool/prompt initialization.  Keep the skill
     * permission allow-list live instead of freezing it at Agent.state time;
     * otherwise a newly activated marketplace skill is present on disk but the
     * current agent still denies it (and it is filtered out of the system
     * prompt).
     */
    const withCurrentSkillPermissions = Effect.fn("Agent.withCurrentSkillPermissions")(function* (agent: Info) {
      const current = yield* skill.all()
      if (current.length === 0) return agent
      const allowed = Permission.fromConfig({
        skill: Object.fromEntries(current.map((item) => [item.name, "allow" as const])),
      })
      return { ...agent, permission: Permission.merge(agent.permission, allowed) }
    })

    const runtimeList = (base: Info[]) =>
      Effect.gen(function* () {
        const configValue = yield* config.get()
        const plugins = yield* pluginAgents
        const combined = new Map(plugins.map((item) => [item.name, item]))
        for (const item of base) combined.set(item.name, item)
        const permissioned = yield* Effect.forEach([...combined.values()], withCurrentSkillPermissions)
        return sortBy(
          permissioned.filter((item) =>
            item.name !== "build" && item.name !== "plan" ||
            item.name === configValue.default_agent,
          ),
          [(x) => (configValue.default_agent ? agentNameMatches(x.name, configValue.default_agent) : x.name === DEFAULT_AGENT), "desc"],
          [(x) => x.name, "asc"],
        )
      })

    const defaultInfo = Effect.fn("Agent.defaultInfo")(function* () {
      const cfg = yield* config.get()
      const configuredName =
        cfg.default_agent === "build" || cfg.default_agent === "plan" ? DEFAULT_AGENT : cfg.default_agent
      if (!configuredName)
        return yield* InstanceState.useEffect(state, (s) => s.defaultInfo()).pipe(
          Effect.flatMap(withCurrentSkillPermissions),
        )
      const base = yield* InstanceState.useEffect(state, (s) => s.list())
      const selected =
        base.find((item) => agentNameMatches(item.name, configuredName)) ??
        (yield* Effect.map(pluginAgents, (items) => items.find((item) => agentNameMatches(item.name, configuredName))))
      if (!selected) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (selected.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (selected.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return yield* withCurrentSkillPermissions(selected)
    })

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        // Preserve configured legacy `build`/`plan` entries. Only unresolved
        // legacy names map to the current default agent.
        const requested = agent
        const cfg = yield* config.get()
        const legacyAlias = (agent === "build" || agent === "plan") && !cfg.agent?.[agent]
        if (legacyAlias) agent = DEFAULT_AGENT
        const fromBase = yield* InstanceState.useEffect(state, (s) => s.get(agent))
        if (fromBase) {
          const resolved = legacyAlias ? { ...fromBase, name: requested } : fromBase
          return yield* withCurrentSkillPermissions(resolved)
        }
        const pluginAgent = yield* Effect.map(pluginAgents, (items) => items.find((item) => agentNameMatches(item.name, agent)))
        if (!pluginAgent) return undefined
        return yield* withCurrentSkillPermissions(pluginAgent)
      }),
      list: Effect.fn("Agent.list")(function* () {
        const base = yield* InstanceState.useEffect(state, (s) => s.list())
        return yield* runtimeList(base)
      }),
      defaultInfo,
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return (yield* defaultInfo()).name
      }),
      reload,
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as Agent from "./agent"
