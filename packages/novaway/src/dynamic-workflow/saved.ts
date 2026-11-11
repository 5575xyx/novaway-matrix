/**
 * 保存下来的工作流脚本：一份文件就是一次可重用的 run。
 *
 * 为什么是文件而不是数据库行：脚本是**作者资产**，它应该能被读、被 diff、被提交进仓库。
 * 数据库里的一列做不到这些，而一段 40 行的 TypeScript 恰好是最适合放在 git 里的形状。
 *
 * 文件格式刻意是「注释头 + 脚本正文」：
 *
 *     /** name: 评审本次改动
 *      *  description: 并行看每个改动文件，汇总真问题
 *      *  when_to_use: 用户说「帮我 review 一下这次改动」
 *      *\/
 *     phase("评审")
 *     …
 *
 * 注释对编译器无害，因此这份文件**本身就是**一份合法的脚本：`prepareWorkflow(整份文件)`
 * 能直接跑，不需要先剥头。元数据只影响「列表里怎么显示、模型什么时候想起来用它」。
 */

import path from "node:path"

/** 项目级目录：跟着仓库走，可以提交。 */
export const PROJECT_DIR = path.join(".novaway", "workflows")
/** 全局目录：跨仓库通用。 */
export const GLOBAL_SUBDIR = "workflows"

export type Scope = "project" | "global"

/** 名字直接变成文件名，所以只允许这套字符：大小写不敏感、无空格、跨平台安全。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export interface SavedMeta {
  readonly name: string
  readonly description?: string
  readonly whenToUse?: string
}

export interface SavedWorkflow extends SavedMeta {
  readonly scope: Scope
  /** 绝对路径。 */
  readonly path: string
  /** 相对工作区的路径，用于权限与展示。 */
  readonly relative: string
}

export function validateName(name: string): string | undefined {
  if (!NAME_PATTERN.test(name)) {
    return `工作流名字 "${name}" 不能用：只允许小写字母、数字、点、下划线与连字符，且不超过 64 个字符（它会变成文件名）。`
  }
  return undefined
}

export function fileName(name: string): string {
  return `${name}.dwf.ts`
}

/** 文件头。只用行注释，这样它在脚本里也是纯粹的一行注释。 */
export function renderHeader(meta: SavedMeta): string {
  const lines = [`// name: ${meta.name}`]
  if (meta.description) lines.push(`// description: ${oneLine(meta.description)}`)
  if (meta.whenToUse) lines.push(`// when_to_use: ${oneLine(meta.whenToUse)}`)
  return lines.join("\n")
}

/** 元数据里出现换行会把头部撑破（第二行开始就不再是注释），压成一行。 */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim()
}

/**
 * 从文件正文里读回元数据。
 *
 * 只认文件**开头**连续的 `// key: value` 行，遇到第一条非注释就停。这样脚本里
 * 后面再出现 `// name:` 也不会被误当成元数据。
 */
export function parseHeader(text: string): SavedMeta | undefined {
  const lines = text.split(/\r?\n/)
  const found: Record<string, string> = {}
  for (const line of lines) {
    const match = /^\/\/\s*([a-z_]+)\s*:\s*(.*)$/.exec(line.trim())
    if (!match) break
    const key = match[1]!
    if (key !== "name" && key !== "description" && key !== "when_to_use") break
    found[key] = match[2]!.trim()
  }
  const name = found.name
  if (!name) return undefined
  return {
    name,
    ...(found.description ? { description: found.description } : {}),
    ...(found.when_to_use ? { whenToUse: found.when_to_use } : {}),
  }
}

/** 保存时写入的完整内容。头与正文之间空一行，读起来像一份正常的源文件。 */
export function renderSavedScript(meta: SavedMeta, script: string): string {
  return `${renderHeader(meta)}\n\n${script.trimEnd()}\n`
}

/** 去掉头部之后剩下的脚本。保存过的文件可以直接交给 `prepareWorkflow`，这里只给需要正文的场景用。 */
export function stripHeader(text: string): string {
  const lines = text.split(/\r?\n/)
  let index = 0
  while (index < lines.length && /^\/\/\s*[a-z_]+\s*:/.test(lines[index]!.trim())) index += 1
  return lines.slice(index).join("\n").trimStart()
}
