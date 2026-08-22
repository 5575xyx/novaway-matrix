import { $ } from "bun"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const tmp = join(process.cwd(), ".tmp")
mkdirSync(tmp, { recursive: true })
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.TMPDIR = tmp

await $`bun ./scripts/copy-icons.ts ${process.env.NovaWay_CHANNEL ?? "dev"}`

await $`cd ../NovaWay && bun script/build-node.ts`
