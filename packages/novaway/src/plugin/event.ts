import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

export const Changed = BusEvent.define(
  "plugin.changed",
  Schema.Struct({
    pluginID: Schema.optional(Schema.String),
    generation: Schema.Number,
  }),
)

export * as PluginEvent from "./event"
