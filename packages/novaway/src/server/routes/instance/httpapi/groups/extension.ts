import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/extension"
const MarketplaceSourceType = Schema.Literals(["novaway", "claude", "zcode", "auto"])
const MarketplaceSourceTrust = Schema.Literals(["official", "unverified"])

export const MarketplaceSource = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: MarketplaceSourceType,
  url: Schema.String,
  enabled: Schema.Boolean,
  trust: MarketplaceSourceTrust,
  builtin: Schema.optional(Schema.Boolean),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastRefreshAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceSource" })

export const MarketplaceSourceInput = Schema.Struct({
  name: Schema.String,
  type: MarketplaceSourceType,
  url: Schema.String,
})

export const MarketplaceSourcePatch = Schema.Struct({
  name: Schema.optional(Schema.String),
  type: Schema.optional(MarketplaceSourceType),
  url: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})

export const ExtensionIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "ExtensionIssue" })

export const ExtensionInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  root: Schema.String,
  source: Schema.Literals(["builtin", "user", "project", "claude", "plugin", "session"]),
  enabled: Schema.Boolean,
  error: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(ExtensionIssue)),
  status: Schema.optional(Schema.Literals(["added", "removed", "upgraded", "downgraded", "changed", "unchanged"])),
  operationId: Schema.optional(Schema.String),
}).annotate({ identifier: "ExtensionInfo" })

export const ExtensionContribution = Schema.Struct({
  extension: Schema.String,
  root: Schema.String,
  kind: Schema.Literals(["command", "agent", "skill", "hook", "mcp", "tool", "output-style"]),
  name: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}).annotate({ identifier: "ExtensionContribution" })

export const ExtensionToggle = Schema.Struct({ enabled: Schema.Boolean })

export const MarketplaceOperation = Schema.Struct({
  operationId: Schema.String,
  operationType: Schema.Literals(["install", "update", "rollback", "enable", "disable", "uninstall", "migrate"]),
  packageId: Schema.String,
  version: Schema.optional(Schema.String),
  runtime: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["global", "project", "session"])),
  phase: Schema.Literals([
    "queued",
    "downloading",
    "staging",
    "validating",
    "replacing",
    "activating",
    "draining",
    "cleanup-pending",
    "completed",
    "failed",
  ]),
  installationStatus: Schema.Literals([
    "absent",
    "staging",
    "validating",
    "installed",
    "updating",
    "uninstalling",
    "failed",
  ]),
  activationStatus: Schema.Literals([
    "disabled",
    "activating",
    "active",
    "draining",
    "deactivating",
    "disabled-pending-restart",
    "failed",
    "cleanup-pending",
  ]),
  consumerStatus: Schema.Literals([
    "undiscovered",
    "discovered",
    "registered",
    "partially-registered",
    "usable",
    "unavailable",
  ]),
  cleanupStatus: Schema.Literals(["not-required", "pending", "completed", "failed"]),
  disposeStatus: Schema.Literals(["not-required", "pending", "completed", "failed"]),
  requiresRestart: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
  progress: Schema.Number,
  errorCode: Schema.optional(Schema.String),
  recoveryHint: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceOperation" })

export const MarketplaceInstalled = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["zip", "git"]),
  version: Schema.optional(Schema.String),
  source: Schema.String,
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
  sha256: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  conflicts: Schema.optional(Schema.Array(Schema.String)),
  installedAt: Schema.Number,
  root: Schema.String,
  files: Schema.Number,
  bytes: Schema.Number,
  operationId: Schema.optional(Schema.String),
  /** The install this one replaced, so the UI can say "updated from v1.2". */
  previous: Schema.optional(
    Schema.Struct({
      version: Schema.optional(Schema.String),
      source: Schema.String,
      installedAt: Schema.Number,
      files: Schema.Number,
      bytes: Schema.Number,
    }),
  ),
}).annotate({ identifier: "MarketplaceInstalled" })

export const MarketplaceEntry = Schema.Struct({
  name: Schema.String,
  packageId: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  displayNameI18n: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  longDescription: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  screenshots: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.String,
  kind: Schema.optional(Schema.Literals(["zip", "git"])),
  sha256: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  categories: Schema.optional(Schema.Array(Schema.String)),
  marketTypes: Schema.optional(Schema.Array(Schema.String)),
  repository: Schema.optional(Schema.String),
  runtimeTargets: Schema.optional(Schema.Array(Schema.String)),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  permissions: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  conflicts: Schema.optional(Schema.Array(Schema.String)),
  releaseNotes: Schema.optional(Schema.String),
  compatibility: Schema.optional(
    Schema.Struct({
      minNovaWayApi: Schema.optional(Schema.String),
      maxNovaWayApi: Schema.optional(Schema.String),
      manifestVersion: Schema.optional(Schema.Number),
      requiresRestart: Schema.optional(Schema.Boolean),
    }),
  ),
}).annotate({ identifier: "MarketplaceEntry" })

export const MarketplaceUpdate = Schema.Struct({
  name: Schema.String,
  root: Schema.String,
  kind: Schema.Literals(["zip", "git"]),
  ref: Schema.optional(Schema.String),
  state: Schema.Literals(["current", "outdated", "unknown"]),
  /** 本地记录的标识（git 提交哈希 / 归档 ETag）。 */
  revision: Schema.optional(Schema.String),
  /** 远端当前标识。 */
  available: Schema.optional(Schema.String),
  checkedAt: Schema.Number,
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceUpdate" })

export const MarketplaceLegacyInstalled = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  root: Schema.String,
  runtime: Schema.Literal("legacy"),
  source: Schema.Literal("legacy-extension"),
  preserved: Schema.Literal(true),
  conflict: Schema.optional(Schema.Literal("marketplace-id")),
}).annotate({ identifier: "MarketplaceLegacyInstalled" })

export const MarketplaceLegacyMigration = Schema.Struct({
  migrationId: Schema.String,
  name: Schema.String,
  version: Schema.optional(Schema.String),
  legacyRoot: Schema.String,
  managedRoot: Schema.String,
  backupRoot: Schema.String,
  migratedAt: Schema.Number,
  state: Schema.Literals(["migrated", "rolledback"]),
  operationId: Schema.optional(Schema.String),
}).annotate({ identifier: "MarketplaceLegacyMigration" })

export const MarketplaceUpdatePreview = Schema.Struct({
  currentVersion: Schema.optional(Schema.String),
  targetVersion: Schema.optional(Schema.String),
  sourceChanged: Schema.Boolean,
  currentSourceId: Schema.optional(Schema.String),
  targetSourceId: Schema.optional(Schema.String),
  sourceUrlChanged: Schema.Boolean,
  permissionsAdded: Schema.Array(Schema.String),
  permissionsRemoved: Schema.Array(Schema.String),
  dependenciesAdded: Schema.Record(Schema.String, Schema.String),
  dependenciesRemoved: Schema.Array(Schema.String),
  conflictsAdded: Schema.Array(Schema.String),
  conflictsRemoved: Schema.Array(Schema.String),
  digestChanged: Schema.Boolean,
  requiresConfirmation: Schema.Boolean,
}).annotate({ identifier: "MarketplaceUpdatePreview" })

export const MarketplaceCatalog = Schema.Struct({
  installed: Schema.Array(MarketplaceInstalled),
  legacy: Schema.Array(MarketplaceLegacyInstalled),
  sources: Schema.Array(MarketplaceSource),
  novaway: Schema.Array(MarketplaceEntry),
  zcode: Schema.Array(MarketplaceEntry),
  claude: Schema.Array(MarketplaceEntry),
  /** 每个已安装扩展的远端更新检查结果（探测失败时 state=unknown）。 */
  updates: Schema.optional(Schema.Array(MarketplaceUpdate)),
  errors: Schema.Array(Schema.String),
}).annotate({ identifier: "MarketplaceCatalog" })

export const MarketplaceInstallPayload = Schema.Struct({
  kind: Schema.Literals(["zip", "git"]),
  name: Schema.String,
  url: Schema.String,
  version: Schema.optional(Schema.String),
  sha256: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  conflicts: Schema.optional(Schema.Array(Schema.String)),
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
})

export const ExtensionIntegrity = Schema.Struct({
  name: Schema.String,
  root: Schema.String,
  files: Schema.Number,
  bytes: Schema.Number,
  hash: Schema.String,
}).annotate({ identifier: "ExtensionIntegrity" })

export const ExtensionApi = HttpApi.make("extension")
  .add(
    HttpApiGroup.make("extension")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExtensionInfo), "Installed extensions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.list",
            summary: "List extensions",
            description: "List installed NovaWay and Claude compatible extensions.",
          }),
        ),
        HttpApiEndpoint.get("contributions", `${root}/contributions`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExtensionContribution), "Extension contributions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.contributions",
            summary: "List extension contributions",
            description: "List commands, agents, skills, hooks, MCP servers and tools contributed by extensions.",
          }),
        ),
        HttpApiEndpoint.get("marketplaceSources", `${root}/marketplace/sources`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(MarketplaceSource), "Configured marketplace sources"),
        }).annotateMerge(
          OpenApi.annotations({ identifier: "extension.marketplaceSources", summary: "List marketplace sources" }),
        ),
        HttpApiEndpoint.post("marketplaceSourceAdd", `${root}/marketplace/sources`, {
          query: WorkspaceRoutingQuery,
          payload: MarketplaceSourceInput,
          success: described(MarketplaceSource, "Added marketplace source"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "extension.marketplaceSource.add", summary: "Add marketplace source" }),
        ),
        HttpApiEndpoint.patch("marketplaceSourceUpdate", `${root}/marketplace/sources/:sourceId`, {
          params: { sourceId: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: MarketplaceSourcePatch,
          success: described(MarketplaceSource, "Updated marketplace source"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceSource.update",
            summary: "Update marketplace source",
          }),
        ),
        HttpApiEndpoint.delete("marketplaceSourceRemove", `${root}/marketplace/sources/:sourceId`, {
          params: { sourceId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Source removed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceSource.remove",
            summary: "Remove marketplace source",
          }),
        ),
        HttpApiEndpoint.post("marketplaceSourceRefresh", `${root}/marketplace/sources/:sourceId/refresh`, {
          params: { sourceId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceSource, "Refreshed marketplace source"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceSource.refresh",
            summary: "Refresh marketplace source",
          }),
        ),
        HttpApiEndpoint.get("marketplaceLegacyMigrations", `${root}/marketplace/legacy/migrations`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(MarketplaceLegacyMigration), "Legacy migrations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceLegacyMigrations",
            summary: "List legacy migrations",
            description: "List explicit legacy-to-managed migrations and their rollback records.",
          }),
        ),
        HttpApiEndpoint.post("marketplaceLegacyMigrate", `${root}/marketplace/legacy/:name/migrate`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceLegacyMigration, "Migrated legacy package"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceLegacyMigrate",
            summary: "Migrate a legacy package",
            description: "Explicitly move a legacy package into the managed marketplace with a physical rollback copy.",
          }),
        ),
        HttpApiEndpoint.post("marketplaceLegacyRollback", `${root}/marketplace/legacy/migrations/:migrationId/rollback`, {
          params: { migrationId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceLegacyMigration, "Rolled back legacy migration"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceLegacyRollback",
            summary: "Roll back a legacy migration",
            description: "Restore the original legacy directory and remove its managed copy.",
          }),
        ),
        HttpApiEndpoint.get("marketplace", `${root}/marketplace`, {
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceCatalog, "Marketplace catalog and installed packages"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceCatalog",
            summary: "List marketplace packages",
            description: "Return installed marketplace packages plus the remote ZCode and Claude catalogs.",
          }),
        ),
        HttpApiEndpoint.get("marketplaceOperations", `${root}/marketplace/operations`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(MarketplaceOperation), "Marketplace operation history"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceOperations",
            summary: "List marketplace operations",
            description: "Read durable lifecycle operations shared by Web, Desktop, TUI and CLI clients.",
          }),
        ),
        HttpApiEndpoint.get("marketplaceOperation", `${root}/marketplace/operations/:operationId`, {
          params: { operationId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceOperation, "Marketplace operation status"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceOperation",
            summary: "Get marketplace operation status",
            description: "Read the durable phase and recovery metadata for a marketplace change operation.",
          }),
        ),
        HttpApiEndpoint.post("install", `${root}/marketplace/install`, {
          query: WorkspaceRoutingQuery,
          payload: MarketplaceInstallPayload,
          success: described(MarketplaceInstalled, "Installed marketplace package"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceInstall",
            summary: "Install a marketplace package",
            description:
              "Download and extract a zip package, or shallow-clone a git package, then register it with the extension loader.",
          }),
        ),
        HttpApiEndpoint.post("rollback", `${root}/marketplace/:name/rollback`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceInstalled, "Rolled back marketplace package"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceRollback",
            summary: "Roll back a marketplace package",
            description:
              "Restore the latest retained physical revision and retain the current version for another rollback.",
          }),
        ),
        HttpApiEndpoint.post("updatePreview", `${root}/marketplace/:name/update/preview`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceUpdatePreview, "Marketplace update preview"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceUpdatePreview",
            summary: "Preview marketplace update changes",
            description:
              "Compare the installed package with the current catalog target before downloading or replacing files.",
          }),
        ),
        HttpApiEndpoint.post("update", `${root}/marketplace/:name/update`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(MarketplaceInstalled, "Updated marketplace package"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceUpdate",
            summary: "Update a marketplace package",
            description:
              "Reinstall an installed package from its recorded source with an atomic backup and recovery path.",
          }),
        ),
        HttpApiEndpoint.delete("uninstall", `${root}/marketplace/:name`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Package removed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.marketplaceUninstall",
            summary: "Uninstall a marketplace package",
            description: "Remove an installed marketplace package and refresh the extension registry.",
          }),
        ),
        HttpApiEndpoint.get("integrity", `${root}/:name/integrity`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(ExtensionIntegrity), "Extension content fingerprint"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.integrity",
            summary: "Get extension fingerprint",
            description: "Compute a content fingerprint for an installed extension (files, bytes, hash).",
          }),
        ),
        HttpApiEndpoint.post("reload", `${root}/reload`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ExtensionInfo), "Reloaded extensions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.reload",
            summary: "Reload extensions",
            description: "Rescan extension directories and refresh the contribution registry.",
          }),
        ),
        HttpApiEndpoint.patch("toggle", `${root}/:name`, {
          params: { name: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: ExtensionToggle,
          success: described(ExtensionInfo, "Updated extension"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "extension.toggle",
            summary: "Enable or disable an extension",
            description: "Toggle an extension without removing its files.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "extension",
          description: "Extension manifest and contribution routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay extension HttpApi",
      version: "0.0.1",
      description: "Extension management surface.",
    }),
  )
