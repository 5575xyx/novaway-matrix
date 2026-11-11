/**
 * 拖文件到右栏即打开：把一次原生 drop 事件的 dataTransfer 收敛成
 * 路径数组。文件树拖出 `file:相对路径`（text/plain）与 `file://URL`（text/uri-list）；
 * 系统拖入的是真实 File 对象（桌面端 Electron 会注入 .path 绝对路径）。
 *
 * 抽成纯函数以便单测：drop 处理挂在 session-side-panel 上，那棵组件树依赖大量上下文
 * 无法独立挂载，纯解析逻辑单独验证即可。
 */

/** File 上 Electron 注入的绝对路径字段。 */
export type FileWithPath = File & { path?: string }

export function droppedPathsFromDataTransfer(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return []
  const paths: string[] = []

  for (const file of Array.from(dataTransfer.files)) {
    const localPath = (file as FileWithPath).path
    if (localPath) paths.push(localPath)
    else if (file.name) paths.push(file.name)
  }
  if (paths.length > 0) return uniquePaths(paths)

  // 文件树拖出会同时写 text/plain（`file:path`）与 text/uri-list（`file://`），
  // 两者是同一个文件 —— 只取 text/plain，避免同一文件开两个标签。
  const plain = dataTransfer.getData("text/plain") ?? ""
  if (plain.startsWith("file:")) {
    const path = plain.slice("file:".length)
    if (path) return [path]
  }

  const uris = dataTransfer.getData("text/uri-list") ?? ""
  for (const uri of uris.split(/\r?\n/)) {
    const trimmed = uri.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith("file://")) continue
    const value = trimmed.slice("file://".length)
    const path = value.startsWith("/") ? value : `//${value}`
    if (path) paths.push(path)
  }
  return uniquePaths(paths)
}

function uniquePaths(paths: string[]): string[] {
  return paths.filter((path, index) => path && paths.indexOf(path) === index)
}
