// 临时：本机没装 Playwright 自带 Chromium，用系统 Chrome 跑既有 e2e。
import base from "./playwright.config"
import { defineConfig } from "@playwright/test"

export default defineConfig({
  ...base,
  // Opt in to attach to an already-running local app without ever starting one.
  ...(process.env.PLAYWRIGHT_EXISTING_SERVER === "1" ? { webServer: undefined } : {}),
  use: { ...base.use, channel: "chrome", video: "off", trace: "off" },
})
