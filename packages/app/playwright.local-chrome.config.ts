// 临时：本机没装 Playwright 自带 Chromium，用系统 Chrome 跑既有 e2e。
import base from "./playwright.config"
import { defineConfig } from "@playwright/test"

export default defineConfig({
  ...base,
  use: { ...base.use, channel: "chrome", video: "off", trace: "off" },
})
