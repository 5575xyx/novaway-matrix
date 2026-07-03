import { Auth } from "@/auth"
import { ProviderID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const AuthParams = Schema.Struct({
  providerID: ProviderID,
})

const AuthEntryDeleteParams = Schema.Struct({
  providerID: ProviderID,
  entryIndex: Schema.String,
})

const LogQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

export const LogInput = Schema.Struct({
  service: Schema.String.annotate({ description: "Service name for the log entry" }),
  level: Schema.Union([
    Schema.Literal("debug"),
    Schema.Literal("info"),
    Schema.Literal("error"),
    Schema.Literal("warn"),
  ]).annotate({ description: "Log level" }),
  message: Schema.String.annotate({ description: "Log message" }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional metadata for the log entry",
  }),
})

export const ControlPaths = {
  auth: "/auth/:providerID",
  authEntry: "/auth/:providerID/:entryIndex",
  log: "/log",
} as const

export const ControlApi = HttpApi.make("control").add(
  HttpApiGroup.make("control")
    .add(
      HttpApiEndpoint.put("authSet", ControlPaths.auth, {
        params: AuthParams,
        payload: Auth.Info,
        success: described(Schema.Boolean, "Successfully set authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.set",
          summary: "Set auth credentials",
          description: "Set authentication credentials",
        }),
      ),
      HttpApiEndpoint.get("authList", ControlPaths.auth, {
        params: AuthParams,
        success: described(Schema.Array(Auth.Info), "List of authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.list",
          summary: "List auth credentials",
          description: "List all authentication credentials for a provider.",
        }),
      ),
      HttpApiEndpoint.post("authAddEntry", ControlPaths.auth, {
        params: AuthParams,
        payload: Auth.Info,
        success: described(Schema.Boolean, "Added new authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.addEntry",
          summary: "Add auth credential",
          description: "Add an additional authentication credential for a provider.",
        }),
      ),
      HttpApiEndpoint.delete("authRemove", ControlPaths.auth, {
        params: AuthParams,
        success: described(Schema.Boolean, "Successfully removed authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.remove",
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
        }),
      ),
      HttpApiEndpoint.delete("authRemoveEntry", ControlPaths.authEntry, {
        params: AuthEntryDeleteParams,
        success: described(Schema.Boolean, "Removed authentication credential entry"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.removeEntry",
          summary: "Remove specific auth credential",
          description: "Remove a specific authentication credential entry by index.",
        }),
      ),
      HttpApiEndpoint.post("log", ControlPaths.log, {
        query: LogQuery,
        payload: LogInput,
        success: described(Schema.Boolean, "Log entry written successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "app.log",
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "control", description: "Control plane routes." })),
)
