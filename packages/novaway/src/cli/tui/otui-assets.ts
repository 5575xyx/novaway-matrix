import fs from "fs"
import path from "path"
import { Global } from "@novaway/core/global"
import { InstallationVersion } from "@novaway/core/installation/version"
import * as Log from "@novaway/core/util/log"

const log = Log.create({ service: "otui-assets" })

let ensured: Promise<void> | undefined

// In a Bun single-file binary, @opentui/core's runtime assets — the tree-sitter
// worker script, the native render lib (opentui.dll/.so/.dylib), the tree-sitter
// wasm runtime and the per-language grammar files — cannot be baked into the
// executable (dynamic `import(..., { type: "file" })` returns undefined `.default`,
// which is why the TUI crashed at startup with `$.startsWith`). opentui exposes
// OTUI_ASSET_ROOT for exactly this: an absolute directory laid out as
// `<root>/<assetKey>`. build.ts embeds those files (opencode-otui-assets.gen.ts);
// we extract them here on first launch and point opentui at the extracted dir.
//
// Must run before @opentui/core is imported in this process AND before the render
// worker is spawned (the worker inherits process.env, so OTUI_ASSET_ROOT carries
// over). No-op in dev / node builds, where opentui resolves assets from node_modules.
export function ensureOtuiAssets(): Promise<void> {
  ensured ??= run()
  return ensured
}

async function run() {
  if (process.env.OTUI_ASSET_ROOT) return
  const map = await // @ts-expect-error — generated at build time
  import("opencode-otui-assets.gen.ts")
    .then((m) => m.default as Record<string, string>)
    .catch(() => null)
  if (!map) return // dev / node build: assets resolve from node_modules

  const root = path.join(Global.Path.cache, "otui-assets", InstallationVersion)
  await Promise.all(
    Object.entries(map).map(async ([key, src]) => {
      const dest = path.join(root, key)
      // Copy atomically (tmp + rename) so a crash mid-copy never leaves a truncated
      // asset that opentui would then statSync().isFile() and load as corrupt.
      // `src` is a bunfs path into the compiled binary (e.g. B:/~BUN/root/...); plain
      // fs.copyFile() ENOENTs on those, so read via Bun.file()/Bun.write() which
      // understand embedded assets. (Bun runtime is guaranteed here — this only runs
      // in the compiled binary / bun-run dev; node builds return early above.)
      if (await exists(dest)) return
      await fs.promises.mkdir(path.dirname(dest), { recursive: true })
      const tmp = `${dest}.${process.pid}.tmp`
      await Bun.write(tmp, Bun.file(src))
      await fs.promises.rename(tmp, dest).catch(async (e) => {
        await fs.promises.rm(tmp, { force: true }).catch(() => {})
        if (!(await exists(dest))) throw e
      })
    }),
  )
  process.env.OTUI_ASSET_ROOT = root
  log.info("extracted opentui runtime assets", { root, count: Object.keys(map).length })
}

function exists(p: string) {
  return fs.promises.stat(p).then(
    () => true,
    () => false,
  )
}
