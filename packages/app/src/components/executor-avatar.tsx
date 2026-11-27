import { type Component } from "solid-js"
import type { JSX } from "solid-js"
import { TeamAvatar } from "@/components/team-avatar"
import { agentAvatar } from "@/utils/agent-avatar"

/**
 * All executor sources share one visual identity rule:
 * legacy teams and reusable profiles use the stable team avatar; a direct employee
 * uses the employee/agent avatar. Keeping this at one boundary prevents the chat,
 * directory and management pages from drifting into three different avatar systems.
 */
export const ExecutorAvatar: Component<{
  kind: "team" | "expert"
  name: string
  avatarUrl?: string
  class?: string
  alt?: string
  title?: string
  style?: JSX.CSSProperties
}> = (props) =>
  props.avatarUrl ? (
    <img
      src={props.avatarUrl}
      alt={props.alt ?? ""}
      title={props.title}
      class={`object-cover ${props.class ?? ""}`}
      style={props.style}
      draggable={false}
    />
  ) : props.kind === "team" ? (
    <TeamAvatar name={props.name} class={props.class} />
  ) : (
    <img
      src={agentAvatar(props.name)}
      alt={props.alt ?? ""}
      title={props.title}
      class={`object-cover ${props.class ?? ""}`}
      style={props.style}
      draggable={false}
    />
  )
