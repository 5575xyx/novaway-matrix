import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { ChatApi } from "./groups/chat"
import { CheckpointApi } from "./groups/checkpoint"
import { ConfigApi } from "./groups/config"
import { ControlApi } from "./groups/control"
import { EventApi } from "./groups/event"
import { ExperimentalApi } from "./groups/experimental"
import { EvolutionApi } from "./groups/evolution"
import { ExtensionApi } from "./groups/extension"
import { FileApi } from "./groups/file"
import { GitApi } from "./groups/git"
import { GlobalApi } from "./groups/global"
import { HookApi } from "./groups/hook"
import { ImagesApi } from "./groups/images"
import { DatabaseApi } from "./groups/database"
import { KnowledgeApi } from "./groups/knowledge"
import { InstanceApi } from "./groups/instance"
import { KernelApi } from "./groups/kernel"
import { McpApi } from "./groups/mcp"
import { MemoryApi } from "./groups/memory"
import { OfficeApi } from "./groups/office"
import { OfficePlatformApi } from "./groups/office-platform"
import { PermissionApi } from "./groups/permission"
import { ProjectApi } from "./groups/project"
import { ProviderApi } from "./groups/provider"
import { PtyApi, PtyConnectApi } from "./groups/pty"
import { QuestionApi } from "./groups/question"
import { ElicitationApi } from "./groups/elicitation"
import { SessionApi } from "./groups/session"
import { SettingsApi } from "./groups/settings"
import { SyncApi } from "./groups/sync"
import { TuiApi } from "./groups/tui"
import { VideosApi } from "./groups/videos"
import { WorkspaceApi } from "./groups/workspace"
import { V2Api } from "./groups/v2"
import { GoalApi } from "./groups/goal"
import { WorkflowApi } from "./groups/workflow"
import { OrchestratorApi } from "./groups/orchestrator"
import { TeamApi } from "./groups/team"
import { RunApi } from "./groups/run"
import { Authorization } from "./middleware/authorization"
import { SchemaErrorMiddleware } from "./middleware/schema-error"

// SSE event schemas built from the BusEvent/SyncEvent registries.
const EventSchema = Schema.Union(BusEvent.effectPayloads()).annotate({ identifier: "Event" })
const SyncEventSchemas = SyncEvent.effectPayloads()

export const RootHttpApi = HttpApi.make("NovaWay-root")
  .addHttpApi(ControlApi)
  .addHttpApi(GlobalApi)
  .middleware(SchemaErrorMiddleware)
  .middleware(Authorization)

// Composed in two steps on purpose: a single 37-link `.addHttpApi` chain makes
// TypeScript give up on the group union (every `HttpApiBuilder.group` call then
// fails to find its group name).
const InstanceGroups = HttpApi.make("NovaWay-instance")
  .addHttpApi(ChatApi)
  .add(CheckpointApi)
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(EvolutionApi)
  .addHttpApi(ExtensionApi)
  .addHttpApi(FileApi)
  .addHttpApi(GitApi)
  .addHttpApi(HookApi)
  .addHttpApi(ImagesApi)
  .addHttpApi(DatabaseApi)
  .addHttpApi(KnowledgeApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(KernelApi)
  .addHttpApi(McpApi)
  .addHttpApi(MemoryApi)
  .addHttpApi(OfficeApi)
  .addHttpApi(OfficePlatformApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(PtyApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(ElicitationApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SettingsApi)
  .addHttpApi(SyncApi)
  .addHttpApi(V2Api)
  .addHttpApi(VideosApi)

export const InstanceHttpApi = InstanceGroups.addHttpApi(TuiApi)
  .addHttpApi(WorkspaceApi)
  .add(GoalApi)
  .add(WorkflowApi)
  .add(OrchestratorApi)
  .addHttpApi(TeamApi)
  .add(RunApi)
  .middleware(SchemaErrorMiddleware)

export const NovaWayHttpApi = HttpApi.make("novaway")
  .addHttpApi(RootHttpApi)
  .addHttpApi(EventApi)
  .addHttpApi(InstanceHttpApi)
  .addHttpApi(PtyConnectApi)
  .annotate(HttpApi.AdditionalSchemas, [EventSchema, ...SyncEventSchemas])

export type RootHttpApiType = typeof RootHttpApi
export type InstanceHttpApiType = typeof InstanceHttpApi
