import { DataProvider } from "@novaway/ui/context"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { PulseChat } from "./PulseChat"

/** 标准消息组件（Message / AssistantParts）读的是 DataProvider，这里按目录补上。 */
function PulseChatData(props: { directory: string }) {
  const sync = useSync()
  return (
    <DataProvider data={sync.data} directory={props.directory}>
      <LocalProvider>
        <PulseChat directory={props.directory} />
      </LocalProvider>
    </DataProvider>
  )
}

/**
 * 给运营工作台的对话区补上目录级上下文。
 *
 * 工作台是**主帧里的整帧面板**，挂在 `pages/layout.tsx`（在 `DirectoryLayout`
 * 之外）——那一层只有全局 provider，没有 SDK / Sync / Local / Data。对话要发消息
 * 就必须拿到「当前目录的客户端 + 会话数据 + 当前模型 + 消息组件的数据源」，
 * 所以在这里就地补这几层。
 *
 * 这几层都是按目录取的轻量包装：`SyncProvider` 用的 `globalSync.child(directory)`
 * 本来就是按目录共享的 store（见 global-sync），`local` 的持久化只在用户显式换
 * 模型/角色时才写，而工作台对话不提供那两个入口 —— 和主帧各自持有一份不会打架。
 */
export function PulseChatHost(props: { directory: string }) {
  return (
    <SDKProvider directory={() => props.directory}>
      <SyncProvider>
        <PulseChatData directory={props.directory} />
      </SyncProvider>
    </SDKProvider>
  )
}

