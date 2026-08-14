#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const chromiumBidiCjsStubPlugin = {
  name: "stub-chromium-bidi-cjs",
  setup(build) {
    build.onResolve({ filter: /^chromium-bidi\/lib\/cjs\// }, (args) => ({
      path: args.path,
      namespace: "chromium-bidi-cjs-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "chromium-bidi-cjs-stub" }, () => ({
      contents: "export default {}",
      loader: "js",
    }))
  },
}

const pptxWorkerBundlePath = path.join(dir, "dist", "ppt-worker", "worker.mjs")
const pptxWorkerAssetPath = path.join(dir, "dist", "ppt-worker", "worker.asset")

const buildPptxWorkerBundle = async () => {
  console.log(`Building PPT browser worker bundle`)
  await fs.promises.mkdir(path.dirname(pptxWorkerBundlePath), { recursive: true })
  const result = await Bun.build({
    target: "node",
    entrypoints: [path.join(dir, "src/office/pptx/worker.mjs")],
    outdir: path.dirname(pptxWorkerBundlePath),
    naming: "worker.mjs",
    format: "esm",
    plugins: [chromiumBidiCjsStubPlugin],
  })
  if (!result.success) throw new Error("PPT worker \u6253\u5305\u5931\u8d25")
  await fs.promises.copyFile(pptxWorkerBundlePath, pptxWorkerAssetPath)
}

const createEmbeddedSkillAssetsBundle = async () => {
  console.log(`Generating embedded skill assets bundle`)
  await buildPptxWorkerBundle()
  const SKILL_DIRS = [
    {
      name: "office-ppt",
      dir: path.join(dir, "src/skill/prompt/office-ppt"),
      extraFiles: [{ key: "pptx-worker/worker.mjs", absPath: pptxWorkerAssetPath }],
    },
    { name: "xiaohongshu-ops", dir: path.join(dir, "src/skill/prompt/xiaohongshu-ops") },
    { name: "wxgzh-ops", dir: path.join(dir, "src/skill/prompt/wxgzh-ops") },
  ]
  const entries = []
  let fileIdx = 0
  for (const { name, dir: skillDir, extraFiles } of SKILL_DIRS) {
    const extraEntries = []
    for (const extra of extraFiles ?? []) {
      const spec = path.relative(dir, extra.absPath).replaceAll("\\", "/")
      extraEntries.push({
        key: `${name}/${extra.key}`,
        spec: spec.startsWith(".") ? spec : `./${spec}`,
        idx: fileIdx++,
      })
    }
    const exists = await fs.promises.stat(skillDir).then(
      () => true,
      () => false,
    )
    if (!exists) {
      entries.push(...extraEntries)
      console.log(`  ${name}: directory not found, ${extraFiles?.length ?? 0} extra files`)
      continue
    }
    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: skillDir })))
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f !== "SKILL.md" && f !== "CLAUDE.md" && !f.includes("__pycache__"))
      .sort()
    for (const file of files) {
      const absPath = path.join(skillDir, file)
      const spec = path.relative(dir, absPath).replaceAll("\\", "/")
      entries.push({ key: `${name}/${file}`, spec: spec.startsWith(".") ? spec : `./${spec}`, idx: fileIdx++ })
    }
    entries.push(...extraEntries)
    console.log(`  ${name}: ${files.length + (extraFiles?.length ?? 0)} files`)
  }
  if (entries.length === 0) return null
  const imports = entries.map((e) => `import file_${e.idx} from ${JSON.stringify(e.spec)} with { type: "file" };`)
  const mapEntries = entries.map((e) => `  ${JSON.stringify(e.key)}: file_${e.idx},`)
  return [`// Generated by build.ts — built-in skill assets`, ...imports, `export default {`, ...mapEntries, `}`].join(
    "\n",
  )
}

const skillAssetsMap = await createEmbeddedSkillAssetsBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin, chromiumBidiCjsStubPlugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
      ...(skillAssetsMap ? { "opencode-skills.gen.ts": skillAssetsMap } : {}),
    },
    entrypoints: [
      "./src/index.ts",
      parserWorker,
      workerPath,
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
      ...(skillAssetsMap ? ["opencode-skills.gen.ts"] : []),
    ],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/opencode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
