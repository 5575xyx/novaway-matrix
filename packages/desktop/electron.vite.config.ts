import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@novaway/app/vite"
import * as fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const channel = (() => {
  const raw = process.env.NOVAWAY_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

function loadModelsDevSnapshot(): string {
  const cacheDir = path.join(os.homedir(), ".cache", "novaway")
  const cachePath = path.join(cacheDir, "models.json")
  try {
    const raw = readFileSync(cachePath, "utf-8")
    JSON.parse(raw)
    return raw
  } catch {
    return "{}"
  }
}

const NOVAWAY_MODELS_DEV = loadModelsDevSnapshot()

const NOVAWAY_SERVER_DIST = "../novaway/dist/node"
const NOVAWAY_MIGRATION_DIR = "../novaway/migration"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

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
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

const migrations = await loadMigrations()

export default defineConfig({
  main: {
    define: {
          "import.meta.env.NOVAWAY_CHANNEL": JSON.stringify(channel),
          NOVAWAY_CHANNEL: JSON.stringify(channel),
      NOVAWAY_MIGRATIONS: JSON.stringify(migrations),
      OPENCODE_MODELS_DEV: NOVAWAY_MODELS_DEV,
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "novaway:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "novaway:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:novaway-server") return this.resolve(`${NOVAWAY_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "novaway:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(NOVAWAY_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${NOVAWAY_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    define: {
        "import.meta.env.VITE_NOVAWAY_CHANNEL": JSON.stringify(channel),
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
          loading: "src/renderer/loading.html",
          floating: "src/renderer/floating.html",
        },
      },
    },
  },
})

async function loadMigrations() {
  const dirs = (await fs.readdir(NOVAWAY_MIGRATION_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(
    dirs.map(async (name) => ({
        sql: await fs.readFile(path.join(NOVAWAY_MIGRATION_DIR, name, "migration.sql"), "utf-8"),
      timestamp: time(name),
      name,
    })),
  )
}

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}
