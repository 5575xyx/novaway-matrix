import { For, Show } from "solid-js"

const dots = Array.from({ length: 3 }, (_, i) => ({
  id: i,
  delay: i * 0.2,
}))

export function TypingIndicator(props: { class?: string; label?: string }) {
  return (
    <div data-component="typing-indicator" class={`flex items-center gap-2 ${props.class ?? ""}`}>
      <div class="flex items-center gap-1.5">
        <For each={dots}>
          {(dot) => (
            <span
              data-slot="typing-dot"
              class="size-2 rounded-full"
              style={{
                background: "var(--novaway-mode-color, #FF6B6B)",
                animation: "typing-pulse 1.4s ease-in-out infinite",
                "animation-delay": `${dot.delay}s`,
              }}
            />
          )}
        </For>
      </div>
      <Show when={props.label}>
        <span data-slot="typing-label" class="text-13-regular text-text-weak">
          {props.label}
        </span>
      </Show>
    </div>
  )
}
