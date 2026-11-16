import { Effect } from "effect"
import * as Operations from "@/extension/operations"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"

const MarketplaceOperationsCommand = effectCmd({
  command: "operations",
  describe: "list durable marketplace operations",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("json", { type: "boolean", default: false, describe: "print machine-readable JSON" })
      .option("operation-id", { type: "string", describe: "show one operation by ID" }),
  handler: Effect.fn("Cli.marketplace.operations")(function* (args) {
    const operations = yield* Effect.promise(() => Operations.list())
    const operationID = typeof args.operationId === "string" ? args.operationId : undefined
    const selected = operationID ? operations.filter((operation) => operation.operationId === operationID) : operations
    if (args.json) {
      console.log(JSON.stringify(selected, null, 2))
      return
    }
    if (selected.length === 0) {
      console.log("No marketplace operations.")
      return
    }
    for (const operation of selected) {
      console.log(
        `${operation.operationId} ${operation.operationType} ${operation.packageId} ${operation.phase} ${operation.progress}% ` +
          `install=${operation.installationStatus} activation=${operation.activationStatus} ` +
          `consumer=${operation.consumerStatus} cleanup=${operation.cleanupStatus} dispose=${operation.disposeStatus}` +
          (operation.requiresRestart ? " restart-required" : ""),
      )
      if (operation.errorCode || operation.recoveryHint) {
        console.log(`  ${operation.errorCode ?? "failed"}${operation.recoveryHint ? `: ${operation.recoveryHint}` : ""}`)
      }
    }
  }),
})

export const MarketplaceCommand = cmd({
  command: "marketplace",
  describe: "inspect marketplace lifecycle operations",
  builder: (yargs) => yargs.command(MarketplaceOperationsCommand).demandCommand(),
  async handler() {},
})
