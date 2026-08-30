// 侧栏面板的自动刷新:挂载时加载一次,之后定时轮询;卸载(分区折叠/切走标签页)自动停。
// 之前每个分区顶上都挂一行"刷新"按钮,占一整行还提醒用户"这里的数据可能是旧的";
// 改成轮询之后数据自己会新,按钮就不需要了。
import { onCleanup, onMount } from "solid-js"

export const SIDEBAR_REFRESH_INTERVAL = 5000

export function useAutoRefresh(load: () => Promise<void> | void, ms = SIDEBAR_REFRESH_INTERVAL) {
  onMount(() => {
    void load()
  })
  const timer = setInterval(() => void load(), ms)
  onCleanup(() => clearInterval(timer))
}
