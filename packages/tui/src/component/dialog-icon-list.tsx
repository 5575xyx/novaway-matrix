import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useKV } from "../context/kv"
import { onCleanup } from "solid-js"
import { ICON_STYLES, currentIconStyle, setIconStyle, type IconStyle } from "../util/panel-icons"

const LABELS: Record<IconStyle, string> = {
  emoji: "Emoji — 彩色图标,任何终端都能显示(默认)",
  nerdfont: "Nerd Font — 单色矢量字形,更锐利(需装 Nerd Font 终端字体)",
  ascii: "ASCII — 纯文本符号,零字体依赖",
}

// /icon 弹出的图标风格选择器:上下移动即时预览(整个侧栏/面板随之重绘),回车确认并持久化到 kv。
export function DialogIconList() {
  const dialog = useDialog()
  const kv = useKV()
  const initial = currentIconStyle()
  let confirmed = false

  const options = ICON_STYLES.map((value) => ({ title: LABELS[value], value }))

  onCleanup(() => {
    // 未确认(如 Esc 关闭)则恢复进入前的风格。
    if (!confirmed) setIconStyle(initial)
  })

  return (
    <DialogSelect
      title="图标风格"
      options={options}
      current={initial}
      onMove={(opt) => {
        setIconStyle(opt.value)
      }}
      onSelect={(opt) => {
        setIconStyle(opt.value)
        kv.set("icons", opt.value)
        confirmed = true
        dialog.clear()
      }}
    />
  )
}
