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
  process.exit(0)
}

await $`bun pm pack`.cwd(`./dist/${NPM_PACKAGE_NAME}`)
await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${NPM_PACKAGE_NAME}`)

console.log(`✅ Published ${NPM_PACKAGE_NAME}@${version} to npm with tag ${Script.channel}`)
console.log(`\nInstall with: npm install -g ${NPM_PACKAGE_NAME}@${Script.channel}`)

