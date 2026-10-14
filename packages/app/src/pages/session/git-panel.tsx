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

  // 轮询每 5 秒回一份「内容相同、引用全新」的快照。照单全收会让消费方（Status Panel 的
  // sections memo）每 5 秒重算一次，进而按引用重建整块面板；面板里挂着 TanStack 查询，
  // 重建 = 查询资源重新挂起 → 外层 Suspense 每 5 秒把整个会话页闪成空白。
  // 内容没变就不写 store，让快照引用保持稳定。
  const signature = (value: Snapshot | undefined) => (value === undefined ? "" : JSON.stringify(value))

  const refresh = () => {
    if (store.busy) return
    void sdk.client.git
      .snapshot()
      .then((result) => {
        if (store.error === "" && signature(result.data) === signature(store.snapshot)) return
        setStore({ snapshot: result.data, error: "" })
      })
      .catch((err: unknown) => setStore("error", messageOf(err)))
  }

  // 变更类接口执行后直接返回最新快照，省一次往返。失败也 resolve，错误文本只落在 error 里，
  // resolve 值标记成功与否，调用方据此决定是否清空表单。
  const act = (run: () => Promise<{ data?: Snapshot }>) => {
    setStore("busy", true)
    return run()
      .then((result) => {
        setStore({ busy: false, snapshot: result.data ?? store.snapshot, error: "" })
        return true
      })
      .catch((err: unknown) => {
        setStore({ busy: false, error: messageOf(err) })
        return false
      })
  }

  const commit = (message: string) => act(() => sdk.client.git.commit({ message }).then((r) => r))
  // 以下动作全部复用后端已有的 /git/* 端点（snapshot 里已经带回 branches / ahead / stash），
  // 对齐 ZCode 的 Git Tools：提交、推送、切换/新建分支都要在面板里直接可用。
  const push = () => act(() => sdk.client.git.push().then((r) => r))
  const pull = () => act(() => sdk.client.git.pull().then((r) => r))
  const checkout = (name: string) => act(() => sdk.client.git.branch({ name }).then((r) => r))
  const createBranch = (name: string) => act(() => sdk.client.git.branch({ name, create: true }).then((r) => r))
  const stage = (files: string[]) => act(() => sdk.client.git.add({ files }).then((r) => r))
  const unstage = (files: string[]) => act(() => sdk.client.git.unstage({ files }).then((r) => r))
  const discard = (files: string[]) => act(() => sdk.client.git.discard({ files }).then((r) => r))

  refresh()
  const timer = setInterval(() => {
    if (!store.busy) refresh()
  }, REFRESH_INTERVAL)
  onCleanup(() => clearInterval(timer))

  return { snapshot, busy, error, refresh, commit, push, pull, checkout, createBranch, stage, unstage, discard }
}
