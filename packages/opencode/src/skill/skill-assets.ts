import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "skill-assets" })
const SKILLS_CACHE_REL = ".opencode/skills"

const extracted = new Set<string>()

function loadBundle(): Effect.Effect<Record<string, string> | null> {
  return Effect.promise(
    () =>
      // @ts-expect-error — generated at build time
      import("opencode-skills.gen.ts").then((m) => m.default as Record<string, string>),
  ).pipe(Effect.orElseSucceed(() => null))
}

export function ensureSkillExtracted(
  skillName: string,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
): Effect.Effect<string | null> {
  return Effect.gen(function* () {
    if (extracted.has(skillName)) {
      return path.join(global.home, SKILLS_CACHE_REL, skillName)
    }

    const targetBase = path.join(global.home, SKILLS_CACHE_REL)
    const targetDir = path.join(targetBase, skillName)

    const alreadyExists = yield* fsys.isDir(targetDir)
    if (alreadyExists) {
      extracted.add(skillName)
      return targetDir
    }

    const bundle = yield* loadBundle()
    if (!bundle) return null

    const prefix = `${skillName}/`
    const entries = Object.entries(bundle).filter(([k]) => k.startsWith(prefix))
    if (entries.length === 0) return null

    yield* fsys.ensureDir(targetBase)

    for (const [key, sourcePath] of entries) {
      const target = path.join(targetBase, key)
      yield* fsys.ensureDir(path.dirname(target))
      const content = yield* Effect.promise(() => Bun.file(sourcePath).arrayBuffer())
      yield* fsys.writeWithDirs(target, new Uint8Array(content))
    }

    log.info("extracted built-in skill assets", { skill: skillName, count: entries.length })
    extracted.add(skillName)
    return targetDir
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}
