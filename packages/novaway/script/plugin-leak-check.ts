import { EventEmitter } from "node:events"
import whyIsNodeRunning from "why-is-node-running"
import { createStack } from "../src/plugin/runtime/disposable.ts"

const events = new EventEmitter()
const stack = createStack()
const pluginTimer = setInterval(() => {}, 60_000)
const listener = () => {}
events.on("change", listener)
stack.push({ dispose: () => clearInterval(pluginTimer) })
stack.push({ dispose: () => events.off("change", listener) })

if (stack.size !== 2 || events.listenerCount("change") !== 1) throw new Error("plugin resources were not registered")
stack.dispose()
if ([stack.size, events.listenerCount("change"), stack.errors.length].some((count) => count !== 0)) {
  throw new Error("plugin resources survived disposal")
}

await new Promise<void>((resolve) => setImmediate(resolve))
const controlTimer = setInterval(() => {}, 60_000)
const lines: string[] = []
try {
  whyIsNodeRunning({ error: (message) => lines.push(message) })
  const output = lines.join("\n")
  if (!output.includes("plugin-leak-check.ts")) throw new Error("leak inspector did not detect the control timer")
  if (output.includes("const pluginTimer = setInterval")) throw new Error(`plugin timer survived disposal:\n${output}`)
} finally {
  clearInterval(controlTimer)
}

console.log("plugin timer and listener leak check passed")
