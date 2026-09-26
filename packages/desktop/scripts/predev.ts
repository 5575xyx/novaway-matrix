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
// --env-file 显式指到仓库根 .env.local:cd 之后 bun 的自动 .env 加载够不到根目录,
// 会让 NOVAWAY_GATEWAY_EMBED_URL/KEY 为空、内置提供商不注册(Auto 模式失效)。
await $`cd ../novaway && bun --env-file=../../.env.local script/build-node.ts`
