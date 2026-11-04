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
  test("migrates legacy opencode-* keys and the oc-1 theme id before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("novaway-classic")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("novaway-theme-id")).toBe("novaway-classic")
    // 旧主题 id 的缓存样式对应的是内置主题：直接丢掉，等运行时重新算。
    expect(localStorage.getItem("novaway-theme-css-light")).toBeNull()
    expect(localStorage.getItem("novaway-theme-css-dark")).toBeNull()
    expect(localStorage.getItem("opencode-theme-id")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(document.getElementById("novaway-theme-preload")).toBeNull()
  })

  test("new keys win over legacy ones", () => {
    localStorage.setItem("opencode-theme-id", "dracula")
    localStorage.setItem("novaway-theme-id", "nightowl")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(localStorage.getItem("opencode-theme-id")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("novaway-theme-id", "nightowl")
    localStorage.setItem("novaway-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("novaway-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
