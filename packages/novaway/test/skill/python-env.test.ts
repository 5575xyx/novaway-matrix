import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  findRequirements,
  forgetUnder,
  missingEnvNote,
  prepare,
  pythonEnvNote,
  skillEnvRoot,
  skillPythonPath,
  status,
  verifyModules,
} from "@/skill/python-env"

const tempRoots: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-skillpy-"))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  delete process.env.NOVAWAY_SKILL_PYTHON_HOME
})

/** 假解释器：探测、建 venv、pip、import 全部成功。 */
const okRunner = (calls: string[]) => async (input: { command: string; args: string[] }) => {
  calls.push(input.command + " " + input.args.join(" "))
  return "ok"
}

async function exists(target: string) {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false)
}

describe("skill.python-env", () => {
  test("maps requirement names to import names", () => {
    const modules = verifyModules(
      [
        "PyYAML>=6.0",
        "python-pptx>=0.6.21",
        "skia-pathops>=0.9.2",
        "uharfbuzz>=0.50.0",
        "# comment",
        "-r other.txt",
      ].join("\n"),
    )
    expect(modules).toEqual(["yaml", "pptx", "pathops", "uharfbuzz"])
  })

  test("finds requirements inside the conventional skills directory and uses frontmatter name", async () => {
    const root = await tempDir()
    const skill = path.join(root, "skills", "ppt-master")
    await fs.mkdir(skill, { recursive: true })
    await fs.writeFile(path.join(skill, "SKILL.md"), ["---", "name: ppt-master", "description: demo", "---"].join("\n"))
    await fs.writeFile(path.join(skill, "requirements.txt"), "PyYAML>=6.0\n")

    const found = await findRequirements(root)
    expect(found?.file).toBe(path.join(skill, "requirements.txt"))
    expect(found?.name).toBe("ppt-master")
  })

  test("falls back to the extension root requirements", async () => {
    const root = await tempDir()
    await fs.writeFile(path.join(root, "requirements.txt"), "python-pptx\n")
    const found = await findRequirements(root)
    expect(found?.name).toBe(path.basename(root))
  })

  test("reports idle when nothing was installed", async () => {
    process.env.NOVAWAY_SKILL_PYTHON_HOME = await tempDir()
    const info = await status("ppt-master")
    expect(info.state).toBe("idle")
  })

  test("prepares an isolated venv with requirements and persists the status", async () => {
    process.env.NOVAWAY_SKILL_PYTHON_HOME = await tempDir()
    const requirements = path.join(await tempDir(), "requirements.txt")
    await fs.writeFile(requirements, "PyYAML>=6.0\npython-pptx>=0.6.21\n")

    const calls: string[] = []
    const result = await prepare({ name: "ppt-master", requirements, runner: okRunner(calls) })
    expect(result.state).toBe("ready")
    expect(result.python).toBe(skillPythonPath("ppt-master"))
    expect(calls.some((call) => call.includes("-r " + requirements))).toBe(true)
    // 装完会验证能不能 import：PyYAML / python-pptx 都在映射表里。
    expect(calls.some((call) => call.includes("import yaml"))).toBe(true)
    expect(calls.some((call) => call.includes("import pptx"))).toBe(true)

    // 记录已 ready，但解释器文件还不存在时如实回到 idle（不能让模型拿到假路径）。
    expect((await status("ppt-master")).state).toBe("idle")

    const python = skillPythonPath("ppt-master")
    await fs.mkdir(path.dirname(python), { recursive: true })
    await fs.writeFile(python, "")
    const ready = await status("ppt-master")
    expect(ready.state).toBe("ready")
    expect(ready.python).toBe(python)
  })

  test("keeps a failed install with its reason", async () => {
    process.env.NOVAWAY_SKILL_PYTHON_HOME = await tempDir()
    const requirements = path.join(await tempDir(), "requirements.txt")
    await fs.writeFile(requirements, "python-pptx\n")

    const result = await prepare({
      name: "ppt-master",
      requirements,
      runner: async (input) => {
        if (input.args.includes("pip")) throw new Error("No matching distribution found for python-pptx")
        return "ok"
      },
    })
    expect(result.state).toBe("error")
    expect(result.error).toContain("No matching distribution")
    const info = await status("ppt-master")
    expect(info.state).toBe("error")
    expect(pythonEnvNote(info)).toContain("skill_python")
  })

  test("gives the model the exact interpreter once ready", async () => {
    const note = pythonEnvNote({ state: "ready", name: "ppt-master", python: "C:/env/python.exe" })
    expect(note).toContain("C:/env/python.exe")
    expect(note).toContain("不要使用 python3")
    expect(missingEnvNote("ppt-master", "/x/requirements.txt")).toContain("skill_python")
  })
})

describe("skill.python-env forgetUnder", () => {
  test("removes only environments that belong to the uninstalled extension", async () => {
    process.env.NOVAWAY_SKILL_PYTHON_HOME = await tempDir()
    const extensions = await tempDir()
    const mine = path.join(extensions, "ppt-master@main")
    const other = path.join(extensions, "other@main")
    const mineRequirements = path.join(mine, "skills", "ppt-master", "requirements.txt")
    const otherRequirements = path.join(other, "requirements.txt")
    for (const file of [mineRequirements, otherRequirements]) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, "")
    }
    await prepare({ name: "ppt-master", requirements: mineRequirements, runner: okRunner([]) })
    await prepare({ name: "other", requirements: otherRequirements, runner: okRunner([]) })

    await forgetUnder(mine)
    expect(await exists(path.join(skillEnvRoot("ppt-master"), "environment.json"))).toBe(false)
    expect(await exists(path.join(skillEnvRoot("other"), "environment.json"))).toBe(true)
  })
})
