import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const NovaWayPlugin = PluginV2.define({
  id: PluginV2.ID.make("NovaWay"),
  effect: Effect.gen(function* () {
    let hasKey = false
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.NovaWay) return
        hasKey = Boolean(
          process.env.NovaWay_API_KEY ||
            evt.provider.env.some((item) => process.env[item]) ||
            evt.provider.options.aisdk.provider.apiKey ||
            (evt.provider.enabled && evt.provider.enabled.via === "auth"),
        )
        if (!hasKey) evt.provider.options.aisdk.provider.apiKey = "public"
      }),
      "model.update": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.NovaWay) return
        if (hasKey) return
        if (evt.model.cost.some((item) => item.input > 0)) evt.cancel = true
      }),
    }
  }),
})
