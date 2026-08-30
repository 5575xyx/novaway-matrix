import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "./border"
import { TextAttributes } from "@opentui/core"
import { Locale } from "../util/locale"
export type ToastOptions = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration: number
}
type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

// toast 是 position="absolute" 的浮层:它有多高就盖住多少界面。
// 而 message 的来源是 err.message —— provider 返回的错误体经常是整段多行 JSON。
// 不设上限的话一次报错就能糊满整屏,看起来就是界面坏了。所以内容和高度都要钉上限。
const TITLE_MAX = 60
const MESSAGE_MAX = 300
const HEIGHT_MAX = 14

export function Toast() {
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="flex-start"
          top={2}
          right={2}
          maxWidth={Math.min(60, dimensions().width - 6)}
          maxHeight={Math.min(HEIGHT_MAX, Math.max(3, dimensions().height - 4))}
          overflow="hidden"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme[current().variant]}
          border={["left", "right"]}
          customBorderChars={SplitBorder.customBorderChars}
        >
          <Show when={current().title}>
            <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
              {Locale.oneLine(current().title!, TITLE_MAX)}
            </text>
          </Show>
          <text fg={theme.text} wrapMode="word" width="100%">
            {Locale.oneLine(current().message, MESSAGE_MAX)}
          </text>
        </box>
      )}
    </Show>
  )
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  const toast = {
    show(options: ToastInput) {
      const toastOptions = { ...options, duration: options.duration ?? 5000 }
      setStore("currentToast", toastOptions)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, toastOptions.duration).unref()
    },
    error: (err: any) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      toast.show({
        variant: "error",
        message: "发生未知错误",
      })
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast
    },
  }
  return toast
}

export type ToastContext = ReturnType<typeof init>

const ctx = createContext<ToastContext>()

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
