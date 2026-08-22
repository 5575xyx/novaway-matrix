import { AppFileSystem } from "@novaway/core/filesystem"
import path from "path"
import { Effect } from "effect"

const maxProjectContextChars = 32_000

const contextFiles = [
  ["项目概览", ".novaway/context/project.md"],
  ["架构说明", ".novaway/context/architecture.md"],
  ["工程约定", ".novaway/context/conventions.md"],
  ["工作流程", ".novaway/context/workflow.md"],
  ["决策记录", ".novaway/context/decisions.md"],
  ["术语表", ".novaway/context/glossary.md"],
  ["项目记忆", ".novaway/memory/project.md"],
] as const

export function projectRoot(input: { directory: string; worktree: string }) {
  return input.worktree === "/" ? input.directory : input.worktree
}

export const read = Effect.fn("ProjectContext.read")(function* (input: {
  directory: string
  worktree: string
  plan?: string
}) {
  const fs = yield* AppFileSystem.Service
  return build(
    yield* Effect.all(
      [
        ...contextFiles.map(([title, relativePath]) =>
          readSection(fs, title, path.join(projectRoot(input), relativePath), relativePath),
        ),
        input.plan ? readSection(fs, "当前计划", input.plan, path.relative(projectRoot(input), input.plan)) : undefined,
      ].filter((item) => item !== undefined),
    ),
  )
})

export function build(sections: { title: string; source: string; content: string }[]) {
  const content = sections
    .filter((section) => section.content.trim())
    .map((section) => [`## ${section.title}`, `来源：${section.source}`, "", section.content.trim()].join("\n"))
    .join("\n\n")
    .trim()
  if (!content) return ""
  if (content.length <= maxProjectContextChars) return ["# NovaWay 项目上下文", content].join("\n\n")
  return ["# NovaWay 项目上下文", content.slice(0, maxProjectContextChars), "\n[内容已截断]"].join("\n\n")
}

function readSection(fs: AppFileSystem.Interface, title: string, file: string, source: string) {
  return fs.readFileStringSafe(file).pipe(Effect.map((content) => ({ title, source, content: content ?? "" })))
}

export * as ProjectContext from "./project-context"
