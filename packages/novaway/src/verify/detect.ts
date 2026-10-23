/**
 * 项目验证命令探测。
 *
 * 对齐"E2E 验证"的做法：不内置某个测试框架，而是**按项目现有的脚本**跑
 * 测试 / 类型检查 / Lint / 构建。这样换语言、换框架都不需要改代码。
 */
import fs from "node:fs/promises"
import path from "node:path"

export type VerifyKind = "test" | "e2e" | "typecheck" | "lint" | "build"

export type VerifyCommand = {
  id: string
  label: string
  command: string
  kind: VerifyKind
  /** 该命令由哪个文件推断出来，便于用户理解。 */
  source: string
}

const PACKAGE_SCRIPT_KINDS: Array<{ script: string; kind: VerifyKind; label: string }> = [
  { script: "test:e2e", kind: "e2e", label: "E2E tests" },
  { script: "e2e", kind: "e2e", label: "E2E tests" },
  { script: "test", kind: "test", label: "Unit tests" },
  { script: "test:unit", kind: "test", label: "Unit tests" },
  { script: "typecheck", kind: "typecheck", label: "Typecheck" },
  { script: "lint", kind: "lint", label: "Lint" },
  { script: "build", kind: "build", label: "Build" },
]

async function readJSON<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

const managerCommand = async (root: string) => {
  if ((await exists(path.join(root, "bun.lock"))) || (await exists(path.join(root, "bun.lockb")))) return "bun run"
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm run"
  if (await exists(path.join(root, "yarn.lock"))) return "yarn"
  return "npm run"
}

export async function detect(root: string): Promise<VerifyCommand[]> {
  const result: VerifyCommand[] = []
  const seen = new Set<string>()
  const push = (item: VerifyCommand) => {
    if (seen.has(item.command)) return
    seen.add(item.command)
    result.push(item)
  }

  const pkg = await readJSON<{ scripts?: Record<string, string> }>(path.join(root, "package.json"))
  if (pkg?.scripts) {
    const runner = await managerCommand(root)
    for (const item of PACKAGE_SCRIPT_KINDS) {
      if (!pkg.scripts[item.script]) continue
      push({
        id: "npm:" + item.script,
        label: item.label,
        command: runner + " " + item.script,
        kind: item.kind,
        source: "package.json",
      })
    }
  }

  if (await exists(path.join(root, "go.mod"))) {
    push({ id: "go:test", label: "Go tests", command: "go test ./...", kind: "test", source: "go.mod" })
    push({ id: "go:vet", label: "Go vet", command: "go vet ./...", kind: "lint", source: "go.mod" })
  }

  if (await exists(path.join(root, "Cargo.toml"))) {
    push({ id: "cargo:test", label: "Cargo tests", command: "cargo test", kind: "test", source: "Cargo.toml" })
    push({ id: "cargo:check", label: "Cargo check", command: "cargo check", kind: "typecheck", source: "Cargo.toml" })
  }

  const python =
    (await exists(path.join(root, "pyproject.toml"))) ||
    (await exists(path.join(root, "pytest.ini"))) ||
    (await exists(path.join(root, "setup.cfg"))) ||
    (await exists(path.join(root, "tox.ini")))
  if (python) {
    push({
      id: "python:pytest",
      label: "Pytest",
      command: "python -m pytest -q",
      kind: "test",
      source: "pyproject.toml",
    })
  }

  if (await exists(path.join(root, "Makefile"))) {
    const makefile = await fs.readFile(path.join(root, "Makefile"), "utf8").catch(() => "")
    for (const [target, kind, label] of [
      ["test", "test", "make test"],
      ["lint", "lint", "make lint"],
      ["build", "build", "make build"],
    ] as const) {
      if (new RegExp("^" + target + "\s*:", "m").test(makefile)) {
        push({ id: "make:" + target, label, command: "make " + target, kind, source: "Makefile" })
      }
    }
  }

  return result
}
