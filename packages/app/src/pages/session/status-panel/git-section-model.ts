import { num, type Snapshot } from "../git-panel"

// Git 区块的纯逻辑部分单独成文件。
//
// 原因：区块组件要通过 Kobalte 的 Button / DropdownMenu 渲染（分支切换菜单），
// 而 @kobalte/core 在模块作用域会触碰客户端 API，使纯逻辑单测只能解析到 solid 的 SSR 构建、
// 一 import 就抛 "Client-only API called on the server side"。
// 把模型与统计抽出来，测试只依赖本文件，组件可以自由使用 Kobalte。

export type GitSectionModel = {
  added: number
  removed: number
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  dirty: number
  staged: string[]
  unstaged: string[]
  branches: string[]
}

/**
 * 只在**有变更**时出卡（对齐 ZCode 的 buildGitModel：clean 仓库也挂状态卡是
 * 它修过的 bug，提交入口在卡片 body 里，clean 时本来就没有可提交的东西）。
 * 有任何变更行（含 0 行变更的二进制/重命名文件）就保留，摘要按行数回落成文件数。
 *
 * 例外：**还没有任何提交的仓库**。这时卡片是用户唯一能看到分支名/完成首次提交的
 * 地方，按「clean 就隐藏」会把空仓库整块藏起来（用户会以为 Git 功能没接上）。
 */
export function buildGitSectionModel(snapshot: Snapshot | undefined): GitSectionModel | null {
  if (!snapshot) return null

  const changes = snapshot.changes
  if (changes.length === 0 && snapshot.log.length > 0) return null

  const added = changes.reduce((sum, change) => sum + num(change.additions), 0)
  const removed = changes.reduce((sum, change) => sum + num(change.deletions), 0)
  const dirty = new Set(changes.map((change) => change.file)).size
  return {
    added,
    removed,
    branch: snapshot.branch.branch ?? null,
    upstream: snapshot.branch.upstream ?? null,
    ahead: num(snapshot.branch.ahead),
    behind: num(snapshot.branch.behind),
    dirty,
    // 按 staged / unstaged 位分开，对齐 ZCode 的 Git Tools（已暂存与未暂存各有入口）。
    staged: changes.filter((change) => change.staged).map((change) => change.file),
    unstaged: changes.filter((change) => change.unstaged).map((change) => change.file),
    branches: snapshot.branches.map((item) => item.name),
  }
}

// 行数为 0 时改报文件数，避免摘要和 Changes 行显示成 "+0 -0" 这种空 diff。
export type GitSectionStat =
  | { kind: "diff"; added: number; removed: number; files: number }
  | { kind: "files"; added: number; removed: number; files: number }

export function gitSectionStat(model: { added: number; removed: number; dirty: number }): GitSectionStat {
  return model.added + model.removed > 0
    ? { kind: "diff", added: model.added, removed: model.removed, files: model.dirty }
    : { kind: "files", added: 0, removed: 0, files: model.dirty }
}
