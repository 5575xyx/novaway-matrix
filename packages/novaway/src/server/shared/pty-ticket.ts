export const PTY_CONNECT_TICKET_QUERY = "ticket"
export const PTY_CONNECT_TOKEN_HEADER = "x-novaway-ticket"
export const PTY_CONNECT_TOKEN_HEADER_VALUE = "1"

// HTTP header names are case-insensitive, and both `fetch` and the HTTP server
// lowercase them on the wire. Comparing the camel-case spelling directly never
// matches what the server receives, so every ticket mint 403s and the terminal
// is stranded on a blank screen. Accept any casing, plus the pre-rename legacy
// name, mirroring the directory-header fallbacks in workspace routing.
const PTY_CONNECT_TOKEN_HEADERS = new Set([PTY_CONNECT_TOKEN_HEADER, "x-opencode-ticket"])

export function hasPtyConnectToken(headers: Readonly<Record<string, string | undefined>>) {
  return Object.entries(headers).some(
    ([name, value]) => PTY_CONNECT_TOKEN_HEADERS.has(name.toLowerCase()) && value === PTY_CONNECT_TOKEN_HEADER_VALUE,
  )
}

const PTY_CONNECT_PATH = /^\/pty\/[^/]+\/connect$/

// Auth middleware skips Basic Auth when this matches; the PTY connect handler
// is then responsible for validating the ticket.
export function isPtyConnectPath(pathname: string) {
  return PTY_CONNECT_PATH.test(pathname)
}

export function hasPtyConnectTicketURL(url: URL) {
  return isPtyConnectPath(url.pathname) && !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
}
