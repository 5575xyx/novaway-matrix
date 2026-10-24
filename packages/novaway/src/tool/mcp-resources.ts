import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MCP } from "@/mcp"

const ListParameters = Schema.Struct({
  client: Schema.optional(Schema.String).annotate({
    description: "Only list resources from this MCP server (client name)",
  }),
})

const ReadParameters = Schema.Struct({
  uri: Schema.String.annotate({ description: "Resource URI, as returned by list_mcp_resources" }),
  client: Schema.optional(Schema.String).annotate({
    description: "MCP server (client name) that owns the resource; disambiguates duplicate URIs",
  }),
})

type Metadata = {
  resources?: Array<{ client: string; name: string; uri: string; mimeType?: string }>
  uri?: string
  client?: string
}

/** List resources exposed by connected MCP servers. */
export const ListMcpResourcesTool = Tool.define<typeof ListParameters, Metadata, MCP.Service>(
  "list_mcp_resources",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    return {
      description: "List resources (files, documents, records) exposed by connected MCP servers.",
      parameters: ListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof ListParameters>) =>
        Effect.gen(function* () {
          const listed = yield* mcp.resources().pipe(Effect.orDie)
          const resources = Object.values(listed)
            .filter((resource) => !params.client || resource.client === params.client)
            .map((resource) => ({
              client: resource.client,
              name: resource.name,
              uri: resource.uri,
              mimeType: resource.mimeType,
            }))

          if (!resources.length) {
            return {
              title: "No MCP resources",
              output: params.client
                ? `MCP server "${params.client}" exposes no resources.`
                : "No connected MCP server exposes resources.",
              metadata: { resources: [] },
            }
          }

          return {
            title: `${resources.length} MCP resource${resources.length === 1 ? "" : "s"}`,
            output: resources
              .map(
                (resource) =>
                  `- ${resource.client}:${resource.name} (${resource.uri})${resource.mimeType ? ` [${resource.mimeType}]` : ""}`,
              )
              .join("\n"),
            metadata: { resources },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** Read one MCP resource by URI. */
export const ReadMcpResourceTool = Tool.define<typeof ReadParameters, Metadata, MCP.Service>(
  "read_mcp_resource",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    return {
      description:
        "Read a resource exposed by a connected MCP server. Use list_mcp_resources to discover URIs.",
      parameters: ReadParameters,
      capabilities: { readOnly: true, concurrencySafe: true, maxResultBytes: 256_000 },
      execute: (params: Schema.Schema.Type<typeof ReadParameters>) =>
        Effect.gen(function* () {
          const listed = yield* mcp.resources().pipe(Effect.orDie)
          const resource = Object.values(listed).find(
            (item) => item.uri === params.uri && (!params.client || item.client === params.client),
          )
          if (!resource) {
            return {
              title: "Resource not found",
              output: `No MCP resource with URI ${params.uri}${params.client ? ` on ${params.client}` : ""}.`,
              metadata: { uri: params.uri, client: params.client },
            }
          }

          const result = yield* mcp.readResource(resource.client, resource.uri).pipe(Effect.orDie)
          if (!result?.contents?.length) {
            return {
              title: resource.uri,
              output: `${resource.uri} returned no contents.`,
              metadata: { uri: resource.uri, client: resource.client },
            }
          }

          const output = result.contents
            .map((content) => {
              if ("text" in content) return content.text
              return `[${content.mimeType ?? "binary"} blob, ${content.blob.length} base64 chars]`
            })
            .join("\n\n")

          return {
            title: resource.name || resource.uri,
            output,
            metadata: { uri: resource.uri, client: resource.client },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
