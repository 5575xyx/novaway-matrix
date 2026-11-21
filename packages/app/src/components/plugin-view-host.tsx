import { Show, createEffect, onCleanup, type JSX } from "solid-js"

export type PluginViewRender = { type: "builtin"; component: string } | { type: "iframe"; url: string }

export type PluginViewMessage = {
  type: "novaway.plugin.action"
  pluginID: string
  command: string
  payload?: unknown
}

function cloneBridgeData(value: unknown) {
  if (value === undefined) return undefined
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return undefined
    }
  }
}

function safeWebUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * The only third-party UI boundary in the web app. Builtin components are
 * resolved by the host; external components are always sandboxed iframes.
 * The bridge is deliberately one-way for data and only accepts an explicitly
 * scoped command action from the owning plugin.
 */
export function PluginViewHost(props: {
  pluginID: string
  viewID?: string
  render?: PluginViewRender
  data?: unknown
  onAction?: (message: PluginViewMessage) => void
  fallback?: JSX.Element
}) {
  let frame: HTMLIFrameElement | undefined
  const url = () => (props.render?.type === "iframe" ? safeWebUrl(props.render.url) : undefined)

  const send = () => {
    if (!frame?.contentWindow || !url()) return
    frame.contentWindow.postMessage(
      {
        type: "novaway.plugin.init",
        pluginID: props.pluginID,
        viewID: props.viewID,
        data: cloneBridgeData(props.data),
      },
      "*",
    )
  }

  const receive = (event: MessageEvent) => {
    if (event.source !== frame?.contentWindow || !event.data || typeof event.data !== "object") return
    const message = event.data as Partial<PluginViewMessage>
    if (message.type !== "novaway.plugin.action" || message.pluginID !== props.pluginID) return
    if (typeof message.command !== "string" || message.command.length === 0) return
    props.onAction?.(message as PluginViewMessage)
  }

  createEffect(() => {
    props.data
    send()
  })
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))

  return (
    <Show
      when={props.render?.type === "iframe" && url()}
      fallback={
        props.render?.type === "builtin" ? (
          <div data-component="plugin-view-builtin" data-component-id={props.render.component} class="size-full">
            {props.fallback ?? <div class="p-6 text-14-regular text-foreground-subtle">插件内置视图</div>}
          </div>
        ) : (
          (props.fallback ?? <div class="p-6 text-14-regular text-foreground-subtle">插件视图不可用</div>)
        )
      }
    >
      {(src) => (
        <iframe
          ref={frame}
          src={src()}
          title={props.viewID ?? `${props.pluginID} plugin view`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          class="size-full border-0 bg-background"
          onLoad={send}
        />
      )}
    </Show>
  )
}
