/**
 * Commands that intentionally have no HTTP equivalent.
 *
 * Every other CLI command either drives an HTTP route (so any client can do
 * the same thing) or is a launcher/lifecycle command for the `novaway`
 * binary itself. This list is served from `/kernel` so a client can explain
 * the gap instead of failing silently.
 */
export type Entry = {
  readonly command: string
  readonly reason: string
}

export const Commands: readonly Entry[] = [
  {
    command: "github",
    reason:
      "Runs the GitHub Actions bot loop (webhooks, checkout, comment edits); it needs the CI environment, not a UI.",
  },
  {
    command: "pr",
    reason: "Opens a pull request from the local checkout using the developer's git credentials.",
  },
  {
    command: "office-ppt",
    reason: "Renders local HTML slide decks to PPTX with a headless browser channel chosen on this machine.",
  },
  {
    command: "serve",
    reason: "Starts the kernel process itself; clients connect to it over HTTP.",
  },
  {
    command: "tui",
    reason: "Launches the bundled terminal client; it is one client among many.",
  },
  {
    command: "web",
    reason: "Launches the bundled browser client; it is one client among many.",
  },
  {
    command: "acp",
    reason: "Speaks the Agent Client Protocol over stdio for editor integrations.",
  },
  {
    command: "attach",
    reason: "Attaches a terminal to a running server using the developer's local shell state.",
  },
  {
    command: "debug",
    reason: "Local diagnostics (env dump, file resolution, LSP timings) for the installed binary.",
  },
  {
    command: "upgrade",
    reason: "Replaces the installed `novaway` binary in place.",
  },
  {
    command: "uninstall",
    reason: "Removes the installed `novaway` binary and its shell integration.",
  },
]

export * as CliOnly from "./cli-only"
