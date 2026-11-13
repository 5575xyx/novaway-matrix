#!/usr/bin/env bun
/**
 * D1–D9「只新增文件 + 一份 manifest」审查（插件文档 §0.2、§15.1）。
 *
 * 演练本身由各专项测试承担（能力行为）；这里补上设计文档要求的另一半证据：
 * **演练过程不得改动任何禁止文件**。做法是对禁止文件取内容哈希、并对整仓
 * `git status --porcelain` 取快照，跑完演练后逐项比对 —— 前后不一致即失败。
 *
 * 说明：本仓库工作区可能已有其他并行改动的脏文件；审查断言的是「演练没有造成新的改动」，
 * 而不是「禁止文件与 HEAD 一致」。演练的 plugin fixture 全部写在 os.tmpdir()，不落仓库。
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..", "..", "..")
const packageRoot = path.resolve(import.meta.dir, "..")

type Drill = { id: string; forbidden: string[]; steps: Array<[string, string[]]> }

const drills: Drill[] = [
  {
    id: "D1",
    forbidden: [
      "packages/novaway/src/tool/registry.ts",
      "packages/novaway/src/session/prompt.ts",
      "packages/novaway/src/agent/agent.ts",
    ],
    steps: [
      [
        "tool contribution drill",
        ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D1:", "--timeout", "120000"],
      ],
    ],
  },
  {
    id: "D2",
    forbidden: [
      "packages/novaway/src/agent/agent.ts",
      "packages/novaway/src/skill/index.ts",
      "packages/novaway/src/command/index.ts",
    ],
    steps: [
      [
        "agent/skill/command drill",
        ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D2:", "--timeout", "120000"],
      ],
    ],
  },
  {
    id: "D3",
    forbidden: [
      "packages/novaway/src/provider/provider.ts",
      "packages/novaway/src/provider/transform.ts",
      "packages/novaway/src/provider/schema.ts",
    ],
    steps: [
      [
        "provider adapter drill",
        [
          "test",
          "test/provider/provider.test.ts",
          "--test-name-pattern",
          "runtime provider adapter",
          "--timeout",
          "120000",
        ],
      ],
    ],
  },
  {
    id: "D4",
    forbidden: ["packages/core/src/office/engine/registry.ts", "packages/app/src/pages/session/file-tabs.tsx"],
    steps: [
      [
        "office engine drill",
        [
          "test",
          "test/plugin/runtime-context.test.ts",
          "--test-name-pattern",
          "built-in office engine",
          "--timeout",
          "120000",
        ],
      ],
      ["office edit through builtin engine", ["test", "test/server/office-edit.test.ts", "--timeout", "120000"]],
    ],
  },
  {
    id: "D5",
    forbidden: [
      "packages/desktop/src/main/platform/index.ts",
      "packages/app/src/pages/pulse/publish-capabilities.ts",
      "packages/app/src/pages/pulse/AddAccountModal.tsx",
    ],
    steps: [
      [
        "publish driver drill",
        ["test", "test/plugin/runtime-context.test.ts", "--test-name-pattern", "publish driver", "--timeout", "120000"],
      ],
      [
        "publish bridge drill",
        ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D5:", "--timeout", "120000"],
      ],
    ],
  },
  {
    id: "D6",
    forbidden: [
      "packages/app/src/pages/layout.tsx",
      "packages/app/src/app.tsx",
      "packages/app/src/components/settings-runtime.tsx",
      "packages/app/src/pages/session/file-tabs.tsx",
    ],
    steps: [
      [
        "surface drill",
        [
          "test",
          "test/plugin/runtime-context.test.ts",
          "--test-name-pattern",
          "built-in surface",
          "--timeout",
          "120000",
        ],
      ],
    ],
  },
  {
    id: "D7",
    forbidden: [],
    steps: [
      [
        "builtin bundle disable drill",
        ["test", "test/plugin/runtime-context.test.ts", "--test-name-pattern", "D7:", "--timeout", "120000"],
      ],
      [
        "builtin disable keeps sessions usable",
        [
          "test",
          "test/server/httpapi-plugin.test.ts",
          "--test-name-pattern",
          "D7: disabling the shipped",
          "--timeout",
          "120000",
        ],
      ],
    ],
  },
  {
    id: "D8",
    forbidden: [],
    steps: [
      [
        "override drill",
        ["test", "test/plugin/runtime-host.test.ts", "--test-name-pattern", "D8:", "--timeout", "120000"],
      ],
    ],
  },
  {
    id: "D9",
    forbidden: [],
    steps: [
      [
        "hot toggle drill",
        ["test", "test/server/httpapi-plugin.test.ts", "--test-name-pattern", "D9:", "--timeout", "120000"],
      ],
    ],
  },
]

const hashFile = (file: string) =>
  fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing"

function snapshot(drill: Drill) {
  return {
    forbidden: Object.fromEntries(drill.forbidden.map((file) => [file, hashFile(path.join(root, file))])),
    status: spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout ?? "",
  }
}

function run(args: string[]) {
  const result = spawnSync("bun", args, { cwd: packageRoot, encoding: "utf8", timeout: 300_000 })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const ran = /Ran (\d+) tests?/.exec(output)
  const failed = /(\d+) fail/.exec(output)
  return {
    ok: result.status === 0 && Number(ran?.[1] ?? 0) > 0 && Number(failed?.[1] ?? 0) === 0,
    ran: Number(ran?.[1] ?? 0),
    failed: Number(failed?.[1] ?? 0),
    status: result.status,
    tail: output.trim().split("\n").slice(-4).join(" | "),
  }
}

let red = false
for (const drill of drills) {
  console.log(`\n== ${drill.id} ==`)
  const before = snapshot(drill)
  let ok = true
  for (const [name, args] of drill.steps) {
    const result = run(args)
    console.log(
      `${result.ok ? "PASS" : "FAIL"} ${name}: ran=${result.ran} fail=${result.failed} exit=${result.status} :: ${result.tail}`,
    )
    if (!result.ok) ok = false
  }
  const after = snapshot(drill)
  const changed = drill.forbidden.filter((file) => before.forbidden[file] !== after.forbidden[file])
  const statusChanged = before.status !== after.status
  if (changed.length > 0) {
    console.log(`FAIL forbidden files changed: ${changed.join(", ")}`)
    ok = false
  }
  if (statusChanged) {
    console.log("FAIL repository git status changed during the drill")
    ok = false
  }
  console.log(
    `${ok ? "PASS" : "FAIL"} ${drill.id} audit: forbidden=${drill.forbidden.length} files, repo-status-unchanged=${!statusChanged}`,
  )
  if (!ok) red = true
}
console.log(`\nDRILL_AUDIT ${red ? "FAILED" : "PASSED"}`)
process.exitCode = red ? 1 : 0
