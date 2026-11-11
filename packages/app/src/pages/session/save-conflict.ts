/**
 * 保存前的「磁盘外部修改」冲突检测（纯函数，可单测）。
 *
 * baseline 是打开/上次保存时读到的磁盘内容；diskNow 是保存前重新读的磁盘内容；
 * snapshot 是当前草稿。只有磁盘被外部改过（diskNow ≠ baseline）、且改出来的内容
 * 与草稿不等价（diskNow ≠ snapshot）时，才需要弹框让用户决定 —— 否则直接写盘
 * 不会丢数据。
 */
export function detectSaveConflict(baseline: string, diskNow: string | null, snapshot: string): boolean {
  if (baseline === "") return false // 基线还没读进来，不做冲突判断
  if (diskNow === null) return false // 磁盘读失败，保守放行（不阻塞保存）
  if (diskNow === baseline) return false // 磁盘没被外部改过
  if (diskNow === snapshot) return false // 磁盘已经是草稿内容，写盘幂等
  return true
}
