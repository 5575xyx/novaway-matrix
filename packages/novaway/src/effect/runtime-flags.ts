import { Config, ConfigProvider, Context, Effect, Layer } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("NOVAWAY_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: bool(name) }).pipe(Config.map((flags) => flags.experimental || flags.enabled))

export class Service extends ConfigService.Service<Service>()("@novaway/RuntimeFlags", {
  autoShare: bool("NOVAWAY_AUTO_SHARE"),
  pure: bool("NOVAWAY_PURE"),
  disableDefaultPlugins: bool("NOVAWAY_DISABLE_DEFAULT_PLUGINS"),
  disableChannelDb: bool("NOVAWAY_DISABLE_CHANNEL_DB"),
  disableEmbeddedWebUi: bool("NOVAWAY_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("NOVAWAY_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("NOVAWAY_DISABLE_LSP_DOWNLOAD"),
  skipMigrations: bool("NOVAWAY_SKIP_MIGRATIONS"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("NOVAWAY_DISABLE_CLAUDE_CODE"),
    direct: bool("NOVAWAY_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("NOVAWAY_DISABLE_CLAUDE_CODE"),
    direct: bool("NOVAWAY_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("NOVAWAY_ENABLE_EXA"),
    legacy: bool("NOVAWAY_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("NOVAWAY_ENABLE_PARALLEL"),
    legacy: bool("NOVAWAY_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("NOVAWAY_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("NOVAWAY_ENABLE_QUESTION_TOOL"),
  experimentalScout: enabledByExperimental("NOVAWAY_EXPERIMENTAL_SCOUT"),
  // 后台子代理默认开启(异步并行);显式设 NOVAWAY_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false 可关闭。
  experimentalBackgroundSubagents: Config.all({
    experimental,
    enabled: Config.boolean("NOVAWAY_EXPERIMENTAL_BACKGROUND_SUBAGENTS").pipe(Config.withDefault(true)),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled)),
  experimentalLspTy: bool("NOVAWAY_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("NOVAWAY_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("NOVAWAY_EXPERIMENTAL_OXFMT"),
  experimentalComputerControl: enabledByExperimental("NOVAWAY_EXPERIMENTAL_COMPUTER_CONTROL"),
  experimentalPlanMode: enabledByExperimental("NOVAWAY_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("NOVAWAY_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("NOVAWAY_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("NOVAWAY_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("NOVAWAY_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("NOVAWAY_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  client: Config.string("NOVAWAY_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.defaultLayer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export * as RuntimeFlags from "./runtime-flags"
