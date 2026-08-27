#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@novaway/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

// 只发布 novaway-ai 主包，不包含二进制文件
// 二进制文件已上传到 GitHub Releases
const version = Script.version

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall-lite.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

// 占位文件，提示用户 postinstall 脚本会下载二进制
await Bun.file(`./dist/${pkg.name}/bin/${pkg.name}.exe`).write(
  [
    `echo "Error: ${pkg.name}-ai's postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${pkg.name}-ai && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${pkg.name}-ai without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}.exe`,
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
    },
    null,
    2,
  ),
)

if (await published(`${pkg.name}-ai`, version)) {
  console.log(`already published ${pkg.name}-ai@${version}`)
  process.exit(0)
}

await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${pkg.name}`)

console.log(`✅ Published ${pkg.name}-ai@${version} to npm with tag ${Script.channel}`)
