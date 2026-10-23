/**
 * Git 图谱的行/泳道布局。
 *
 * 输入是 `git log` 顺序的提交（新 → 旧），每条带短哈希与父哈希；
 * 输出每一行的节点所在列，以及「进入这一行 / 离开这一行」的连线。
 *
 * 算法是常见的 lane 追踪：
 * - 每列记录"这一列期待出现的提交哈希"；
 * - 当前提交落在它所在的那一列（没有就新开一列）；
 * - 它的第一个父提交继承这一列，其余父提交（合并）另开新列；
 * - 没有父提交（根提交）时这一列被释放。
 *
 * 只做"能看出分叉和合并"的程度，不追求 `git log --graph` 的逐像素复刻。
 */
export type GraphCommit = {
  hash: string
  subject: string
  author: string
  date: string
  parents?: string[]
  refs?: string[]
}

export type GraphEdge = {
  /** 起点列 */
  from: number
  /** 终点列 */
  to: number
  color: number
}

export type GraphRow = GraphCommit & {
  row: number
  rowCount: number
  /** 节点所在列 */
  lane: number
  color: number
  /** 这一行顶部是否有从上一行延续下来的线（新开的分支为 false） */
  fromTop: boolean
  /** 这一行需要画几条泳道（列数） */
  laneCount: number
  /** 节点连向父提交的边（画在节点下方） */
  down: GraphEdge[]
  /** 其它列在这一行里的直连线（与节点无关） */
  through: Array<{ lane: number; color: number }>
}

const COLORS = 6

type Lane = { hash: string; color: number } | undefined

export function buildGitGraph(commits: readonly GraphCommit[]): GraphRow[] {
  const lanes: Lane[] = []
  const rows: GraphRow[] = []

  const allocate = () => {
    const free = lanes.findIndex((item) => item === undefined)
    if (free !== -1) return free
    lanes.push(undefined)
    return lanes.length - 1
  }

  commits.forEach((commit, row) => {
    let lane = lanes.findIndex((item) => item?.hash === commit.hash)
    let color: number
    const fromTop = lane !== -1
    if (lane === -1) {
      lane = allocate()
      color = lane % COLORS
      lanes[lane] = { hash: commit.hash, color }
    } else {
      color = lanes[lane]!.color
    }

    // 其余列：与当前提交无关、但在这一行仍然要画出来的竖线。
    const through = lanes.flatMap((item, index) => (item && index !== lane ? [{ lane: index, color: item.color }] : []))

    const parents = (commit.parents ?? []).filter(Boolean)
    // 先释放当前列，再按父提交重新占用（第一父提交留在原列）。
    lanes[lane] = undefined
    const down: GraphEdge[] = []
    if (parents.length > 0) {
      const first = parents[0]
      const existing = lanes.findIndex((item) => item?.hash === first)
      const target = existing === -1 ? lane : existing
      if (existing === -1) {
        lanes[target] = { hash: first, color }
      }
      down.push({ from: lane, to: target, color: lanes[target]!.color })
      for (const parent of parents.slice(1)) {
        const merged = lanes.findIndex((item) => item?.hash === parent)
        if (merged !== -1) {
          down.push({ from: lane, to: merged, color: lanes[merged]!.color })
          continue
        }
        const next = allocate()
        const nextColor = next % COLORS
        lanes[next] = { hash: parent, color: nextColor }
        down.push({ from: lane, to: next, color: nextColor })
      }
    }

    // 本行需要画到的最右列：节点列、其它延续列、父提交落点列。
    const laneCount = Math.max(lane, ...through.map((item) => item.lane), ...down.map((item) => item.to)) + 1

    rows.push({
      ...commit,
      row,
      rowCount: commits.length,
      lane,
      color,
      fromTop,
      laneCount,
      down,
      through,
    })
  })

  return rows
}

/** 引用标签拆成三类，方便 UI 用不同颜色区分。 */
export function classifyRef(ref: string): { kind: "head" | "tag" | "remote" | "local"; label: string } {
  if (ref.startsWith("HEAD")) return { kind: "head", label: ref }
  if (ref.startsWith("tag: ")) return { kind: "tag", label: ref.slice(5) }
  if (ref.includes("/")) return { kind: "remote", label: ref }
  return { kind: "local", label: ref }
}
