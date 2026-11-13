import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

export const Changed = BusEvent.define(
  "plugin.changed",
  Schema.Struct({
    pluginID: Schema.optional(Schema.String),
    /**
     * 目标状态。缺省表示「状态未知」（例如回滚/热重载），客户端只能重新拉取；
     * 明确为 false 时 UI 可先移除该插件的贡献，再后台对齐，满足 §6.4 停用 <300ms。
     */
    enabled: Schema.optional(Schema.Boolean),
    generation: Schema.Number,
  }),
)

export * as PluginEvent from "./event"
