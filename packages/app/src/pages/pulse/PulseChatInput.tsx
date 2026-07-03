import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { DockShellForm } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { agentDisplayName } from "@/utils/agent"
import type { Agent, Command } from "@opencode-ai/sdk/v2"

type ModelItem = { id: string; name: string; provider: { id: string; name: string } }

export interface PulseChatInputProps {
  agents: Agent[]
  commands: Command[]
  models: ModelItem[]
  currentModel?: ModelItem
  autoMode: boolean
  onAutoModeChange: (value: boolean) => void
  onModelSelect: (item: ModelItem) => void
  onSend: (text: string) => void
  onStop?: () => void
  isWorking?: boolean
  disabled?: boolean
}

export function PulseChatInput(props: PulseChatInputProps) {
  const [text, setText] = createSignal("")
  const [showAtPopover, setShowAtPopover] = createSignal(false)
  const [showSlashPopover, setShowSlashPopover] = createSignal(false)
  const [showModelPopover, setShowModelPopover] = createSignal(false)
  const [atQuery, setAtQuery] = createSignal("")
  const [slashQuery, setSlashQuery] = createSignal("")
  const [modelSearch, setModelSearch] = createSignal("")
  const [autoWeb, setAutoWeb] = createSignal(true)
  const [permissions, setPermissions] = createSignal(true)
  const [popoverPosition, setPopoverPosition] = createSignal({ top: 0, left: 0, width: 0 })
  let textareaRef: HTMLTextAreaElement | undefined
  let containerRef: HTMLDivElement | undefined
  let modelBtnRef: HTMLButtonElement | undefined

  const agentList = createMemo(() =>
    props.agents.filter((a) => !a.hidden && (a.mode !== "primary" || a.name === "pulse-orchestrator"))
  )

  const commandList = createMemo(() =>
    props.commands.filter((c) => c.source === "skill" || c.source === "command")
  )

  const filteredAgents = createMemo(() => {
    const q = atQuery().toLowerCase()
    if (!q) return agentList()
    return agentList().filter((a) => a.name.toLowerCase().includes(q))
  })

  const filteredCommands = createMemo(() => {
    const q = slashQuery().toLowerCase()
    if (!q) return commandList()
    return commandList().filter((c) => c.name.toLowerCase().includes(q) || (c.description?.toLowerCase().includes(q)))
  })

  const filteredModels = createMemo(() => {
    const q = modelSearch().toLowerCase()
    if (!q) return props.models
    return props.models.filter((m) => m.name.toLowerCase().includes(q) || m.provider.name.toLowerCase().includes(q))
  })

  const groupedModels = createMemo(() => {
    const groups = new Map<string, ModelItem[]>()
    for (const m of filteredModels()) {
      const providerName = m.provider.name
      const arr = groups.get(providerName) ?? []
      arr.push(m)
      groups.set(providerName, arr)
    }
    return Array.from(groups.entries())
  })

  const updatePopoverPosition = () => {
    if (!containerRef) return
    const rect = containerRef.getBoundingClientRect()
    setPopoverPosition({
      top: rect.top,
      left: rect.left,
      width: rect.width,
    })
  }

  const updateModelPopoverPosition = () => {
    if (!modelBtnRef) return
    const rect = modelBtnRef.getBoundingClientRect()
    setPopoverPosition({
      top: rect.top,
      left: rect.left,
      width: rect.width,
    })
  }

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef && !containerRef.contains(target)) {
        setShowAtPopover(false)
        setShowSlashPopover(false)
      }
      if (modelBtnRef && !modelBtnRef.parentElement?.contains(target) && !(target as Element)?.closest?.("[data-model-popover]")) {
        setShowModelPopover(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside))
  })

  const handleSend = () => {
    if (props.isWorking) {
      props.onStop?.()
      return
    }
    const t = text().trim()
    if (!t || props.disabled) return
    props.onSend(t)
    setText("")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === "Escape") {
      setShowAtPopover(false)
      setShowSlashPopover(false)
      setShowModelPopover(false)
    }
  }

  const handleInput = (e: Event) => {
    const el = e.currentTarget as HTMLTextAreaElement
    const val = el.value
    setText(val)

    const cursor = el.selectionStart
    const beforeCursor = val.slice(0, cursor)

    const atIdx = beforeCursor.lastIndexOf("@")
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === " ")) {
      const query = beforeCursor.slice(atIdx + 1)
      if (!query.includes(" ")) {
        setAtQuery(query)
        updatePopoverPosition()
        setShowAtPopover(true)
        setShowSlashPopover(false)
        return
      }
    }

    const slashMatch = val.match(/^\/(\S*)$/)
    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      updatePopoverPosition()
      setShowSlashPopover(true)
      setShowAtPopover(false)
      return
    }

    setShowAtPopover(false)
    setShowSlashPopover(false)
  }

  const insertAtMention = (name: string) => {
    const el = textareaRef
    if (!el) return
    const cursor = el.selectionStart
    const before = text().slice(0, cursor)
    const after = text().slice(cursor)
    const atIdx = before.lastIndexOf("@")
    const newVal = before.slice(0, atIdx) + `@${name} ` + after
    setText(newVal)
    setShowAtPopover(false)
    el.focus()
    const newPos = atIdx + name.length + 2
    el.setSelectionRange(newPos, newPos)
  }

  const insertSlashCommand = (name: string) => {
    setText(`/${name} `)
    setShowSlashPopover(false)
    textareaRef?.focus()
  }

  const control = () => ({
    background: "var(--background-base)",
    border: "1px solid var(--border-weak-base)",
    "border-radius": "8px",
    height: "28px",
  })

  return (
    <>
      <DockShellForm
        onSubmit={(e) => { e.preventDefault(); handleSend() }}
        class="group/pulse-input"
        style={{
          "border-radius": "16px",
          background: "var(--surface-raised-stronger-non-alpha)",
          "box-shadow": "0 0 0 1px var(--border-weak-base), 0 4px 24px rgba(0, 0, 0, 0.08)",
        }}
      >
        <div class="px-2 pb-1 pt-2 flex items-center gap-2 min-w-0 border-b border-border-weak-base">
          <div class="relative">
            <Button
              ref={modelBtnRef}
              variant="ghost"
              size="normal"
              style={control()}
              class="min-w-0 max-w-[180px] text-13-medium text-text-strong gap-1.5"
              onClick={() => {
                updateModelPopoverPosition()
                setShowModelPopover(!showModelPopover())
              }}
            >
              <Show when={props.autoMode}>
                <Icon name="autopilot" class="size-4 shrink-0 text-text-interactive-base" />
              </Show>
              <Show when={!props.autoMode && props.currentModel?.provider?.id}>
                <Icon name="providers" class="size-4 shrink-0 text-text-interactive-base" />
              </Show>
              <span class="truncate">
                {props.autoMode ? "Auto" : (props.currentModel?.name ?? "选择模型")}
              </span>
              <Icon name="chevron-down" size="small" class="shrink-0" />
            </Button>
          </div>
          <div class="flex-1" />
          <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
            <span>自动联网</span>
            <button
              type="button"
              class={`size-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                autoWeb() 
                  ? "border-emerald-500 bg-emerald-500" 
                  : "border-border-weak-base bg-background-base"
              }`}
              onClick={() => setAutoWeb(!autoWeb())}
            >
              <Show when={autoWeb()}>
                <Icon name="check" size="small" class="text-white" />
              </Show>
            </button>
          </div>
          <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
            <span>权限</span>
            <button
              type="button"
              class={`size-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                permissions() 
                  ? "border-emerald-500 bg-emerald-500" 
                  : "border-border-weak-base bg-background-base"
              }`}
              onClick={() => setPermissions(!permissions())}
            >
              <Show when={permissions()}>
                <Icon name="check" size="small" class="text-white" />
              </Show>
            </button>
          </div>
        </div>

        <div ref={containerRef} class="relative">
          <textarea
            ref={textareaRef}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="给运营助手发送消息..."
            class="w-full resize-none bg-transparent px-4 py-3 text-14-regular text-text-strong placeholder:text-text-muted outline-none"
            style={{ "min-height": "44px", "max-height": "120px" }}
            disabled={props.disabled}
          />

          <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
            <Show
              when={props.isWorking}
              fallback={
                <IconButton
                  type="submit"
                  disabled={!text().trim() || props.disabled}
                  icon="paper-plane"
                  variant="primary"
                  class="size-8"
                  aria-label="发送"
                />
              }
            >
              <IconButton
                type="button"
                icon="stop"
                variant="secondary"
                class="size-8 animate-pulse"
                onClick={() => props.onStop?.()}
                aria-label="停止"
              />
            </Show>
          </div>

          <div class="pointer-events-none absolute bottom-2 left-2">
            <div class="flex items-center gap-1 pointer-events-auto">
              <Tooltip placement="top" value="提及 @">
                <Button
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  onClick={() => {
                    updatePopoverPosition()
                    setShowAtPopover(!showAtPopover())
                    setShowSlashPopover(false)
                    textareaRef?.focus()
                  }}
                  disabled={props.disabled}
                  aria-label="提及 @"
                >
                  <span class="text-sm font-semibold text-text-interactive-base">@</span>
                </Button>
              </Tooltip>
              <Tooltip placement="top" value="斜杠命令 /">
                <Button
                  type="button"
                  variant="ghost"
                  class="size-8 p-0"
                  onClick={() => {
                    updatePopoverPosition()
                    setShowSlashPopover(!showSlashPopover())
                    setShowAtPopover(false)
                    textareaRef?.focus()
                  }}
                  disabled={props.disabled}
                  aria-label="斜杠命令 /"
                >
                  <span class="text-sm font-semibold text-text-interactive-base">/</span>
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </DockShellForm>

      <Show when={showModelPopover()}>
        <div
          data-model-popover
          class="fixed z-[9999] flex flex-col rounded-md border border-border-base overflow-hidden transition-all duration-200"
          style={{
            "top": `${popoverPosition().top - 4}px`,
            "left": `${popoverPosition().left}px`,
            "width": "288px",
            "transform": "translateY(-100%)",
            "background": "var(--surface-raised-stronger-non-alpha)",
            "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.08)",
            "max-height": props.autoMode ? "112px" : "320px",
          }}
        >
          <div class="px-3 py-2 border-b border-border-weak-base">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-13-regular text-text-base">
                <Icon name="autopilot" class="size-4" />
                <span>Auto Mode</span>
              </div>
              <button
                type="button"
                class="relative inline-flex h-6 w-[44px] shrink-0 cursor-pointer rounded-full transition-all duration-200 ease-in-out border-2"
                style={{
                  "background-color": props.autoMode ? "#3b82f6" : "#525252",
                  "border-color": props.autoMode ? "#60a5fa" : "#737373",
                }}
                onClick={() => props.onAutoModeChange(!props.autoMode)}
              >
                <span
                  class="pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-all duration-200 ease-in-out"
                  style={{
                    "margin-top": "1px",
                    "transform": props.autoMode ? "translateX(22px)" : "translateX(1px)",
                    "box-shadow": "0 2px 8px rgba(0,0,0,0.3)",
                  }}
                />
              </button>
            </div>
          </div>
          <Show when={!props.autoMode}>
            <div class="px-2 py-1.5">
              <input
                type="text"
                value={modelSearch()}
                onInput={(e) => setModelSearch(e.currentTarget.value)}
                placeholder="搜索模型..."
                class="w-full px-2.5 py-1.5 text-13-regular text-text-strong bg-background-base border border-border-weak-base rounded-md outline-none focus:border-border-interactive-base"
                autofocus
              />
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-1 pb-1">
              <For each={groupedModels()}>
                {([providerName, models]) => (
                  <div class="mb-1">
                    <div class="px-2 py-1 text-11-medium text-text-weaker uppercase tracking-wider">{providerName}</div>
                    <For each={models}>
                      {(m) => (
                        <button
                          type="button"
                          class={`w-full px-2.5 py-2 text-left text-13-regular rounded-md flex items-center gap-2 hover:bg-surface-raised-base-hover ${
                            props.currentModel?.id === m.id ? "text-text-interactive-base" : "text-text-strong"
                          }`}
                          onClick={() => {
                            props.onModelSelect(m)
                            setShowModelPopover(false)
                          }}
                        >
                          <span class="truncate flex-1">{m.name}</span>
                          <Show when={props.currentModel?.id === m.id}>
                            <Icon name="check" size="small" class="shrink-0 text-text-interactive-base" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={props.autoMode}>
            <div class="flex flex-col items-center justify-center py-3 px-3 text-center">
              <Icon name="autopilot" class="size-4 mb-1 opacity-60" />
              <p class="text-11-regular text-text-secondary leading-snug">
                Auto 基于效果与速度帮助您选择最优模型
              </p>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={showAtPopover() && filteredAgents().length > 0}>
        <div
          class="fixed z-[9999] border border-border-weak-base rounded-lg shadow-lg py-1 max-h-[240px] overflow-y-auto"
          style={{
            "top": `${popoverPosition().top - 4}px`,
            "left": `${popoverPosition().left}px`,
            "width": `${popoverPosition().width}px`,
            "transform": "translateY(-100%)",
            "background": "var(--surface-raised-stronger-non-alpha)",
            "box-shadow": "0 0 0 1px var(--border-weak-base), 0 4px 24px rgba(0, 0, 0, 0.08)",
          }}
        >
          <For each={filteredAgents()}>
            {(agent) => (
              <button
                type="button"
                class="w-full px-3 py-2.5 text-left text-13-regular text-text-strong flex items-center gap-2 hover:bg-surface-raised-base-hover"
                style={{ "border-left": "2px solid transparent" }}
                onClick={() => insertAtMention(agent.name)}
              >
                <span class="text-text-interactive-base font-semibold">@</span>
                <span>{agentDisplayName(agent.name, agent.options)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={showSlashPopover() && filteredCommands().length > 0}>
        <div
          class="fixed z-[9999] border border-border-weak-base rounded-lg shadow-lg py-1 max-h-[240px] overflow-y-auto"
          style={{
            "top": `${popoverPosition().top - 4}px`,
            "left": `${popoverPosition().left}px`,
            "width": `${popoverPosition().width}px`,
            "transform": "translateY(-100%)",
            "background": "var(--surface-raised-stronger-non-alpha)",
            "box-shadow": "0 0 0 1px var(--border-weak-base), 0 4px 24px rgba(0, 0, 0, 0.08)",
          }}
        >
          <For each={filteredCommands()}>
            {(cmd) => (
              <button
                type="button"
                class="w-full px-3 py-2.5 text-left text-13-regular text-text-strong flex items-center gap-2 hover:bg-surface-raised-base-hover"
                style={{ "border-left": "2px solid transparent" }}
                onClick={() => insertSlashCommand(cmd.name)}
              >
                <span class="text-amber-500 font-semibold">/</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate">{cmd.name}</div>
                  <Show when={cmd.description}>
                    <div class="text-11-regular text-text-weaker truncate">{cmd.description}</div>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
