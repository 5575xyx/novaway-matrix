// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import { AcpClient, type PermissionOption } from "./acp"

const TERMINAL_NAME = "novaway"

export function activate(context: vscode.ExtensionContext) {
  const openNewTerminalDisposable = vscode.commands.registerCommand("novaway.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("novaway.openTerminal", async () => {
    // An novaway terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("novaway.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_novaway_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  const acpOutput = vscode.window.createOutputChannel("NovaWay ACP")
  let acp: AcpClient | undefined

  const openAcpDisposable = vscode.commands.registerCommand("novaway.openAcpSession", async () => {
    const text = await vscode.window.showInputBox({ prompt: "Ask NovaWay through ACP" })
    if (!text) return

    acpOutput.show(true)
    acpOutput.appendLine(`> ${text}`)
    if (!acp) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!cwd) {
        vscode.window.showErrorMessage("NovaWay ACP needs an open workspace folder")
        return
      }
      const command = vscode.workspace.getConfiguration("novaway").get<string>("executable") ?? "novaway"
      const client = new AcpClient({
        command,
        cwd,
        onText: (chunk) => acpOutput.append(chunk),
        onTool: (title) => acpOutput.appendLine(`[tool] ${title}`),
        onLog: (line) => acpOutput.appendLine(line),
        onPermission: async ({ title, options }) => {
          const allow = options.find((option: PermissionOption) => (option.kind ?? "").startsWith("allow"))
          const deny = options.find((option: PermissionOption) => (option.kind ?? "").startsWith("reject"))
          const picked = await vscode.window.showInformationMessage(`NovaWay wants to run: ${title}`, "Allow", "Deny")
          if (picked === "Allow") return allow?.optionId
          return deny?.optionId
        },
      })
      try {
        await client.start()
        acp = client
      } catch (error) {
        acpOutput.appendLine(`failed to start ACP: ${error instanceof Error ? error.message : String(error)}`)
        vscode.window.showErrorMessage("Failed to start NovaWay ACP")
        return
      }
    }

    try {
      const stop = await acp.prompt(text)
      acpOutput.appendLine(`[stop] ${stop}`)
    } catch (error) {
      acpOutput.appendLine(`ACP error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const stopAcpDisposable = vscode.commands.registerCommand("novaway.stopAcpSession", () => {
    acp?.stop()
    acp = undefined
    acpOutput.appendLine("[stopped]")
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    openAcpDisposable,
    stopAcpDisposable,
    acpOutput,
  )

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_novaway_PORT: port.toString(),
        novaway_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`novaway --port ${port}`)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
