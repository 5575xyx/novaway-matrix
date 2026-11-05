import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/novaway-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("falls back to the default theme before mount", () => {
    run()

    expect(document.documentElement.dataset.theme).toBe("novaway")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
  })

  test("applies the stored theme", () => {
    localStorage.setItem("novaway-theme-id", "nightowl")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
  })

  test("honours the stored color scheme", () => {
    localStorage.setItem("novaway-color-scheme", "dark")

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("novaway-theme-id", "nightowl")
    localStorage.setItem("novaway-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("novaway-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
