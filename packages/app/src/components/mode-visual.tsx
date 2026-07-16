import type { Component } from "solid-js"
import type { AppModeConfig } from "@/context/layout"

export const modeGradient = (mode: AppModeConfig) =>
  `linear-gradient(135deg, ${mode.color}, color-mix(in srgb, ${mode.color} 28%, #06111f) 58%, color-mix(in srgb, ${mode.color} 16%, #ffffff))`

export const modeGlow = (mode: AppModeConfig) =>
  `0 10px 32px color-mix(in srgb, ${mode.color} 32%, transparent), inset 0 0 0 1px color-mix(in srgb, #ffffff 32%, transparent)`

export const ModeGlyph: Component<{ mode: AppModeConfig; class?: string }> = (props) => {
  const common = {
    viewBox: "0 0 32 32",
    fill: "none",
    class: props.class ?? "size-5",
  }

  if (props.mode.id === "forge") {
    return (
      <svg {...common}>
        <path
          d="M8 21.5L21.5 8M19 5.5L26.5 13L23.5 16L16 8.5L19 5.5Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M6 24.5L10 28.5L15 23.5L11 19.5L6 24.5Z" fill="currentColor" opacity="0.22" />
        <path
          d="M5 8H10M7.5 5.5V10.5M23 22H27M25 20V24"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    )
  }

  if (props.mode.id === "zen") {
    return (
      <svg {...common}>
        <path
          d="M16 25C22 21 24 15 22 7C14 9 10 14 11 22"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M16 25C13 20 13 15 17 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        <path
          d="M6 24C11 25.5 18 25.5 26 23"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          opacity="0.7"
        />
      </svg>
    )
  }

  if (props.mode.id === "spark") {
    return (
      <svg {...common}>
        <path
          d="M16 4L18.6 12.6L27 16L18.6 19.4L16 28L13.4 19.4L5 16L13.4 12.6L16 4Z"
          fill="currentColor"
          opacity="0.2"
        />
        <path
          d="M16 4L18.6 12.6L27 16L18.6 19.4L16 28L13.4 19.4L5 16L13.4 12.6L16 4Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <path
          d="M7 7L9 9M25 7L23 9M7 25L9 23M25 25L23 23"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    )
  }

  if (props.mode.id === "pulse") {
    return (
      <svg {...common}>
        <path
          d="M4 17H9L12 9L17 24L21 13L23 17H28"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M7 23C11 27 21 27 25 23"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          opacity="0.55"
        />
        <path d="M7 9C11 5 21 5 25 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.55" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="M16 4L24 28L16 24L8 28L16 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M16 4L18.5 21.5L16 24L13.5 21.5L16 4Z" fill="currentColor" opacity="0.22" />
      <path
        d="M11 28L8 30M21 28L24 30M16 24V30"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        opacity="0.65"
      />
    </svg>
  )
}

export const ModeBadge: Component<{ mode: AppModeConfig; compact?: boolean; soft?: boolean }> = (props) => (
  <span
    class="relative grid place-items-center overflow-hidden text-white"
    classList={{
      "size-10 rounded-[14px]": !props.compact,
      "size-8 rounded-[11px]": props.compact,
      "shadow-[0_10px_32px_rgba(0,0,0,0.22)]": !props.soft,
    }}
    style={{ background: modeGradient(props.mode), "box-shadow": props.soft ? undefined : modeGlow(props.mode) }}
  >
    <span class="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.45),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]" />
    <ModeGlyph mode={props.mode} class={props.compact ? "relative size-4.5" : "relative size-5.5"} />
  </span>
)
