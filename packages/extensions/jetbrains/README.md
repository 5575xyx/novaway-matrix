# NovaWay for JetBrains (ACP bridge)

JetBrains IDEs do not ship an Agent Client Protocol client, so this package is a
bridge definition rather than a plugin: it tells an ACP host (or a small wrapper
you write) how to launch NovaWay and what it will answer.

`acp-bridge.json` is the machine-readable manifest. The important part:

```json
{
  "transport": { "kind": "stdio", "command": "novaway", "args": ["acp"], "cwd": "${projectBasePath}" },
  "protocol": { "name": "agent-client-protocol", "version": 1 }
}
```

## Handshake

1. Spawn `novaway acp` with the project directory as `cwd`.
2. Send `initialize` with `protocolVersion: 1` and the client capabilities you
   support. NovaWay does not require file access from the client, so announcing
   `fs.readTextFile: false` / `fs.writeTextFile: false` is enough.
3. Send `session/new` with `{ cwd, mcpServers: [] }`; the response carries the
   session id.
4. Send `session/prompt` with a text content block. Streamed output arrives as
   `session/update` notifications; `session/prompt` resolves with a stop reason.
5. Permission requests arrive as `session/request_permission`; reply with one of
   the offered option ids. If the IDE has no UI for it, reply with the "allow"
   option or reject the request — silently dropping it blocks the turn.

The VS Code extension (`sdks/vscode`) implements exactly this client in
`src/acp.ts`, so it doubles as a reference implementation.

## Manual verification

There is no automated JetBrains test: the IDE is not available in this
environment. The protocol path itself is covered by the ACP agent tests and by
the VS Code extension's typecheck/build. To verify by hand:

1. Install the NovaWay CLI so `novaway` is on `PATH`.
2. Run the steps above from any ACP client, or open a terminal in the IDE and
   run `novaway acp` to confirm it starts and waits for JSON-RPC on stdin.
3. Ask for a small change and confirm a permission prompt appears before any
   write or shell command.

## Not included

- No JetBrains plugin (Kotlin/Java) in this repository.
- No marketplace listing or automatic IDE installation.
