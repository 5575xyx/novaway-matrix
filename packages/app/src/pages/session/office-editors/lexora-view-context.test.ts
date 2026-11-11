import { afterEach, describe, expect, mock, test } from "bun:test"
import { buildLexoraContext } from "./lexora-view-context"

const originalWorker = globalThis.Worker
const originalClick = HTMLInputElement.prototype.click
const originalTheme = document.documentElement.getAttribute("data-theme")
const originalColorScheme = document.documentElement.getAttribute("data-color-scheme")
afterEach(() => {
  globalThis.Worker = originalWorker
  HTMLInputElement.prototype.click = originalClick
  if (originalTheme === null) document.documentElement.removeAttribute("data-theme")
  else document.documentElement.setAttribute("data-theme", originalTheme)
  if (originalColorScheme === null) document.documentElement.removeAttribute("data-color-scheme")
  else document.documentElement.setAttribute("data-color-scheme", originalColorScheme)
})

function fixture() {
  const controller = new AbortController()
  const context = buildLexoraContext({
    container: document.createElement("div"),
    bytes: new Uint8Array(),
    name: "test.pdf",
    onDirty: () => {},
    signal: controller.signal,
  })
  return { controller, context }
}

describe("Lexora browser resource ownership", () => {
  test("abort terminates workers and prevents subsequent creation", async () => {
    const terminate = mock(() => {})
    globalThis.Worker = class {
      terminate = terminate
    } as unknown as typeof Worker
    const { controller, context } = fixture()
    await context.workers.create("/worker.js", { type: "module" })
    controller.abort()
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(context.workers.create("/late-worker.js")).rejects.toThrow()
  })

  test("cancel and abort settle pending file dialogs without retaining selected resources", async () => {
    let input!: HTMLInputElement
    HTMLInputElement.prototype.click = function () {
      input = this
    }
    const { controller, context } = fixture()
    const cancelled = context.resources.pickFiles()
    input.dispatchEvent(new Event("cancel"))
    expect(await cancelled).toEqual([])
    const pending = context.resources.pickFiles()
    controller.abort()
    expect(await pending).toEqual([])
    await expect(context.resources.readBytes({ id: "stale" })).rejects.toThrow()
  })

  test("reads the color scheme instead of the theme id", () => {
    document.documentElement.setAttribute("data-theme", "novaway")
    document.documentElement.setAttribute("data-color-scheme", "dark")

    const { context } = fixture()

    expect(context.environment.colorScheme).toBe("dark")
  })

  test("theme changes notify live subscriptions; disposal and abort disconnect them", async () => {
    const { controller, context } = fixture()
    const notify = mock(() => {})
    const subscription = context.onEnvironmentChange(notify)
    document.documentElement.setAttribute("data-color-scheme", "dark")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(context.environment.colorScheme).toBe("dark")
    expect(notify).toHaveBeenCalledWith({ colorScheme: "dark" })
    subscription.dispose()
    const count = notify.mock.calls.length
    document.documentElement.setAttribute("data-color-scheme", "light")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(notify).toHaveBeenCalledTimes(count)
    controller.abort()
    expect(() => context.onEnvironmentChange(notify)).toThrow()
  })
})
