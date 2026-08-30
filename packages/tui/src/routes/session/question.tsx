import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type { QuestionAnswer, QuestionRequest } from "@novaway/sdk-v2-latest/v2"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useTuiConfig } from "../../config"
import { useBindings, useNovaWayModeStack } from "../../keymap"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"

const QUESTION_MODE = "question"

// 标签页里的问题标题上限。header 是模型给的,没有任何长度或换行保证,
// 而它躺在一个横排的标签条里 —— 一个 \n 就能把整条标签行撑成多行。
const HEADER_MAX = 24

// 选项行的结构是"固定宽度的序号列 + 标签列"横排,标签多一行、序号列就少一行,
// 序号和标签立刻错位。描述同理。两者都来自模型,都必须先压平。
const OPTION_LABEL_MAX = 200
const OPTION_DESCRIPTION_MAX = 300
// 问题正文允许折行(它本来就是一段话),但不允许无限长。
const QUESTION_MAX = 600

export function QuestionPrompt(props: { request: QuestionRequest; directory?: string }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const tuiConfig = useTuiConfig()
  const modeStack = useNovaWayModeStack()
  const toast = useToast()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1)) // questions + confirm tab (no confirm for single select)
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const custom = createMemo(() => question()?.custom !== false)
  const other = createMemo(() => custom() && store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  // 回答/拒绝都是发出去就不管的。原来连 .catch 都没有:一旦请求失败,
  // 卡片不会消失、模式栈上的 "question" 也不会弹出,于是所有 mode 为基础模式的键位
  // (包括切侧栏的 <leader>b)集体失效,界面看起来就"卡住不动、什么都按不动"了。
  // 现在至少把失败摆到台面上,用户知道要重试或按 esc。
  function report(error: unknown) {
    toast.error(error)
  }

  function submit() {
    const answers = questions().map((_, i) => store.answers[i] ?? [])
    sdk.client.question
      .reply({
        requestID: props.request.id,
        directory: props.directory,
        answers,
      })
      .catch(report)
  }

  function reject() {
    sdk.client.question
      .reject({
        requestID: props.request.id,
        directory: props.directory,
      })
      .catch(report)
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      sdk.client.question
        .reply({
          requestID: props.request.id,
          directory: props.directory,
          answers: [[answer]],
        })
        .catch(report)
      return
    }
    setStore("tab", store.tab + 1)
    setStore("selected", 0)
  }

  function toggle(answer: string) {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", 0)
  }

  function selectOption() {
    if (other()) {
      if (!multi()) {
        setStore("editing", true)
        return
      }
      const value = input()
      if (value && customPicked()) {
        toggle(value)
        return
      }
      setStore("editing", true)
      return
    }
    const opt = options()[store.selected]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  onMount(() => {
    const popMode = modeStack.push(QUESTION_MODE)
    onCleanup(popMode)
  })

  // 挂载这个组件的 <Show> 条件只是个布尔值(questions().length > 0),所以连续两个提问
  // 之间组件**不会重建**,只是换了 props.request。store 里上一题的 tab/answers/selected
  // 会原样带到下一题:tab 一旦越界,question() 就是 undefined,选项列表为空,
  // 画出来是一张空卡片 —— 看不出原因,而 "question" 模式还压在栈上,键位也就全哑了。
  // 这正好对应"连着回答两个 question 之后界面就不对了"。
  createEffect(
    on(
      () => props.request.id,
      () => setStore({ tab: 0, answers: [], custom: [], selected: 0, editing: false }),
      { defer: true },
    ),
  )

  useBindings(() => ({
    mode: QUESTION_MODE,
    enabled: store.editing && !confirm(),
    commands: [
      {
        name: "prompt.clear",
        title: "清除回答编辑",
        category: "提问",
        run() {
          const text = textarea?.plainText ?? ""
          if (!text) {
            setStore("editing", false)
            return
          }
          textarea?.setText("")
        },
      },
    ],
    bindings: [
      {
        key: "escape",
        desc: "取消编辑回答",
        group: "提问",
        cmd: () => {
          setStore("editing", false)
        },
      },
      ...tuiConfig.keybinds.get("prompt.clear"),
      {
        key: "return",
        desc: "提交编辑的回答",
        group: "提问",
        cmd: () => {
          const text = textarea?.plainText?.trim() ?? ""
          const prev = store.custom[store.tab]

          if (!text) {
            if (prev) {
              const inputs = [...store.custom]
              inputs[store.tab] = ""
              setStore("custom", inputs)

              const answers = [...store.answers]
              answers[store.tab] = (answers[store.tab] ?? []).filter((x) => x !== prev)
              setStore("answers", answers)
            }
            setStore("editing", false)
            return
          }

          if (multi()) {
            const inputs = [...store.custom]
            inputs[store.tab] = text
            setStore("custom", inputs)

            const existing = store.answers[store.tab] ?? []
            const next = [...existing]
            if (prev) {
              const index = next.indexOf(prev)
              if (index !== -1) next.splice(index, 1)
            }
            if (!next.includes(text)) next.push(text)
            const answers = [...store.answers]
            answers[store.tab] = next
            setStore("answers", answers)
            setStore("editing", false)
            return
          }

          pick(text, true)
          setStore("editing", false)
        },
      },
    ],
  }))

  useBindings(() => {
    const opts = options()
    const total = opts.length + (custom() ? 1 : 0)
    const max = Math.min(total, 9)

    return {
      mode: QUESTION_MODE,
      enabled: !store.editing,
      commands: [
        {
          name: "app.exit",
          title: "拒绝提问",
          category: "提问",
          run() {
            reject()
          },
        },
      ],
      bindings: [
        {
          key: "left",
          desc: "上一个问题",
          group: "提问",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        {
          key: "h",
          desc: "上一个问题",
          group: "提问",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        { key: "right", desc: "下一个问题", group: "提问", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "l", desc: "下一个问题", group: "提问", cmd: () => selectTab((store.tab + 1) % tabs()) },
        {
          key: "tab",
          desc: "下一个问题",
          group: "提问",
          cmd: ({ event }: { event: { shift: boolean } }) => {
            selectTab((store.tab + (event.shift ? -1 : 1) + tabs()) % tabs())
          },
        },
        ...(confirm()
          ? [
              { key: "return", desc: "提交回答", group: "提问", cmd: () => submit() },
              { key: "escape", desc: "拒绝提问", group: "提问", cmd: () => reject() },
              ...tuiConfig.keybinds.get("app.exit"),
            ]
          : [
              ...Array.from({ length: max }, (_, index) => ({
                key: String(index + 1),
                desc: `选择第 ${index + 1} 项`,
                group: "提问",
                cmd: () => {
                  moveTo(index)
                  selectOption()
                },
              })),
              {
                key: "up",
                desc: "上一个选项",
                group: "提问",
                cmd: () => moveTo((store.selected - 1 + total) % total),
              },
              {
                key: "k",
                desc: "上一个选项",
                group: "提问",
                cmd: () => moveTo((store.selected - 1 + total) % total),
              },
              { key: "down", desc: "下一个选项", group: "提问", cmd: () => moveTo((store.selected + 1) % total) },
              { key: "j", desc: "下一个选项", group: "提问", cmd: () => moveTo((store.selected + 1) % total) },
              { key: "return", desc: "选中该项", group: "提问", cmd: () => selectOption() },
              { key: "escape", desc: "拒绝提问", group: "提问", cmd: () => reject() },
              ...tuiConfig.keybinds.get("app.exit"),
            ]),
      ],
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>
              {(q, index) => {
                const isActive = () => index() === store.tab
                const isAnswered = () => {
                  return (store.answers[index()]?.length ?? 0) > 0
                }
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      isActive()
                        ? theme.accent
                        : tabHover() === index()
                          ? theme.backgroundElement
                          : theme.backgroundPanel
                    }
                    onMouseOver={() => setTabHover(index())}
                    onMouseOut={() => setTabHover(null)}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      selectTab(index())
                    }}
                  >
                    <text
                      wrapMode="none"
                      fg={
                        isActive()
                          ? selectedForeground(theme, theme.accent)
                          : isAnswered()
                            ? theme.text
                            : theme.textMuted
                      }
                    >
                      {Locale.oneLine(q.header, HEADER_MAX)}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                confirm() ? theme.accent : tabHover() === "confirm" ? theme.backgroundElement : theme.backgroundPanel
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                selectTab(questions().length)
              }}
            >
              <text fg={confirm() ? selectedForeground(theme, theme.accent) : theme.textMuted}>确认</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm()}>
          <box paddingLeft={1} gap={1}>
            <box>
              <text fg={theme.text}>
                {Locale.truncate(question()?.question ?? "", QUESTION_MAX)}
                {multi() ? "（可多选）" : ""}
              </text>
            </box>
            <box>
              <For each={options()}>
                {(opt, i) => {
                  const active = () => i() === store.selected
                  const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                  return (
                    <box
                      onMouseOver={() => moveTo(i())}
                      onMouseDown={() => moveTo(i())}
                      onMouseUp={() => {
                        if (renderer.getSelection()?.getSelectedText()) return
                        selectOption()
                      }}
                    >
                      <box flexDirection="row">
                        <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                          <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                            {`${i() + 1}.`}
                          </text>
                        </box>
                        <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                          <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                            {multi()
                              ? `[${picked() ? "✓" : " "}] ${Locale.oneLine(opt.label, OPTION_LABEL_MAX)}`
                              : Locale.oneLine(opt.label, OPTION_LABEL_MAX)}
                          </text>
                        </box>
                        <Show when={!multi()}>
                          <text fg={theme.success}>{picked() ? " ✓" : ""}</text>
                        </Show>
                      </box>

                      <box paddingLeft={3}>
                        <text fg={theme.textMuted}>{Locale.oneLine(opt.description ?? "", OPTION_DESCRIPTION_MAX)}</text>
                      </box>
                    </box>
                  )
                }}
              </For>
              <Show when={custom()}>
                <box
                  onMouseOver={() => moveTo(options().length)}
                  onMouseDown={() => moveTo(options().length)}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    selectOption()
                  }}
                >
                  <box flexDirection="row">
                    <box backgroundColor={other() ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={other() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                        {`${options().length + 1}.`}
                      </text>
                    </box>
                    <box backgroundColor={other() ? theme.backgroundElement : undefined}>
                      <text fg={other() ? theme.secondary : customPicked() ? theme.success : theme.text}>
                        {multi() ? `[${customPicked() ? "✓" : " "}] 自己输入答案` : "自己输入答案"}
                      </text>
                    </box>

                    <Show when={!multi()}>
                      <text fg={theme.success}>{customPicked() ? " ✓" : ""}</text>
                    </Show>
                  </box>
                  <Show when={store.editing}>
                    <box paddingLeft={3}>
                      <textarea
                        ref={(val: TextareaRenderable) => {
                          textarea = val
                          val.traits = { status: "ANSWER" }
                          queueMicrotask(() => {
                            val.focus()
                            val.gotoLineEnd()
                          })
                        }}
                        initialValue={input()}
                        placeholder="自己输入答案"
                        placeholderColor={theme.textMuted}
                        minHeight={1}
                        maxHeight={6}
                        textColor={theme.text}
                        focusedTextColor={theme.text}
                        cursorColor={theme.primary}
                        cursorStyle={tuiConfig.cursor}
                      />
                    </box>
                  </Show>
                  <Show when={!store.editing && input()}>
                    <box paddingLeft={3}>
                      <text fg={theme.textMuted}>{input()}</text>
                    </box>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </Show>

        <Show when={confirm() && !single()}>
          <box paddingLeft={1}>
            <text fg={theme.text}>回顾</text>
          </box>
          <For each={questions()}>
            {(q, index) => {
              const value = () => store.answers[index()]?.join(", ") ?? ""
              const answered = () => Boolean(value())
              return (
                <box paddingLeft={1}>
                  <text>
                    <span style={{ fg: theme.textMuted }}>{Locale.oneLine(q.header, HEADER_MAX)}:</span>{" "}
                    <span style={{ fg: answered() ? theme.text : theme.error }}>
                      {answered() ? Locale.oneLine(value(), OPTION_LABEL_MAX) : "（未回答）"}
                    </span>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <Show when={!single()}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>选择</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter{" "}
            <span style={{ fg: theme.textMuted }}>
              {confirm() ? "提交" : multi() ? "勾选" : single() ? "提交" : "确认"}
            </span>
          </text>

          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>忽略</span>
          </text>
        </box>
      </box>
    </box>
  )
}
