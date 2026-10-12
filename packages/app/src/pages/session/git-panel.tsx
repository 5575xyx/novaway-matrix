import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { GitSnapshotResponses } from "@novaway/sdk/v2"
import { useSDK } from "@/context/sdk"

export type Snapshot = GitSnapshotResponses[200]
export type Change = Snapshot["changes"][number]

// git 状态没有服务端推送事件，只能定时轮询一次快照。
export const REFRESH_INTERVAL = 5000

// SDK 生成的数字字段带 NaN/Infinity 联合类型，展示前统一归一成整数。
export const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0)

// 后端错误可能是 Error、带 message 的对象，或纯字符串，统一取可读文本。
const messageOf = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") return err.message
  return String(err)
}

// 快照轮询与提交动作的唯一入口。侧栏 git tab 已随收敛删除，数据链路收在这里供 Status Panel 复用。
export function useGitSnapshot() {
  const sdk = useSDK()
  const [store, setStore] = createStore({
    snapshot: undefined as Snapshot | undefined,
    busy: false,
    error: "",
  })

  const snapshot = () => store.snapshot
  const busy = () => store.busy
  const error = () => store.error

  const refresh = () => {
    if (store.busy) return
    void sdk.client.git
      .snapshot()
      .then((result) => setStore({ snapshot: result.data, error: "" }))
      .catch((err: unknown) => setStore("error", messageOf(err)))
  }

  // 变更类接口执行后直接返回最新快照，省一次往返。
  const act = (run: () => Promise<{ data?: Snapshot }>) => {
    setStore("busy", true)
    return run()
      .then((result) => {
        setStore({ busy: false, snapshot: result.data ?? store.snapshot, error: "" })
      })
      .catch((err: unknown) => {
        setStore({ busy: false, error: messageOf(err) })
      })
  }

  const commit = (message: string) => act(() => sdk.client.git.commit({ message }).then((r) => r))

  refresh()
  const timer = setInterval(() => {
    if (!store.busy) refresh()
  }, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  return { snapshot, busy, error, refresh, commit }
}
