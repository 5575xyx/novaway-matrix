// 行内输入:在左列底部展开一行,enter 确认 / esc 取消。
// 提交信息、新建分支、添加远程三处共用,差别只在标题、占位符和回调。
//
// 不用弹窗组件:弹窗会打断键盘流,而这套交互的核心就是单手走完全程(见 confirm.ts 头注释)。
//
// 键位**只走 keymap 层,不用 textarea 的 onSubmit**。onSubmit 的事件类型是空接口
// (SubmitEvent),拿不到文本,只能靠 ref 反查;而且它是否触发依赖 keymap 的输入绑定
// 配置(input_submit / input_newline),不确定性太多。keymap 层是确定性的。
//
// 键名写 `enter` / `esc` 而不是 opentui 的 `return` / `escape`:keymap 层注册了别名展开
// (见 keymap.tsx 的 KEY_ALIASES),两者都指向同一个键位,这里统一用 keymap 的词汇。
import { TextareaRenderable } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { useTheme } from "../../context/theme"
import { useBindings } from "../../keymap"
import { Locale } from "../../util/locale"

export interface InlineInputProps {
  /** 行首的标签,例如「提交信息」。 */
  title: string
  placeholder?: string
  initialValue?: string
  /** 面板内容可用宽度(已扣左右各 1 列边框)。 */
  width: number
  /** 内容为空时不触发(空提交信息、空分支名、空远端地址都没有意义)。 */
  onConfirm: (value: string) => void
  onCancel: () => void
}

// 「提交信息」「新建分支」「添加远程」都是 4 个汉字 = 8 列,取这个数刚好不截断。
const TITLE_WIDTH = 8

export function InlineInput(props: InlineInputProps) {
  const { theme } = useTheme()
  // 信号存的是 renderable 本身,给 useBindings 的 target 当**响应式匹配器**用。
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable

  const submit = () => {
    // 去空格再判空:纯空格提交会被 git 当成合法参数(带一个空标题),行为难解释。
    const value = textarea.plainText.trim()
    if (value.length === 0) return
    props.onConfirm(value)
  }

  useBindings(() => ({
    // target 必须是**函数**(UseBindingsTarget = () => Renderable),传 signal 本身而不是 target()。
    // 传值的话绑定拿到的是一个静态引用,textarea 挂载后不会重算,enter 永远命中不了。
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    // priority 1 保证这一层赢过全局托管输入层,否则 enter 会被当成换行吃下去。
    priority: 1,
    bindings: [
      { key: "enter", desc: "确认", group: "行内输入", cmd: submit },
      { key: "esc", desc: "取消", group: "行内输入", cmd: props.onCancel },
    ],
  }))

  onMount(() => {
    // 隔一帧再 focus:renderable 挂到 renderer 之前调 focus 会丢焦点,用户只能看到空占位符。
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
    // 有 initialValue 时光标停在行尾才符合直觉。
    textarea.gotoLineEnd()
  })

  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1} gap={1} paddingTop={1}>
      <text fg={theme.primary} wrapMode="none">
        {Locale.truncateToWidth(props.title, TITLE_WIDTH)}：
      </text>
      <textarea
        height={1}
        wrapMode="none"
        width={Math.max(8, props.width - 1 - TITLE_WIDTH - 2)}
        initialValue={props.initialValue}
        placeholder={props.placeholder}
        placeholderColor={theme.textMuted}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.primary}
        ref={(val: TextareaRenderable) => {
          textarea = val
          setTextareaTarget(val)
        }}
      />
    </box>
  )
}
