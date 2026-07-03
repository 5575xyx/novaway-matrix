#!/usr/bin/env bun
import { $ } from "bun"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { resolveChannel } from "./utils"

const tmp = join(process.cwd(), ".tmp")
mkdirSync(tmp, { recursive: true })
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.TMPDIR = tmp

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
