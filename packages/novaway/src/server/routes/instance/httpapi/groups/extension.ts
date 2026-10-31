import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/extension"

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
}).annotate({ identifier: "ExtensionInfo" })

export const ExtensionContribution = Schema.Struct({
  extension: Schema.String,
  root: Schema.String,
  kind: Schema.Literals(["command", "agent", "skill", "hook", "mcp", "tool", "output-style"]),
  name: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
}).annotate({ identifier: "ExtensionContribution" })

export const ExtensionToggle = Schema.Struct({ enabled: Schema.Boolean })

export const MarketplaceInstalled = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["zip", "git"]),
  version: Schema.optional(Schema.String),
  source: Schema.String,
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
  sha256: Schema.optional(Schema.String),
  installedAt: Schema.Number,
  root: Schema.String,
  files: Schema.Number,
  bytes: Schema.Number,
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
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  url: Schema.String,
  sha256: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
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

export const MarketplaceCatalog = Schema.Struct({
  installed: Schema.Array(MarketplaceInstalled),
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
