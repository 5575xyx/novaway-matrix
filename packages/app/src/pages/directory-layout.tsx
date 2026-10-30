import { DataProvider } from "@novaway/ui/context"
import { showToast } from "@novaway/ui/toast"
import { base64Encode } from "@novaway/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { DevServerProvider } from "@/context/dev-server"
import { PreviewProvider } from "@/context/preview"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { sidePaneSubagentTabId } from "@/context/layout"
import { decode64 } from "@/utils/base64"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const layout = useLayout()
  const language = useLanguage()
  const slug = createMemo(() => base64Encode(props.directory))

  /**
   * 子代理摘要行点击 → 在**右侧面板**打开子会话，而不是整页跳走。
   *
   * 对齐 ZCode 的 `openSubagentSessionFromSummary`：整页跳会把主线从眼前挪走，
   * 用户看完子会话还得再找回来。面板里看则"主线继续跑、支线随时看"。
   *
   * 面板顶部留了「在主线打开」，需要完整能力（fork / retry / 编辑）时再跳过去。
   */
  const openSubagentSession = (sessionID: string) => {
    const parentID = params.id ?? ""
    // 标题优先用会话自己的；子会话常常还没进 `sync.data.session`（那份列表只装根会话），
    // 这时先给一个中性标签 —— 面板顶部还有子代理图标，不会认错。
    const title = sync.data.session.find((item) => item.id === sessionID)?.title ?? language.t("sidePane.subagent")
    layout.sidePane.openSession({
      id: sidePaneSubagentTabId(sessionID),
      kind: "subagent",
      sessionID,
      parentID,
      title,
    })
  }

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createResource(
    () => params.id,
    (id) => sync.session.sync(id),
  )

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      // 工具行里的子代理摘要走面板；其它"跳到某个会话"的调用点（面包屑、搜索结果）
      // 仍然是路由跳转 —— 它们本来就是"我要离开当前上下文"的语义。
      onNavigateToSession={openSubagentSession}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <PreviewProvider directory={() => resolved}>
              <DevServerProvider>
                <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
              </DevServerProvider>
            </PreviewProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
