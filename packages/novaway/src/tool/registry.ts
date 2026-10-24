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
import { MonitorTool } from "./monitor"
import { SubscribeTool } from "./subscribe"
import { CwdTool } from "./cwd"
import { WorktreeEnterTool, WorktreeExitTool } from "./worktree"
import { TaskStatusTool } from "./task_status"
import { TodoWriteTool, TodoEditTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { KnowledgeTool } from "./knowledge"
import { KnowledgeManageTool } from "./knowledge-manage"
import { RulesManageTool } from "./rules-manage"
import { EvolutionManageTool } from "./evolution-manage"
import { GitTool } from "./git"
import { KnowledgeOcrTool } from "./knowledge-ocr"
import { MemoryEmbeddingSetupTool } from "./memory-setup"
import { InstallationDoctorTool } from "./installation-doctor"
import { McpSetupTool } from "./mcp-setup"
import { ListMcpResourcesTool, ReadMcpResourceTool } from "./mcp-resources"
import { SkillInstallTool } from "./skill-install"
import { PluginInstallTool } from "./plugin-install"
import { ProviderSetupTool } from "./provider-setup"
import { LspSetupTool } from "./lsp-setup"
import { OfficeSetupTool } from "./office-setup"
import { TempFilesTool } from "./temp_files"
import { VerifyTool } from "./verify"
import {
  ComputerClickTool,
  ComputerFocusTool,
  ComputerKeyTool,
  ComputerMoveTool,
  ComputerScreenshotTool,
  ComputerScrollTool,
  ComputerTypeTool,
  ComputerWindowsTool,
} from "./computer"
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
import { MCP } from "@/mcp"
import type { SessionID } from "@/session/schema"
import {
  Service as ActivationService,
  defaultLayer as ActivationLayer,
  type Interface as ActivationInterface,
} from "./activation"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Git } from "@/git"
import { Evolution } from "@/evolution/service"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { Reference } from "@/reference/reference"
import { BackgroundJob } from "@/background/job"
import { SessionStatus } from "@/session/status"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"
import { Goal } from "@/session/goal"
import { PlanApproval } from "@/session/plan-approval"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { Service as TeamServiceInterface, defaultLayer as TeamLayer } from "@/team/team"
import { Service as AgentTaskListServiceInterface, defaultLayer as AgentTaskListLayer } from "@/team/task-list"
import { Service as AgentMailboxServiceInterface, defaultLayer as AgentMailboxLayer } from "@/team/mailbox"
import { SessionUsage } from "@/session/usage"
import {
  AgentListTool,
  AgentMessageTool,
  TaskClaimTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskStopTool,
  TaskUpdateTool,
  TaskWaitTool,
  TeamCreateTool,
  TeamDeleteTool,
  TeamListTool,
} from "./task-tools"
import { Global } from "@novaway/core/global"
import * as ExtensionLoader from "@/extension/loader"
import { contributions as extensionContributions, type Loaded as ExtensionLoaded } from "@/extension/schema"

const log = Log.create({ service: "tool.registry" })
const NL = String.fromCharCode(10)

const READ_ONLY_SHELL =
  /^\s*(ls|cat|head|tail|grep|rg|find|pwd|echo|wc|stat|file|which|type|git (status|diff|log|show|branch|rev-parse)|npm (ls|view)|bun (pm ls|--version))(?=$|[\s;&|])/i

function shellSafe(args: unknown) {
  const command =
    typeof (args as { command?: unknown })?.command === "string" ? (args as { command: string }).command : ""
  if (!command.trim()) return false
  return !/[;&|><`$]/.test(command) && READ_ONLY_SHELL.test(command)
}

/**
 * Default capability metadata for built-in tools. Orchestration reads this to
 * decide concurrency and result budgets; individual tools may override it.
 */
export const CAPABILITIES: Record<string, Tool.Capabilities> = {
  read: { readOnly: true, concurrencySafe: true, maxResultBytes: 400_000 },
  glob: { readOnly: true, concurrencySafe: true },
  grep: { readOnly: true, concurrencySafe: true },
  lsp: { readOnly: true, concurrencySafe: true },
  webfetch: { readOnly: true, concurrencySafe: true },
  websearch: { readOnly: true, concurrencySafe: true },
  task_status: { readOnly: true, concurrencySafe: true },
  repo_overview: { readOnly: true, concurrencySafe: true },
  repo_clone: { concurrencySafe: false },
  write: { destructive: true },
  edit: { destructive: true },
  apply_patch: { destructive: true },
  patch: { destructive: true },
  // Shell tool id and permission key are both "bash" (see tool/shell/id.ts).
  bash: {
    readOnly: (args) => shellSafe(args),
    concurrencySafe: (args) => shellSafe(args),
    interrupt: "cancel",
  },
  // Independent subagents operate on separate child sessions; the tool prompt
  // explicitly asks the model to launch them in parallel. Keep the interrupt
  // policy (a new user message blocks rather than cancels workers).
  task: { concurrencySafe: true, interrupt: "block" },
  orchestrator: { concurrencySafe: false },
  workflow: { concurrencySafe: false },
  question: { concurrencySafe: false },
  plan_exit: { concurrencySafe: false },
  goal: { concurrencySafe: false },
  skill: { concurrencySafe: false },
  todo: { concurrencySafe: false },
  todoedit: { concurrencySafe: false },
  generate_image: { concurrencySafe: true, deferLoading: true },
  generate_video: { concurrencySafe: true, deferLoading: true },
  generate_narration: { concurrencySafe: true, deferLoading: true },
  memory: { readOnly: true, concurrencySafe: true },
  team_create: { concurrencySafe: false },
  team_delete: { concurrencySafe: false },
  team_list: { readOnly: true, concurrencySafe: true },
  agent_list: { readOnly: true, concurrencySafe: true },
  agent_message: { concurrencySafe: false },
  task_create: { concurrencySafe: false },
  task_list: { readOnly: true, concurrencySafe: true },
  task_get: { readOnly: true, concurrencySafe: true },
  task_update: { concurrencySafe: false },
  task_claim: { concurrencySafe: false },
  task_stop: { concurrencySafe: false },
  task_wait: { readOnly: true, concurrencySafe: true },
  monitor: { concurrencySafe: true },
  subscribe: { concurrencySafe: true },
  cwd: { concurrencySafe: false },
  enter_worktree: { concurrencySafe: false },
  exit_worktree: { concurrencySafe: false },
  list_mcp_resources: { readOnly: true, concurrencySafe: true },
  read_mcp_resource: { readOnly: true, concurrencySafe: true },
  tool_search: { readOnly: true, concurrencySafe: true },
  knowledge_search: { readOnly: true, concurrencySafe: true },
  git: {
    readOnly: (args: unknown) =>
      ["status", "diff", "log", "branches"].includes(String((args as { action?: string } | undefined)?.action ?? "")),
    concurrencySafe: false,
  },
  rules_manage: {
    readOnly: (args: unknown) =>
      (args as { action?: string } | undefined)?.action !== "save" &&
      (args as { action?: string } | undefined)?.action !== "remove",
    concurrencySafe: false,
  },
  evolution_manage: {
    readOnly: (args: unknown) =>
      ["status", "preview"].includes(String((args as { action?: string } | undefined)?.action ?? "status")),
    concurrencySafe: false,
  },
  knowledge_manage: {
    readOnly: (args: unknown) => {
      const action = String((args as { action?: string } | undefined)?.action ?? "status")
      return ["status", "documents"].includes(action)
    },
    concurrencySafe: false,
    destructive: true,
  },
  knowledge_ocr: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "install",
    concurrencySafe: false,
  },
  memory_embedding_setup: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "install",
    concurrencySafe: false,
  },
  installation_doctor: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "upgrade",
    concurrencySafe: false,
  },
  lsp_setup: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "install",
    concurrencySafe: false,
  },
  skill_install: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "install",
    concurrencySafe: false,
  },
  plugin_install: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action === "status",
    concurrencySafe: false,
  },
  office_setup: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "verify",
    concurrencySafe: false,
  },
  provider_setup: {
    readOnly: (args: unknown) => (args as { action?: string } | undefined)?.action !== "configure",
    concurrencySafe: false,
  },
  mcp_setup: {
    readOnly: (args: unknown) =>
      !["connect", "add"].includes(String((args as { action?: string } | undefined)?.action ?? "status")),
    concurrencySafe: false,
  },
}

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
  readonly tools: (model: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
    /** Session used for deferred-tool activation. Omit to include every tool. */
    sessionID?: SessionID
  }) => Effect.Effect<Tool.Def[]>
  /** 已激活的延迟工具（tool_search / mcp_tool_search 共用同一份会话状态）。 */
  readonly activeTools: (sessionID: SessionID) => Effect.Effect<string[]>
  /** 激活延迟工具；下一轮 resolveTools 会带上完整 schema。 */
  readonly activateTools: (sessionID: SessionID, toolIDs: readonly string[]) => Effect.Effect<void>
  /** Rediscover custom tools from disk for the current instance. */
  readonly reload: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/ToolRegistry") {}

/**
 * Resolve a tool only when its service is present in the current layer stack.
 *
 * Collaboration and planning tools (teams, tasks, goals, workflows) are
 * optional capabilities: embedders and tests that compose a minimal layer
 * should still get a working registry, just without those tools.
 */
const optional = (tag: any, effect: Effect.Effect<any, any, any>): Effect.Effect<any, never, never> =>
  Effect.serviceOption(tag).pipe(
    Effect.flatMap((option) =>
      option._tag === "Some" ? effect.pipe(Effect.provideService(tag, option.value)) : Effect.succeed(undefined as any),
    ),
    Effect.orDie,
  ) as Effect.Effect<any, never, never>

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
  | MCP.Service
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
  | Session.Service
  | Agent.Service
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
    const activation = yield* ActivationService

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const taskStatus = yield* TaskStatusTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const todoEdit = yield* TodoEditTool
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
    const knowledgeSearch = yield* KnowledgeTool
    const knowledgeOcr = yield* KnowledgeOcrTool
    const knowledgeManage = yield* KnowledgeManageTool
    const rulesManage = yield* RulesManageTool
    const evolutionManage = yield* optional(Evolution.Service, EvolutionManageTool)
    const gittool = yield* GitTool
    const memoryEmbeddingSetup = yield* MemoryEmbeddingSetupTool
    const installationDoctor = yield* InstallationDoctorTool
    const lspSetup = yield* LspSetupTool
    const mcpSetup = yield* optional(MCP.Service, McpSetupTool)
    const listMcpResourcesTool = yield* optional(MCP.Service, ListMcpResourcesTool)
    const readMcpResourceTool = yield* optional(MCP.Service, ReadMcpResourceTool)
    const providerSetup = yield* ProviderSetupTool
    // Loaded lazily: office/platform imports SessionPrompt, which imports this
    // registry. A static import creates an initialization cycle (TDZ on
    // defaultLayer), so the module is imported on demand and the service is
    // resolved inside the tool itself.
    const officeSetup = yield* Effect.promise(async () => (await import("./office-setup")).OfficeSetupTool).pipe(
      Effect.flatMap((effect) => effect),
    )
    const skillInstall = yield* SkillInstallTool
    const pluginInstall = yield* PluginInstallTool
    const tempFilesTool = yield* TempFilesTool
    const verifyTool = yield* VerifyTool
    const computerScreenshot = yield* ComputerScreenshotTool
    const computerClick = yield* ComputerClickTool
    const computerMove = yield* ComputerMoveTool
    const computerType = yield* ComputerTypeTool
    const computerKey = yield* ComputerKeyTool
    const computerScroll = yield* ComputerScrollTool
    const computerWindows = yield* ComputerWindowsTool
    const computerFocus = yield* ComputerFocusTool
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
    const goal = yield* optional(Goal.Service, GoalTool)
    const workflow = yield* optional(WorkflowService, WorkflowTool)
    const orchestrator = yield* optional(OrchestratorService, OrchestratorTool)
    const agent = yield* Agent.Service
    const monitorTool = yield* MonitorTool
    const subscribeTool = yield* SubscribeTool
    const cwdTool = yield* CwdTool
    const worktreeEnterTool = yield* WorktreeEnterTool
    const worktreeExitTool = yield* WorktreeExitTool
    const teamTool = yield* optional(TeamServiceInterface, TeamCreateTool)
    const teamDeleteTool = yield* optional(TeamServiceInterface, TeamDeleteTool)
    const teamListTool = yield* optional(TeamServiceInterface, TeamListTool)
    const agentListTool = yield* optional(TeamServiceInterface, AgentListTool)
    const agentMessageTool = yield* optional(AgentMailboxServiceInterface, AgentMessageTool)
    const taskCreateTool = yield* optional(AgentTaskListServiceInterface, TaskCreateTool)
    const taskListTool = yield* optional(AgentTaskListServiceInterface, TaskListTool)
    const taskGetTool = yield* optional(AgentTaskListServiceInterface, TaskGetTool)
    const taskUpdateTool = yield* optional(AgentTaskListServiceInterface, TaskUpdateTool)
    const taskClaimTool = yield* optional(AgentTaskListServiceInterface, TaskClaimTool)
    const taskStopTool = yield* optional(BackgroundJob.Service, TaskStopTool)
    const taskWaitTool = yield* optional(AgentTaskListServiceInterface, TaskWaitTool)

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
        const extensions: ExtensionLoaded[] = yield* Effect.promise(() =>
          ExtensionLoader.scanCached({
            config: Global.Path.config,
            home: Global.Path.home,
            directory: ctx.directory,
            worktree: ctx.worktree,
          }),
        ).pipe(Effect.catch(() => Effect.succeed([] as ExtensionLoaded[])))
        for (const extension of extensions) {
          if (!extension.enabled) continue
          for (const contribution of extensionContributions(extension)) {
            if (contribution.kind !== "tool") continue
            const target = path.resolve(extension.root, contribution.path)
            try {
              const stat = Glob.scanSync("*", { cwd: target, absolute: true, dot: true, symlink: true })
              matches.push(...stat.filter((file) => /\.(js|ts)$/.test(file)))
            } catch {
              if (/\.(js|ts)$/.test(target)) matches.push(target)
            }
          }
        }
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
        const deferBuiltin = cfg.experimental?.defer_loading ?? true
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool
        // 后台并行开关:配置优先(可被 /后台并行 切换),回退运行时 flag。
        const backgroundSubagentsEnabled =
          cfg.experimental?.background_subagents ?? flags.experimentalBackgroundSubagents
        const computerControlEnabled = cfg.experimental?.computer_control ?? flags.experimentalComputerControl

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
          todoEdit: Tool.init(todoEdit),
          search: Tool.init(websearch),
          repo_clone: Tool.init(repoClone),
          repo_overview: Tool.init(repoOverview),
          skill: Tool.init(skilltool),
          memory: Tool.init(memorytool),
          knowledge_search: Tool.init(knowledgeSearch),
          knowledge_ocr: Tool.init(knowledgeOcr),
          knowledge_manage: Tool.init(knowledgeManage),
          rules_manage: Tool.init(rulesManage),
          evolution_manage: evolutionManage ? Tool.init(evolutionManage) : Effect.succeed(undefined),
          git: Tool.init(gittool),
          memory_embedding_setup: Tool.init(memoryEmbeddingSetup),
          installation_doctor: Tool.init(installationDoctor),
          lsp_setup: Tool.init(lspSetup),
          mcp_setup: mcpSetup ? Tool.init(mcpSetup) : Effect.succeed(undefined),
          list_mcp_resources: listMcpResourcesTool
            ? Tool.init(listMcpResourcesTool)
            : Effect.succeed(undefined),
          read_mcp_resource: readMcpResourceTool ? Tool.init(readMcpResourceTool) : Effect.succeed(undefined),
          provider_setup: Tool.init(providerSetup),
          // office_setup 的运行期服务（OfficePlatform）在工具内部按需解析，
          // 这里把它当作无依赖工具注册。
          office_setup: Tool.init(officeSetup as any),
          skill_install: Tool.init(skillInstall),
          plugin_install: Tool.init(pluginInstall),
          cleanup_temp_files: Tool.init(tempFilesTool),
          run_verification: Tool.init(verifyTool),
          computer_screenshot: Tool.init(computerScreenshot),
          computer_click: Tool.init(computerClick),
          computer_move: Tool.init(computerMove),
          computer_type: Tool.init(computerType),
          computer_key: Tool.init(computerKey),
          computer_scroll: Tool.init(computerScroll),
          computer_windows: Tool.init(computerWindows),
          computer_focus: Tool.init(computerFocus),
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
          goal: goal ? Tool.init(goal) : Effect.succeed(undefined),
          workflow: workflow ? Tool.init(workflow) : Effect.succeed(undefined),
          orchestrator: orchestrator ? Tool.init(orchestrator) : Effect.succeed(undefined),
          team_create: teamTool ? Tool.init(teamTool) : Effect.succeed(undefined),
          team_delete: teamDeleteTool ? Tool.init(teamDeleteTool) : Effect.succeed(undefined),
          team_list: teamListTool ? Tool.init(teamListTool) : Effect.succeed(undefined),
          agent_list: agentListTool ? Tool.init(agentListTool) : Effect.succeed(undefined),
          agent_message: agentMessageTool ? Tool.init(agentMessageTool) : Effect.succeed(undefined),
          task_create: taskCreateTool ? Tool.init(taskCreateTool) : Effect.succeed(undefined),
          task_list: taskListTool ? Tool.init(taskListTool) : Effect.succeed(undefined),
          task_get: taskGetTool ? Tool.init(taskGetTool) : Effect.succeed(undefined),
          task_update: taskUpdateTool ? Tool.init(taskUpdateTool) : Effect.succeed(undefined),
          task_claim: taskClaimTool ? Tool.init(taskClaimTool) : Effect.succeed(undefined),
          task_stop: taskStopTool ? Tool.init(taskStopTool) : Effect.succeed(undefined),
          task_wait: taskWaitTool ? Tool.init(taskWaitTool) : Effect.succeed(undefined),
          monitor: Tool.init(monitorTool),
          subscribe: Tool.init(subscribeTool),
          cwd: Tool.init(cwdTool),
          enter_worktree: Tool.init(worktreeEnterTool),
          exit_worktree: Tool.init(worktreeExitTool),
        })

        const decorate = <T extends Tool.Def>(def: T): T =>
          ({
            ...def,
            capabilities: {
              readOnly: false,
              concurrencySafe: false,
              // Long-tail tools are hidden from the first request unless the
              // user opted in; `tool_search` activates them per session.
              ...(def.id.startsWith("browser_") || def.id.startsWith("generate_") ? { deferLoading: true } : {}),
              ...CAPABILITIES[def.id],
              ...def.capabilities,
            },
          }) as T

        const builtinList = [
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
          tool.todoEdit,
          tool.search,
          ...(flags.experimentalScout ? [tool.repo_clone, tool.repo_overview] : []),
          tool.skill,
          ...(ConfigMemory.resolve(cfg.memory).enabled ? [tool.memory] : []),
          tool.knowledge_search,
          tool.knowledge_ocr,
          tool.knowledge_manage,
          tool.rules_manage,
          ...(tool.evolution_manage ? [tool.evolution_manage] : []),
          tool.git,
          tool.memory_embedding_setup,
          tool.installation_doctor,
          tool.lsp_setup,
          tool.mcp_setup!,
          tool.list_mcp_resources!,
          tool.read_mcp_resource!,
          tool.provider_setup,
          tool.office_setup,
          tool.skill_install,
          tool.plugin_install,
          tool.cleanup_temp_files,
          tool.run_verification,
          ...(computerControlEnabled
            ? [
                tool.computer_screenshot,
                tool.computer_click,
                tool.computer_move,
                tool.computer_type,
                tool.computer_key,
                tool.computer_scroll,
                tool.computer_windows,
                tool.computer_focus,
              ]
            : []),
          tool.patch,
          ...(flags.experimentalLspTool ? [tool.lsp] : []),
          ...(flags.experimentalPlanMode && flags.client === "cli" ? [tool.plan] : []),
          tool.generate_image,
          tool.generate_video,
          tool.generate_narration,
          tool.monitor,
          tool.subscribe,
          tool.cwd,
          tool.enter_worktree,
          tool.exit_worktree,
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
          tool.goal!,
          tool.workflow!,
          tool.orchestrator!,
          tool.team_create!,
          tool.team_delete,
          tool.team_list,
          tool.agent_list,
          tool.agent_message,
          tool.task_create,
          tool.task_list,
          tool.task_get,
          tool.task_update,
          tool.task_claim,
          tool.task_wait,
          tool.task_stop,
        ]
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
          .map(decorate)

        // When deferred loading is on, name the hidden tools in the search
        // description. Names cost a few dozen tokens; full schemas cost far
        // more and most sessions never touch these tools.
        const deferredNames = deferBuiltin
          ? [...builtinList, ...custom.map(decorate)]
              .filter((item) => item.capabilities?.deferLoading)
              .map((item) => item.id)
          : []

        const search: Tool.Def = {
          id: "tool_search",
          description: [
            "Search available tools by name or keyword. Use it to discover tools that are not in the current prompt.",
            deferredNames.length > 0
              ? `Currently deferred (call tool_search with "select:<id>" to load): ${deferredNames.join(", ")}`
              : undefined,
          ]
            .filter(Boolean)
            .join(String.fromCharCode(10)),
          parameters: Schema.Struct({
            query: Schema.String.annotate({
              description: 'Keywords to search tool names and descriptions. Use "select:<tool_id>" for a direct match.',
            }),
            max_results: Schema.optional(Schema.Number).annotate({ description: "Maximum results (default 5)" }),
          }),
          capabilities: { readOnly: true, concurrencySafe: true },
          execute: (args, ctx) =>
            Effect.gen(function* () {
              const query = String((args as { query?: unknown }).query ?? "")
              const limit = Math.max(1, Math.min(Number((args as { max_results?: unknown }).max_results ?? 5) || 5, 20))
              const allDefs = [...builtinList, ...custom.map(decorate)]
              const select = /^select:(.+)$/i.exec(query.trim())
              const matches = select
                ? allDefs.filter((item) => item.id === select[1]?.trim())
                : allDefs
                    .map((item) => {
                      const q = query.toLowerCase()
                      const name = item.id.toLowerCase()
                      const text = item.description.toLowerCase()
                      const words = q.split(/\s+/).filter(Boolean)
                      const score =
                        name === q
                          ? 100
                          : name.startsWith(q)
                            ? 80
                            : name.includes(q)
                              ? 60
                              : words.length && words.every((word) => text.includes(word))
                                ? 40
                                : 0
                      return { item, score }
                    })
                    .filter((entry) => entry.score > 0)
                    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
                    .map((entry) => entry.item)
              const top = matches.slice(0, limit)
              // Activate what was found so the next request includes the full
              // schema for these tools.
              if (ctx?.sessionID) {
                yield* activation.activate(
                  ctx.sessionID,
                  top.map((item) => item.id),
                )
              }
              const output =
                top.length === 0
                  ? `No tools matched "${query}".`
                  : top.map((item) => `- ${item.id}: ${item.description.split(NL)[0]}`).join(NL)
              return {
                title: `${top.length} tools`,
                output,
                metadata: { matches: top.map((item) => item.id), total: allDefs.length },
              }
            }).pipe(Effect.orDie),
        } as Tool.Def

        return {
          custom: custom.map(decorate),
          builtin: [search, ...builtinList],
          task: decorate(tool.task),
          read: decorate(tool.read),
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
      const allow = input.agent.tools?.length ? new Set(input.agent.tools) : undefined
      const deny = new Set(input.agent.disallowedTools ?? [])
      const deferBuiltin = cfg.experimental?.defer_loading ?? true
      const deferEnabled = deferBuiltin && input.sessionID !== undefined
      const activated = deferEnabled && input.sessionID ? new Set(yield* activation.list(input.sessionID)) : undefined
      const filtered = allTools.filter((tool) => {
        if (allow && !allow.has("*") && !allow.has(tool.id)) return false
        if (deny.has(tool.id)) return false
        // Deferred tools stay out of the request until tool_search activates
        // them for this session.
        if (deferEnabled && tool.capabilities?.deferLoading && !activated?.has(tool.id)) return false
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
            capabilities: tool.capabilities,
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

    const activeTools: Interface["activeTools"] = Effect.fn("ToolRegistry.activeTools")(function* (sessionID) {
      return yield* activation.list(sessionID)
    })

    const activateTools: Interface["activateTools"] = Effect.fn("ToolRegistry.activateTools")(
      function* (sessionID, toolIDs) {
        yield* activation.activate(sessionID, toolIDs)
      },
    )

    const reload = Effect.fn("ToolRegistry.reload")(function* () {
      yield* config.invalidate()
      yield* InstanceState.invalidate(state)
      return yield* ids()
    })

    return Service.of({ ids, all, named, tools, reload, activeTools, activateTools })
  }),
).pipe(
  // Collaboration services are self-contained (Database only). Providing them
  // here keeps `ToolRegistry.layer` usable on its own, which matters for tests
  // and for embedders that compose a minimal layer stack.
  Layer.provide(TeamLayer),
  Layer.provide(AgentTaskListLayer),
  Layer.provide(AgentMailboxLayer),
  Layer.provide(SessionUsage.defaultLayer),
  Layer.provide(HookLayer),
  Layer.provide(Goal.defaultLayer),
  Layer.provide(WorkflowDefaultLayer),
  Layer.provide(OrchestratorDefaultLayer),
  Layer.provide(ActivationLayer),
  Layer.provide(PlanApproval.defaultLayer),
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
      Layer.provide(Evolution.defaultLayer),
      Layer.provide(MCP.defaultLayer),
      Layer.provide(AppProcess.defaultLayer),
      Layer.provide(BrowserService.defaultLayer),
      Layer.provide(RuntimeFlags.defaultLayer),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(Goal.defaultLayer),
      Layer.provide(WorkflowDefaultLayer),
      Layer.provide(OrchestratorDefaultLayer),
      Layer.provide(TeamLayer),
      Layer.provide(HookLayer),
      Layer.provide(AgentTaskListLayer),
      Layer.provide(AgentMailboxLayer),
      Layer.provide(SessionUsage.defaultLayer),
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
