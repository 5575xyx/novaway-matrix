import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { clickElement, linuxSnapshot, type as computerType } from "@/computer/computer"

const integrationEnabled = process.platform === "linux" && process.env.NOVAWAY_ATSPI_INTEGRATION === "1"
let fixture: ChildProcess | undefined

const waitFor = async <T>(read: () => Promise<T | undefined>, timeout = 10_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for Linux AT-SPI fixture")
}

afterEach(() => {
  fixture?.kill("SIGTERM")
  fixture = undefined
})

describe("Linux AT-SPI integration", () => {
  const linuxTest = integrationEnabled ? test : test.skip
  linuxTest("reads a real GTK accessibility tree and verifies a click", async () => {
    const script = path.join(import.meta.dir, "linux-atspi-fixture.py")
    fixture = spawn("python3", [script], { stdio: "ignore" })
    const initial = await waitFor(async () => {
      try {
        const snapshot = await linuxSnapshot("NovaWay AT-SPI Smoke")
        return snapshot.elements.some((element) => element.name === "Click me") ? snapshot : undefined
      } catch {
        return undefined
      }
    })
    const button = initial.elements.find((element) => element.name === "Click me")
    expect(button?.role.toLowerCase()).toContain("button")
    expect(button?.enabled).toBe(true)
    await computerType("Wayland")
    const typed = await waitFor(async () => {
      try {
        const snapshot = await linuxSnapshot("NovaWay AT-SPI Smoke")
        return snapshot.elements.some((element) => element.name === "Wayland") ? snapshot : undefined
      } catch {
        return undefined
      }
    })
    expect(typed.elements.some((element) => element.name === "Wayland")).toBe(true)
    const typedButton = typed.elements.find(
      (element) => element.name === "Wayland" && element.role.toLowerCase().includes("button"),
    )
    await clickElement("NovaWay AT-SPI Smoke", typedButton!.ref)
    const after = await waitFor(async () => {
      try {
        const snapshot = await linuxSnapshot("NovaWay AT-SPI Smoke")
        return snapshot.elements.some((element) => element.name === "Clicked") ? snapshot : undefined
      } catch {
        return undefined
      }
    })
    expect(after.elements.some((element) => element.name === "Clicked")).toBe(true)
  }, 30_000)
})
