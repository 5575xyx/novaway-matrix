import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: args.auto ? "auto" : "normal",
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
      },
      // **没有 toggle()**:开着自动批准是一条危险动作,开之前必须过一次确认
      // (ui/auto-approve.ts 的 requestAutoApprove)。留一个 toggle() 在这儿,
      // 下一个人加第三条入口时就会顺手用它,把确认整个绕过去 —— 输入卡的开关和命令面板
      // 都是 set("auto") / set("normal") 两步走,确认写在调用方。
    }
  },
})
