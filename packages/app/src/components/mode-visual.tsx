import type { Component } from "solid-js"
import type { AppModeConfig } from "@/context/layout"

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
