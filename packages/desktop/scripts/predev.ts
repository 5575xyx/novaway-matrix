import { $ } from "bun"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const tmp = join(process.cwd(), ".tmp")
mkdirSync(tmp, { recursive: true })
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.TMPDIR = tmp

await $`bun ./scripts/copy-icons.ts ${process.env.NovaWay_CHANNEL ?? "dev"}`

// 包目录是 packages/novaway(小写 n);写 ../NovaWay 在 Linux 上会 cd 失败。
await $`cd ../novaway && bun script/build-node.ts`
