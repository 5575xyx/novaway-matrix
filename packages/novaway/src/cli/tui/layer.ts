import { run as runTui, type TuiInput } from "@novaway/tui"
import { Global } from "@novaway/core/global"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(Global.defaultLayer))
}
