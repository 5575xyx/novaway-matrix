import type { Component } from "solid-js"

export const FilePreviewTextGotoBar: Component<{
  inputRef: (element: HTMLInputElement) => void
  value: string
  lineCount: number
  onInput: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onClose: () => void
}> = (props) => {
  return (
    <div class="flex shrink-0 items-center gap-1 border-b border-border bg-background-weak px-3 py-1.5">
      <span class="text-11-regular text-foreground-subtlest">跳到行</span>
      <input
        ref={props.inputRef}
        type="text"
        inputmode="numeric"
        data-action="text-goto-input"
        class="h-6 w-20 rounded border border-border bg-background px-1.5 text-11-regular text-foreground outline-none focus:border-border-hover"
        value={props.value}
        placeholder={`1–${props.lineCount}`}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={props.onKeyDown}
      />
      <span class="text-11-regular text-foreground-subtlest">共 {props.lineCount} 行</span>
      <span class="ml-auto flex items-center gap-1">
        <button
          type="button"
          data-action="text-goto-close"
          class="rounded px-1.5 py-0.5 text-11-regular text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={props.onClose}
        >
          关闭
        </button>
      </span>
    </div>
  )
}
