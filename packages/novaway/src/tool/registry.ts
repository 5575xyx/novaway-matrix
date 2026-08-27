import { PlanExitTool } from "./plan"
import { GoalTool } from "./goal"
import { Service as WorkflowService, defaultLayer as WorkflowDefaultLayer } from "@/workflow/workflow"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TaskStatusTool } from "./task_status"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { MemoryTool } from "./memory"
import { GenerateImageTool } from "./generate_image"
import { GenerateVideoTool } from "./generate_video"
import { GenerateNarrationTool, TTS_PROVIDERS } from "./generate_narration"
import {
  BrowserAccessibilityTool,
  BrowserClickTool,
  BrowserCloseTool,
  BrowserConsoleTool,
  BrowserFillTool,
  BrowserNavigateTool,
  BrowserNetworkTool,
  BrowserPressTool,
  BrowserScreenshotTool,
  BrowserSnapshotTool,
} from "./browser"
import { BrowserService } from "@/browser/browser"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { ConfigMemory } from "@/config/memory"
import { ConfigProvider } from "@/config/provider"
import { ProtocolRegistry } from "@novaway/llm/protocols"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { RepoCloneTool } from "./repo_clone"
import { RepoOverviewTool } from "./repo_overview"
import * as Log from "@novaway/core/util/log"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { WorkflowTool } from "./workflow"
import { OrchestratorTool } from "./orchestrator"
import { OrchestratorService, defaultLayer as OrchestratorDefaultLayer } from "@/orchestrator/orchestrator"
import { Glob } from "@novaway/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppProcess } from "@novaway/core/process"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Git } from "@/git"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { Reference } from "@/reference/reference"
import { BackgroundJob } from "@/background/job"
import { SessionStatus } from "@/session/status"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"
import { Goal } from "@/session/goal"

const log = Log.create({ service: "tool.registry" })

export function webSearchEnabled(providerID: ProviderID, flags = { exa: false, parallel: false }) {
  return providerID === ProviderID.NovaWay || flags.exa || flags.parallel
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: { providerID: ProviderID; modelID: ModelID; agent: Agent.Info }) => Effect.Effect<Tool.Def[]>
  /** Rediscover custom tools from disk for the current instance. */
  readonly reload: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ToolRegistry") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | SessionStatus.Service
  | BackgroundJob.Service
  | Provider.Service
  | Git.Service
  | Reference.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Bus.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
  | RuntimeFlags.Service
  | Auth.Service
  | BrowserService.Service
  | Goal.Service
  | WorkflowService
  | OrchestratorService
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service
    const auth = yield* Auth.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const taskStatus = yield* TaskStatusTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const repoClone = yield* RepoCloneTool
    const repoOverview = yield* RepoOverviewTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const memorytool = yield* MemoryTool
    const generateimagetool = yield* GenerateImageTool
    const generatevideotool = yield* GenerateVideoTool
    const generateNarrationTool = yield* GenerateNarrationTool
    const browserNavigate = yield* BrowserNavigateTool
    const browserSnapshot = yield* BrowserSnapshotTool
    const browserClick = yield* BrowserClickTool
    const browserFill = yield* BrowserFillTool
    const browserPress = yield* BrowserPressTool
    const browserScreenshot = yield* BrowserScreenshotTool
    const browserConsole = yield* BrowserConsoleTool
    const browserNetwork = yield* BrowserNetworkTool
    const browserAccessibility = yield* BrowserAccessibilityTool
    const browserClose = yield* BrowserCloseTool
    const goal = yield* GoalTool
    const workflow = yield* WorkflowTool
    const orchestrator = yield* OrchestratorTool
    const agent = yield* Agent.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          const entries = Object.entries(def.args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(def.args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const roots = new Set<string>(dirs)
        // Always include current project config roots so evolved tools are discoverable
        // even if config.directories was cached before .novaway existed.
        for (const base of [ctx.directory, ctx.worktree]) {
          if (!base) continue
          roots.add(path.join(base, ".novaway"))
          roots.add(path.join(base, ".NovaWay"))
        }
        const matches = Array.from(roots).flatMap((dir) => {
          try {
            return Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true })
          } catch {
            return [] as string[]
          }
        })
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        const cfg = yield* config.get()
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool
        // 后台并行开关:配置优先(可被 /后台并行 切换),回退运行时 flag。
        const backgroundSubagentsEnabled =
          cfg.experimental?.background_subagents ?? flags.experimentalBackgroundSubagents

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          task_status: Tool.init(taskStatus),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          repo_clone: Tool.init(repoClone),
          repo_overview: Tool.init(repoOverview),
          skill: Tool.init(skilltool),
          memory: Tool.init(memorytool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          generate_image: Tool.init(generateimagetool),
          generate_video: Tool.init(generatevideotool),
          generate_narration: Tool.init(generateNarrationTool),
          browser_navigate: Tool.init(browserNavigate),
          browser_open: Tool.init(browserNavigate),
          browser_snapshot: Tool.init(browserSnapshot),
          browser_click: Tool.init(browserClick),
          browser_fill: Tool.init(browserFill),
          browser_press: Tool.init(browserPress),
          browser_screenshot: Tool.init(browserScreenshot),
          browser_console: Tool.init(browserConsole),
          browser_network: Tool.init(browserNetwork),
          browser_accessibility: Tool.init(browserAccessibility),
          browser_close: Tool.init(browserClose),
          goal: Tool.init(goal),
          workflow: Tool.init(workflow),
          orchestrator: Tool.init(orchestrator),
        })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            ...(backgroundSubagentsEnabled ? [tool.task_status] : []),
            tool.fetch,
            tool.todo,
            tool.search,
            ...(flags.experimentalScout ? [tool.repo_clone, tool.repo_overview] : []),
            tool.skill,
            ...(ConfigMemory.resolve(cfg.memory).enabled ? [tool.memory] : []),
            tool.patch,
            ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ...(flags.experimentalPlanMode && flags.client === "cli" ? [tool.plan] : []),
            tool.generate_image,
            tool.generate_video,
            tool.generate_narration,
            tool.browser_navigate,
            tool.browser_open,
            tool.browser_snapshot,
            tool.browser_click,
            tool.browser_fill,
            tool.browser_press,
            tool.browser_screenshot,
            tool.browser_console,
            tool.browser_network,
            tool.browser_accessibility,
            tool.browser_close,
            tool.goal,
            tool.workflow,
            tool.orchestrator,
          ],
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const allTools = yield* all()
      const cfg = yield* config.get()
      const hasImageOutput = (pcfg: ConfigProvider.Info) =>
        Object.values(pcfg.models ?? {}).some((m) => m.modalities?.output?.includes("image"))

      const isImageProvider = (pid: string, pcfg: ConfigProvider.Info) =>
        ProtocolRegistry.listImageProviders().includes(pid) || hasImageOutput(pcfg)
      const hasAudioOutput = (pcfg: ConfigProvider.Info) =>
        Object.values(pcfg.models ?? {}).some((m) => m.modalities?.output?.includes("audio"))
      const isNarrationProvider = (pid: string, pcfg: ConfigProvider.Info) =>
        TTS_PROVIDERS.has(pid) || hasAudioOutput(pcfg)

      const imageProviderAvailable =
        Object.entries(cfg.provider ?? {}).some(([pid, pcfg]) => isImageProvider(pid, pcfg)) ||
        !!process.env.AGNES_API_KEY
      const narrationProviderAvailable =
        Object.entries(cfg.provider ?? {}).some(([pid, pcfg]) => isNarrationProvider(pid, pcfg)) ||
        ["OPENAI_API_KEY", "DASHSCOPE_API_KEY", "MINIMAX_API_KEY", "ELEVENLABS_API_KEY", "SILICONFLOW_API_KEY"].some(
          (key) => !!process.env[key],
        )
      const filtered = allTools.filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID, { exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        if (tool.id === GenerateImageTool.id || tool.id === GenerateVideoTool.id) {
          return imageProviderAvailable
        }
        if (tool.id === GenerateNarrationTool.id) return narrationProviderAvailable

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    const reload = Effect.fn("ToolRegistry.reload")(function* () {
      yield* config.invalidate()
      yield* InstanceState.invalidate(state)
      return yield* ids()
    })

    return Service.of({ ids, all, named, tools, reload })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  layer
    .pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Git.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(
      Layer.provide(AppProcess.defaultLayer),
      Layer.provide(BrowserService.defaultLayer),
      Layer.provide(RuntimeFlags.defaultLayer),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(Goal.defaultLayer),
      Layer.provide(WorkflowDefaultLayer),
      Layer.provide(OrchestratorDefaultLayer),
    ),
) as Layer.Layer<Service>

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as ToolRegistry from "./registry"
