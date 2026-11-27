import { fileURLToPath } from "node:url"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  resolve: {
    alias: {
      // Workspace installs can leave stale nested node_modules copies beneath packages/app.
      // Always bundle the versioned source SDK used by this monorepo's API schema.
      "@novaway/sdk/v2/client": fileURLToPath(new URL("../sdk/js/src/v2/client.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    // CJS packages used by worker/editor code need Vite's interop wrapper; keep workspace TSX
    // packages out of esbuild so vite-plugin-solid transforms them instead of assuming React JSX.
    include: ["lru_map", "pako", "fuzzysort", "jszip", "@huggingface/transformers"],
    exclude: ["@novaway/core", "@novaway/sdk", "@novaway/ui"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
