import { defineConfig, devices } from "@playwright/test"

// Uses only a standalone frontend. The test intercepts backend calls in Chromium.
const port = Number(process.env.PLAYWRIGHT_STARTUP_PORT ?? 4473)
const baseURL = `http://127.0.0.1:${port}`

const command = process.env.PLAYWRIGHT_STARTUP_COMMAND ?? `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`

export default defineConfig({
  testDir: "e2e",
  testMatch: ["startup-priority.spec.ts", "interaction-performance.spec.ts", "chat-scroll-performance.spec.ts"],
  outputDir: ".artifacts/startup-playwright",
  // Vite may need to transform dependencies on a cold test run.
  timeout: 120_000,
  workers: 1,
  use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL, baseURL },
  webServer: {
    command,
    url: baseURL,
    timeout: 120_000,
    env: { VITE_NOVAWAY_SERVER_HOST: "127.0.0.1", VITE_NOVAWAY_SERVER_PORT: "4475" },
  },
})
