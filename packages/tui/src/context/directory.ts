import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

/**
 * 当前实例的目录与 git 分支,分成两个字段返回。
 *
 * 不提供拼好的 `目录:分支` 字符串:底栏要把分支单独展示成一(原型是 `⑂ main`),
 * 而 Windows 上路径本身带 `:`(`E:\AImoney`),事后按分隔符拆回去是不可靠的。
 */
export function useDirectoryParts() {
  const project = useProject()
  const sync = useSync()
  const paths = useTuiPaths()
  return createMemo(() => ({
    directory: abbreviateHome(project.instance.path().directory || paths.cwd, paths.home),
    branch: sync.data.vcs?.branch,
  }))
}
