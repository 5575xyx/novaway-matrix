import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Reference } from "@/reference/reference"
import { Skill } from "@/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { resolveLocation } from "./location"

type ReferenceWire = {
  name: string
  path: string
  source: { type: "local"; path: string } | { type: "git"; repository: string; branch?: string }
}

function splitModel(model: string) {
  const separator = model.indexOf("/")
  if (separator === -1) return undefined
  return { providerID: model.slice(0, separator), id: model.slice(separator + 1) }
}

export const catalogHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.agent", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service

    const list = Effect.fn("V2AgentHttpApi.list")(function* () {
      const [location, items] = yield* Effect.all([resolveLocation(), agent.list()])
      return {
        location,
        data: items.map((item) => ({
          id: item.name,
          ...(item.model
            ? {
                model: {
                  id: item.model.modelID,
                  providerID: item.model.providerID,
                  ...(item.variant ? { variant: item.variant } : {}),
                },
              }
            : {}),
          request: { headers: {}, body: {} },
          ...(item.prompt ? { system: item.prompt } : {}),
          ...(item.description ? { description: item.description } : {}),
          mode: item.mode,
          hidden: item.hidden ?? false,
          ...(item.color ? { color: item.color } : {}),
          ...(item.steps === undefined ? {} : { steps: item.steps }),
          permissions: item.permission.map((rule) => ({
            action: rule.permission,
            resource: rule.pattern,
            effect: rule.action,
          })),
        })),
      }
    })

    return handlers.handle("list", list)
  }),
)

export const commandHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.command", (handlers) =>
  Effect.gen(function* () {
    const command = yield* Command.Service

    const list = Effect.fn("V2CommandHttpApi.list")(function* () {
      const [location, items] = yield* Effect.all([resolveLocation(), command.list()])
      const data = yield* Effect.forEach(items, (item) =>
        Effect.gen(function* () {
          const template = yield* Effect.promise(() => Promise.resolve(item.template))
          const model = item.model ? splitModel(item.model) : undefined
          return {
            name: item.name,
            template,
            ...(item.description ? { description: item.description } : {}),
            ...(item.agent ? { agent: item.agent } : {}),
            ...(model ? { model } : {}),
            ...(item.subtask === undefined ? {} : { subtask: item.subtask }),
          }
        }),
      )
      return { location, data }
    })

    return handlers.handle("list", list)
  }),
)

export const skillHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.skill", (handlers) =>
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    const list = Effect.fn("V2SkillHttpApi.list")(function* () {
      const [location, items] = yield* Effect.all([resolveLocation(), skill.all()])
      return {
        location,
        data: items.map((item) => ({
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          ...(item.userInvocable === undefined ? {} : { slash: item.userInvocable }),
          location: item.location,
          content: item.content,
        })),
      }
    })

    return handlers.handle("list", list)
  }),
)

export const referenceHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.reference", (handlers) =>
  Effect.gen(function* () {
    const reference = yield* Reference.Service

    const list = Effect.fn("V2ReferenceHttpApi.list")(function* () {
      const [location, items] = yield* Effect.all([resolveLocation(), reference.list()])
      return {
        location,
        data: items.flatMap((item): ReferenceWire[] => {
          if (item.kind === "invalid") return []
          if (item.kind === "local") {
            return [{ name: item.name, path: item.path, source: { type: "local" as const, path: item.path } }]
          }
          return [
            {
              name: item.name,
              path: item.path,
              source: {
                type: "git" as const,
                repository: item.repository,
                ...(item.branch ? { branch: item.branch } : {}),
              },
            },
          ]
        }),
      }
    })

    return handlers.handle("list", list)
  }),
)

export const integrationHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.integration", (handlers) =>
  Effect.gen(function* () {
    // The kernel has no integration registry yet (provider auth is tracked by
    // the provider catalog, MCP by the MCP service). Keep the route so v2
    // clients can rely on the shape and get an empty list instead of a 404.
    const list = Effect.fn("V2IntegrationHttpApi.list")(function* () {
      const location = yield* resolveLocation()
      return { location, data: [] as Array<{ id: string; name: string; methods: unknown[]; connections: unknown[] }> }
    })

    return handlers.handle("list", list)
  }),
)
