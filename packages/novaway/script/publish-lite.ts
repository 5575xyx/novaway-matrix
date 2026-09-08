#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@novaway/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// 使用新的包名避免限流
const NPM_PACKAGE_NAME = "xymt-novaway"
const BIN_NAME = "novaway"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

// 只发布主包，不包含二进制文件
// 二进制文件已上传到 GitHub Releases
const version = Script.version

await $`mkdir -p ./dist/${NPM_PACKAGE_NAME}`
await $`mkdir -p ./dist/${NPM_PACKAGE_NAME}/bin`
await $`cp ./script/postinstall-lite.mjs ./dist/${NPM_PACKAGE_NAME}/postinstall.mjs`
await Bun.file(`./dist/${NPM_PACKAGE_NAME}/LICENSE`).write(await Bun.file("../../LICENSE").text())

// 占位文件，提示用户 postinstall 脚本会下载二进制
await Bun.file(`./dist/${NPM_PACKAGE_NAME}/bin/${BIN_NAME}.exe`).write(
  [
    `echo "Error: ${NPM_PACKAGE_NAME}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${NPM_PACKAGE_NAME} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${NPM_PACKAGE_NAME} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`./dist/${NPM_PACKAGE_NAME}/package.json`).write(
  JSON.stringify(
    {
      name: NPM_PACKAGE_NAME,
      bin: {
        [BIN_NAME]: `./bin/${BIN_NAME}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      repository: {
        type: "git",
        url: "https://github.com/5575xyx/novaway-matrix.git",
      },
      description: "AI coding agent built for the terminal - NovaWay Matrix Edition",
      keywords: ["ai", "cli", "coding-assistant", "novaway", "opencode"],
    },
    null,
    2,
  ),
)

if (await published(NPM_PACKAGE_NAME, version)) {
  console.log(`already published ${NPM_PACKAGE_NAME}@${version}`)
  await syncNpmmirror([[NPM_PACKAGE_NAME, version]])
  process.exit(0)
}

await $`bun pm pack`.cwd(`./dist/${NPM_PACKAGE_NAME}`)
await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${NPM_PACKAGE_NAME}`)

await syncNpmmirror([[NPM_PACKAGE_NAME, version]])

console.log(`✅ Published ${NPM_PACKAGE_NAME}@${version} to npm with tag ${Script.channel}`)
console.log(`\nInstall with: npm install -g ${NPM_PACKAGE_NAME}@${Script.channel}`)

// 镜像用户的自动更新走 npmmirror,而它的同步是惰性的(0.1.6→0.1.7 时主包到了、
// windows-x64 滞后,镜像用户升级静默失败)。发布完主动触发同步并确认供上。
// NOVAWAY_SKIP_MIRROR_SYNC=true 跳过;NOVAWAY_MIRROR_SYNC_TIMEOUT(分钟)控制等待窗口。
const MIRROR = "https://registry-direct.npmmirror.com"

async function mirrorVersion(name: string, tag: string) {
  const res = await fetch(`${MIRROR}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?_=${Date.now()}`, {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    signal: AbortSignal.timeout(30000),
  }).catch(() => undefined)
  if (!res || res.status !== 200) return undefined
  const body = (await res.json().catch(() => undefined)) as { version?: string } | undefined
  return body?.version
}

async function syncNpmmirror(entries: [string, string][]) {
  if (process.env.NOVAWAY_SKIP_MIRROR_SYNC === "true") {
    console.log("⏭️  NOVAWAY_SKIP_MIRROR_SYNC=true,跳过 npmmirror 同步")
    return
  }
  console.log(`\n🔄 触发 npmmirror 同步（${entries.length} 个包）...`)
  for (const [name] of entries) {
    const ok = await fetch(`${MIRROR}/-/package/${encodeURIComponent(name)}/syncs`, {
      method: "PUT",
      signal: AbortSignal.timeout(30000),
    })
      .then((res) => res.ok)
      .catch((error) => {
        console.error(`   ⚠️ 同步触发请求失败 ${name}: ${error}`)
        return false
      })
    console.log(`   ${ok ? "已触发" : "⚠️ 触发失败（仍会轮询确认）"}: ${name}`)
  }
  const timeoutMinutes = Number(process.env.NOVAWAY_MIRROR_SYNC_TIMEOUT ?? 10)
  if (!(timeoutMinutes > 0)) {
    console.log("⏭️  NOVAWAY_MIRROR_SYNC_TIMEOUT<=0,只触发不等待")
    return
  }
  const pending = [...entries]
  const deadline = Date.now() + timeoutMinutes * 60_000
  while (pending.length > 0) {
    for (const [name, version] of [...pending]) {
      if ((await mirrorVersion(name, Script.channel)) === version) pending.splice(pending.findIndex(([n]) => n === name), 1)
    }
    if (pending.length === 0) break
    if (Date.now() > deadline) {
      console.error(`⚠️  ${timeoutMinutes} 分钟后 npmmirror 仍未供上：${pending.map(([n, v]) => `${n}@${v}`).join(", ")}`)
      console.error(`   源 registry 已完整,发布继续;但镜像用户的自动更新会静默失败。手动补同步:`)
      for (const [name] of pending) console.error(`   curl -X PUT ${MIRROR}/-/package/${name}/syncs`)
      return
    }
    console.log(`⏳ 等待 npmmirror 供上（剩 ${Math.ceil((deadline - Date.now()) / 60_000)} 分钟）：${pending.map(([n]) => n).join(", ")}`)
    await sleep(30000)
  }
  console.log(`✅ npmmirror 已供上全部 ${entries.length} 个包,镜像用户的自动更新可用`)
}

