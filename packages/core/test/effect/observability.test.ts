import { afterEach, describe, expect, test } from "bun:test"
import { resource } from "@novaway/core/effect/observability"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES
const originalClient = process.env.NOVAWAY_CLIENT

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes

  if (originalClient === undefined) delete process.env.NOVAWAY_CLIENT
  else process.env.NOVAWAY_CLIENT = originalClient
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=anomalyco,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "anomalyco",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("drops OTEL resource attributes when any entry is invalid", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=anomalyco,broken"

    expect(resource().attributes["service.namespace"]).toBeUndefined()
    expect(resource().attributes["novaway.client"]).toBeDefined()
  })

  test("keeps built-in attributes when env values conflict", () => {
    process.env.NOVAWAY_CLIENT = "cli"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "novaway.client=web,service.instance.id=override,service.namespace=novaway"

    expect(resource().attributes).toMatchObject({
      "novaway.client": "cli",
      "service.namespace": "novaway",
    })
    expect(resource().attributes["service.instance.id"]).not.toBe("override")
  })
})
