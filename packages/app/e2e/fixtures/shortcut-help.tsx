// e2e 夹具：把真实的快捷键帮助浮层（src/pages/session/shortcut-help.tsx）挂到页面上。
// 浮层依赖 Command（options + keybind(id)）与 Language 两个上下文。为了拿到真实的
// 命令清单，这里跑真实 Provider 栈（Platform → Settings → Dialog → Language → Command），
// CommandProvider 初始化时注册了一批命令；再补两条带快捷键的假命令，让列表一定有内容。
//
// Playwright 通过 data-component="shortcut-help" 断言：
//   1. 从菜单入口能打开（在完整面板里是 headerMenu 的帮助组，这里直接挂 ShortcutHelp）；
//   2. 列表里每条命令都显示快捷键 chip；
//   3. 搜索能过滤，Esc 关闭。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { PlatformProvider, type Platform } from "@/context/platform"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { LanguageProvider } from "@/context/language"
import { SettingsProvider } from "@/context/settings"
import { DialogProvider } from "@novaway/ui/context/dialog"
import { CommandProvider, useCommand } from "@/context/command"
import { ShortcutHelp } from "@/pages/session/shortcut-help"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const [open, setOpen] = createSignal(false)

function Fixture() {
  const command = useCommand()
  // 补两条带快捷键的假命令，确保速查表有内容可断言。
  command.register(() => [
    { id: "fixture.hello", title: "问候", keybind: "mod+shift+h" },
    { id: "fixture.summary", title: "总结", keybind: "mod+shift+s" },
  ])
  return (
    <div class="p-4">
      <button type="button" data-action="shortcut-help-open" onClick={() => setOpen(true)}>
        打开
      </button>
      <div data-slot="state">{String(open())}</div>
      {open() && <ShortcutHelp onClose={() => setOpen(false)} />}
    </div>
  )
}

;(window as unknown as { __shortcutHelp: { open: () => boolean } }).__shortcutHelp = {
  open,
}

render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider>
        <LanguageProvider locale="zh">
          <SettingsProvider>
            <DialogProvider>
              <CommandProvider>
                <Fixture />
              </CommandProvider>
            </DialogProvider>
          </SettingsProvider>
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
