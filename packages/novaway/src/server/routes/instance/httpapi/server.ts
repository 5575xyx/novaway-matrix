import { Config as EffectConfig, Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import {
  FetchHttpClient,
  HttpClient,
  HttpMiddleware,
  HttpServerRequest,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { AppFileSystem } from "@novaway/core/filesystem"
import { AppProcess } from "@novaway/core/process"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Command } from "@/command"
import * as Observability from "@novaway/core/effect/observability"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { Git } from "@/git"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ClientCapabilities } from "@/effect/client-capabilities"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Elicitation } from "@/mcp/elicitation"
import { Permission } from "@/permission"
import { Installation } from "@/installation"
import { InstanceLayer } from "@/project/instance-layer"
import { Plugin } from "@/plugin"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import { Project } from "@/project/project"
import { ProviderAuth } from "@/provider/auth"
import { ModelsDev } from "@novaway/core/models-dev"
import { Provider } from "@/provider/provider"
import { Pty } from "@/pty"
import { PtyTicket } from "@/pty/ticket"
import { Question } from "@/question"
import { PlatformWebview } from "@/platform-webview"
import { Reference } from "@/reference/reference"
import { Stats } from "@/stats/service"
import { defaultLayer as TeamProfileLayer } from "@/team/profile"
import { Session } from "@/session/session"
import { SessionPortability } from "@/session/portability"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionCheckpoint } from "@/session/checkpoint"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Goal } from "@/session/goal"
import { defaultLayer as WorkflowDefaultLayer } from "@/workflow/workflow"
import { defaultLayer as WorkflowPolicyLayer } from "@/workflow/policy"
import { defaultLayer as OrchestratorDefaultLayer } from "@/orchestrator/orchestrator"
import { defaultLayer as SuperAgentStoreLayer } from "@/super-agent/store"
import { defaultLayer as DreamDefaultLayer } from "@/session/dream"
import { defaultLayer as DistillDefaultLayer } from "@/session/distill"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { SyncEvent } from "@/sync"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { Workspace } from "@/control-plane/workspace"
import { CorsConfig, isAllowedCorsOrigin, type CorsOptions } from "@/server/cors"
import { serveUIEffect } from "@/server/shared/ui"
import { ServerAuth } from "@/server/auth"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { PublicApi } from "./public"
import { authorizationLayer, authorizationRouterMiddleware } from "./middleware/authorization"
import { EventApi } from "./groups/event"
import { eventHandlers } from "./handlers/event"
import { chatHandlers } from "./handlers/chat"
import { checkpointHandlers } from "./handlers/checkpoint"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { experimentalHandlers } from "./handlers/experimental"
import { evolutionHandlers } from "./handlers/evolution"
import { extensionHandlers } from "./handlers/extension"
import { pluginHandlers } from "./handlers/plugin"
import { fileHandlers } from "./handlers/file"
import { gitHandlers } from "./handlers/git"
import { hookHandlers } from "./handlers/hook"
import { databaseHandlers } from "./handlers/database"
import { knowledgeHandlers } from "./handlers/knowledge"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { kernelHandlers } from "./handlers/kernel"
import { missionHandlers } from "./handlers/mission"
import { profileHandlers } from "./handlers/profile"
import { statsHandlers } from "./handlers/stats"
import { mcpHandlers } from "./handlers/mcp"
import { memoryHandlers } from "./handlers/memory"
import { officeHandlers } from "./handlers/office"
import { officePlatformHandlers } from "./handlers/office-platform"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectRoute, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { platformWebviewHandlers } from "./handlers/platform-webview"
import { elicitationHandlers } from "./handlers/elicitation"
import { sessionHandlers } from "./handlers/session"
import { settingsHandlers } from "./handlers/settings"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { v2Handlers } from "./handlers/v2"
import { workspaceHandlers } from "./handlers/workspace"
import { imagesHandlers } from "./handlers/images"
import { videosHandlers } from "./handlers/videos"
import { goalHandlers } from "./handlers/goal"
import { workflowHandlers } from "./handlers/workflow"
import { dynamicWorkflowHandlers } from "./handlers/dynamic-workflow"
import { arenaHandlers } from "./handlers/arena"
import { orchestratorHandlers } from "./handlers/orchestrator"
import { superAgentHandlers } from "./handlers/super-agent"
import { runHandlers } from "./handlers/run"
import { teamHandlers } from "./handlers/team"
import { ExtensionLayer } from "@/extension"
import { defaultLayer as PlanApprovalLayer } from "@/session/plan-approval"
import { defaultLayer as DocumentReviewLayer } from "@/session/document-review"
import { defaultLayer as HookServiceLayer } from "@/hook/service"
import { defaultLayer as TeamLayer } from "@/team/team"
import { defaultLayer as TeamMissionLayer } from "@/team/mission"
import { defaultLayer as TeamRunLayer } from "@/team/run"
import { defaultLayer as TeamVerificationLayer } from "@/team/verification"
import { defaultLayer as TeamOrchestratorLayer } from "@/team/orchestrator"
import { defaultLayer as TeamLedgerLayer } from "@/team/ledger"
import { defaultLayer as TeamOpLogLayer } from "@/team/op-log"
import { defaultLayer as AgentTaskListLayer } from "@/team/task-list"
import { defaultLayer as AgentMailboxLayer } from "@/team/mailbox"
import { SessionUsage } from "@/session/usage"
import { BackgroundResume } from "@/background/resume"
import { instanceContextLayer, instanceRouterMiddleware } from "./middleware/instance-context"
import { workspaceRouterMiddleware, workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@novaway/core/effect/memo-map"
import { compressionLayer } from "./middleware/compression"
import { corsVaryFix } from "./middleware/cors-vary"
import { errorLayer } from "./middleware/error"
import { fenceLayer } from "./middleware/fence"
import { schemaErrorLayer } from "./middleware/schema-error"
import { Database } from "@/database"
import { Evolution } from "@/evolution/service"
import { Memory } from "@/memory/service"
import { OfficePlatform } from "@/office/platform"

export const context = Context.makeUnsafe<unknown>(new Map())

const cors = (corsOptions?: CorsOptions) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, corsOptions),
      maxAge: 86_400,
    }),
    { global: true },
  )

// Route tree:
// - rootApiRoutes: typed /global/* and control routes; auth is declared by RootHttpApi.
// - eventApiRoutes/rawInstanceRoutes: raw instance routes; auth and workspace routing happen as router middleware.
// - instanceApiRoutes: schema routes; auth is declared on each group and workspace context is provided below.
// - uiRoute: raw catch-all fallback; auth is router middleware so public static assets can bypass it.
const authOnlyRouterLayer = authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const httpApiAuthLayer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(
  Layer.provide([controlHandlers, globalHandlers]),
  Layer.provide(schemaErrorLayer),
  Layer.provide(httpApiAuthLayer),
)
const instanceRouterLayer = authorizationRouterMiddleware
  .combine(instanceRouterMiddleware)
  .combine(workspaceRouterMiddleware)
  .layer.pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(ServerAuth.Config.defaultLayer),
    // The router middleware restarts resumable background watchers.
    Layer.provide(BackgroundResume.defaultLayer),
  )
const eventApiRoutes = HttpApiBuilder.layer(EventApi).pipe(
  Layer.provide(eventHandlers),
  Layer.provide(instanceRouterLayer),
)
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    chatHandlers,
    checkpointHandlers,
    configHandlers,
    experimentalHandlers,
    evolutionHandlers,
    extensionHandlers,
    pluginHandlers,
    fileHandlers,
    gitHandlers,
    hookHandlers,
    databaseHandlers,
    knowledgeHandlers,
    imagesHandlers,
    instanceHandlers,
    kernelHandlers,
    statsHandlers,
    profileHandlers,
    missionHandlers,
    mcpHandlers,
    memoryHandlers,
    officeHandlers,
    officePlatformHandlers,
    projectHandlers,
    ptyHandlers,
    questionHandlers,
    platformWebviewHandlers,
    elicitationHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    settingsHandlers,
    syncHandlers,
    v2Handlers,
    videosHandlers,
    tuiHandlers,
    workspaceHandlers,
    goalHandlers,
    workflowHandlers,
    dynamicWorkflowHandlers,
    orchestratorHandlers,
    superAgentHandlers,
    arenaHandlers,
    runHandlers,
    teamHandlers,
  ]),
)

const mediaPreviewRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const file = yield* File.Service
    const tickets = yield* PtyTicket.Service
    yield* router.add("GET", File.MEDIA_PREVIEW_PATH, (request) =>
      Effect.gen(function* () {
        const range = request.headers.range
        const requestURL = new URL(request.url, "http://localhost")
        const match = range && /^bytes=(\d*)-(\d*)$/.exec(range)
        const start = match?.[1] ? Number(match[1]) : undefined
        const end = match?.[2] ? Number(match[2]) : undefined
        const query = yield* HttpServerRequest.schemaSearchParams(Schema.Struct({ path: Schema.String }))
        const ticket = requestURL.searchParams.get("ticket")
        const scope = yield* PtyTicket.scope
        if (ticket) {
          const authorized = yield* tickets.consumeMedia({ ticket, path: query.path, ...scope })
          if (!authorized) return HttpServerResponse.empty({ status: 403 })
        } else {
          const authConfig = yield* ServerAuth.Config
          if (ServerAuth.required(authConfig)) return HttpServerResponse.empty({ status: 401 })
        }

        const validRange = !!match && (!!match[1] || !!match[2])
        if (
          !validRange ||
          (start !== undefined && !Number.isSafeInteger(start)) ||
          (end !== undefined && !Number.isSafeInteger(end))
        )
          return HttpServerResponse.empty({
            status: range ? 416 : 400,
            headers: range ? { "Content-Range": "bytes */*" } : {},
          })

        const infoResult = yield* file
          .readMediaRange(query.path, 0, 1)
          .pipe(Effect.match({ onFailure: (error) => ({ error }), onSuccess: ({ size }) => ({ size }) }))
        if ("error" in infoResult)
          return HttpServerResponse.empty({ status: infoResult.error.code === "not_found" ? 404 : 416 })
        const info = infoResult
        if (info.size === 0) return HttpServerResponse.empty({ status: 416, headers: { "Content-Range": "bytes */0" } })

        if (start === undefined && end === 0)
          return HttpServerResponse.empty({ status: 416, headers: { "Content-Range": `bytes */${info.size}` } })

        const offset = start ?? Math.max(0, info.size - Math.min(end ?? 0, File.MEDIA_PREVIEW_RANGE_MAX_BYTES))
        if (offset >= info.size)
          return HttpServerResponse.empty({ status: 416, headers: { "Content-Range": `bytes */${info.size}` } })
        const requestedEnd = start === undefined ? info.size - 1 : (end ?? info.size - 1)
        if (requestedEnd < offset)
          return HttpServerResponse.empty({ status: 416, headers: { "Content-Range": `bytes */${info.size}` } })
        const length = Math.min(File.MEDIA_PREVIEW_RANGE_MAX_BYTES, requestedEnd - offset + 1, info.size - offset)

        const result = yield* file.readMediaRange(query.path, offset, length).pipe(
          Effect.match({
            onFailure: (error) =>
              HttpServerResponse.empty({
                status: error.code === "not_found" ? 404 : 416,
                headers: error.code === "not_found" ? {} : { "Content-Range": `bytes */${info.size}` },
              }),
            onSuccess: (data) =>
              HttpServerResponse.uint8Array(data.content, {
                status: 206,
                contentType: data.mimeType,
                headers: {
                  "Accept-Ranges": "bytes",
                  "Content-Range": `bytes ${data.offset}-${data.offset + data.content.byteLength - 1}/${data.size}`,
                  "Content-Length": String(data.content.byteLength),
                  "Cache-Control": "private, no-store",
                  "X-Content-Type-Options": "nosniff",
                },
              }),
          }),
        )
        return result
      }),
    )
  }),
)
const rawInstanceRoutes = Layer.mergeAll(ptyConnectRoute, mediaPreviewRoute).pipe(Layer.provide(instanceRouterLayer))
const instanceRoutes = Layer.mergeAll(rawInstanceRoutes, instanceApiRoutes).pipe(
  Layer.provide([
    httpApiAuthLayer,
    workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    instanceContextLayer.pipe(Layer.provide(BackgroundResume.defaultLayer)),
    schemaErrorLayer,
  ]),
)

// `OpenApi.fromApi` is non-trivial; defer until /doc is actually hit so
// processes that never serve it (CLI, scripts) don't pay at module load.
// `HttpServerResponse.jsonUnsafe` runs JSON.stringify eagerly, so caching
// the response also caches the serialized body — every /doc request reuses
// the same Uint8Array instead of re-stringifying the spec.
const docResponse = lazy(() => HttpServerResponse.jsonUnsafe(OpenApi.fromApi(PublicApi)))

const docRoute = HttpRouter.use((router) => router.add("GET", "/doc", () => Effect.succeed(docResponse()))).pipe(
  Layer.provide(authOnlyRouterLayer),
)

const uiRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const client = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    yield* router.add("*", "/*", (request) =>
      serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
    )
  }),
).pipe(Layer.provide(authOnlyRouterLayer))

type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>

export function createRoutes(
  corsOptions?: CorsOptions,
): Layer.Layer<never, EffectConfig.ConfigError, RouteRequirements> {
  return Layer.mergeAll(rootApiRoutes, eventApiRoutes, instanceRoutes, docRoute, uiRoute).pipe(
    Layer.provide([
      errorLayer,
      compressionLayer,
      corsVaryFix,
      fenceLayer,
      cors(corsOptions),
      Agent.defaultLayer,
      BackgroundJob.defaultLayer,
      Auth.defaultLayer,
      Command.defaultLayer,
      ExtensionLayer,
      PlanApprovalLayer,
      DocumentReviewLayer,
      HookServiceLayer,
      TeamLayer,
      AgentTaskListLayer,
      AgentMailboxLayer,
      SessionUsage.defaultLayer,
      Config.defaultLayer,
      Database.defaultLayer,
      File.defaultLayer,
      FileWatcher.defaultLayer,
      Format.defaultLayer,
      Git.defaultLayer,
      LSP.defaultLayer,
      Installation.defaultLayer,
      MCP.defaultLayer,
      OfficePlatform.defaultLayer,
      ModelsDev.defaultLayer,
      Permission.defaultLayer,
      Plugin.defaultLayer,
      PluginRuntimeService.defaultLayer,
      Project.defaultLayer,
      ProviderAuth.defaultLayer,
      Provider.defaultLayer,
      Pty.defaultLayer,
      PtyTicket.defaultLayer,
      Question.defaultLayer,
      PlatformWebview.defaultLayer,
      Elicitation.defaultLayer,
      Reference.defaultLayer,
      Ripgrep.defaultLayer,
      RuntimeFlags.defaultLayer,
      ClientCapabilities.defaultLayer,
      Session.defaultLayer,
      SessionCompaction.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionRevert.defaultLayer,
      SessionCheckpoint.defaultLayer,
      SessionShare.defaultLayer,
      SessionRunState.defaultLayer,
      SessionStatus.defaultLayer,
      SessionSummary.defaultLayer,
      SessionPortability.defaultLayer,
      Stats.defaultLayer,
      TeamProfileLayer,
      ShareNext.defaultLayer,
      Snapshot.defaultLayer,
      SyncEvent.defaultLayer,
      EventV2Bridge.defaultLayer,
      Layer.mergeAll(Bus.layer, Evolution.layer, Memory.layer).pipe(Layer.provide(Bus.layer)),
      Skill.defaultLayer,
      Todo.defaultLayer,
      Goal.defaultLayer,
      WorkflowDefaultLayer,
      WorkflowPolicyLayer,
      OrchestratorDefaultLayer,
      SuperAgentStoreLayer,
      TeamRunLayer,
      TeamMissionLayer,
      TeamVerificationLayer,
      TeamLedgerLayer,
      TeamOpLogLayer,
      TeamOrchestratorLayer,
      DreamDefaultLayer,
      DistillDefaultLayer,
      ToolRegistry.defaultLayer,
      Vcs.defaultLayer,
      Workspace.defaultLayer,
      Worktree.appLayer,
      AppFileSystem.defaultLayer,
      AppProcess.defaultLayer,
      FetchHttpClient.layer,
      HttpServer.layerServices,
    ]),
    Layer.provide(Layer.succeed(CorsConfig)(corsOptions)),
    Layer.provide(InstanceLayer.layer),
    Layer.provide(Observability.layer),
  )
}

export const routes = createRoutes()

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as HttpApiApp from "./server"
