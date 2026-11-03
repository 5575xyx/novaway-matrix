import { DataProvider } from "@novaway/ui/context"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { LocalProvider } from "@/context/local"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { OfficeAgentProvider } from "@/pages/session/office-agent-context"
import { PulseSessionPane } from "./PulseSessionPane"

/** 标准输入框（PromptInput）要读的数据源：DataProvider 给消息组件，Local 给角色/模型。 */
function PulseChatData(props: { directory: string }) {
  const sync = useSync()
  return (
    <DataProvider data={sync.data} directory={props.directory}>
      <LocalProvider>
        {/* PromptInput 依赖的几层：草稿/文件/@ 提及/评论/办公上下文。
            和会话路由里那套（SessionProviders）保持一致，只是少了预览与终端 ——
            工作台对话用不到它们。 */}
        <FileProvider>
          <PromptProvider>
            <CommentsProvider>
              <OfficeAgentProvider>
                <PulseSessionPane directory={props.directory} />
              </OfficeAgentProvider>
            </CommentsProvider>
          </PromptProvider>
        </FileProvider>
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
 * 模型/角色时才写 —— 和主帧各自持有一份不会打架。
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

