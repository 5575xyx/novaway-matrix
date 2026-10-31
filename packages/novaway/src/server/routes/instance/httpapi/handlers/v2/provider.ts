import { Catalog } from "@novaway/core/catalog"
import { PluginBoot } from "@novaway/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { notFound } from "../../errors"
import { resolveLocation } from "./location"

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "provider",
      Effect.fn("V2ProviderHttpApi.get")(function* (ctx) {
        const catalog = yield* Catalog.Service
        const pluginBoot = yield* PluginBoot.Service
        yield* pluginBoot.wait()
        return yield* catalog.provider
          .get(ctx.params.providerID)
          .pipe(Effect.catchTag("CatalogV2.ProviderNotFound", () => Effect.fail(notFound("Provider not found"))))
      }),
    )
  }),
)

export const providerListHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.provider-list", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "providers",
      Effect.fn("V2ProviderHttpApi.list")(function* () {
        const catalog = yield* Catalog.Service
        const pluginBoot = yield* PluginBoot.Service
        yield* pluginBoot.wait()
        const [location, data] = yield* Effect.all([resolveLocation(), catalog.provider.available()])
        return { location, data }
      }),
    )
  }),
)
