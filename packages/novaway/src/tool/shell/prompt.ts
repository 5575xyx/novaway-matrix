import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@novaway/core/schema"
import { Global } from "@novaway/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

const descriptions = {
  bash: "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
  powershell:
    'Clear, concise description of what this command does in 5-10 words. Examples:\nInput: Get-ChildItem -LiteralPath "."\nOutput: Lists current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: New-Item -ItemType Directory -Path "tmp"\nOutput: Creates directory tmp',
  cmd: 'Clear, concise description of what this command does in 5-10 words. Examples:\nInput: dir\nOutput: Lists current directory\n\nInput: if exist "package.json" type "package.json"\nOutput: Prints package.json when it exists\n\nInput: mkdir tmp\nOutput: Creates directory tmp',
}

export type Limits = {
  maxLines: number
  maxBytes: number
  timeoutMs: number
  maxTimeoutMs: number
}

export function parameterSchema(description: string) {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to execute" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "Optional timeout in milliseconds" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
    description: Schema.String.annotate({ description }),
    background: Schema.optional(Schema.Boolean).annotate({
      description:
        "Run the command in the background and return immediately. Use for long-lived processes (dev servers, watchers). The user can watch and stop it in the status panel.",
    }),
  })
}

export const Parameters = parameterSchema(descriptions.bash)
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

function powershellNotes(name: string) {
  if (!PS.has(name)) return ""
  const edition =
    name === "pwsh"
      ? `# PowerShell edition: PowerShell 7+ (pwsh)
- Pipeline chain operators \`&&\` and \`||\` ARE available and work like bash. Prefer \`cmd1 && cmd2\` over \`cmd1; cmd2\` when cmd2 should only run if cmd1 succeeds.
- Ternary (\`$cond ? $a : $b\`), null-coalescing (\`??\`), and null-conditional (\`?.\`) operators are available.
- Default file encoding is UTF-8 without BOM.`
      : `# PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
- Pipeline chain operators \`&&\` and \`||\` are NOT available - they cause a parser error. To run B only if A succeeds: \`A; if ($?) { B }\`. To chain unconditionally: \`A; B\`.
- Ternary (\`?:\`), null-coalescing (\`??\`), and null-conditional (\`?.\`) operators are NOT available. Use \`if/else\` and explicit \`$null -eq\` checks instead.
- Avoid \`2>&1\` on native executables. In 5.1, redirecting a native command's stderr inside PowerShell wraps each line in an ErrorRecord (NativeCommandError) and sets \`$?\` to \`$false\` even when the exe returned exit code 0. stderr is already captured for you - do not redirect it.
- Default file encoding is UTF-16 LE (with BOM). When writing files other tools will read, pass \`-Encoding utf8\` to \`Out-File\`/\`Set-Content\`.
- \`ConvertFrom-Json\` returns a PSCustomObject, not a hashtable. \`-AsHashtable\` is not available.`

  return `${edition}

PowerShell syntax notes:
- Variables use a $ prefix: \`$myVar = "value"\`. The escape character is a backtick (\`), not backslash.
- Prefer Verb-Noun cmdlet names (\`Get-ChildItem\`, \`Set-Location\`, \`New-Item\`, \`Remove-Item\`) over aliases; \`ls\`, \`cd\`, \`cat\`, and \`rm\` are aliases for them.
- Use \`$(...)\` for subexpressions and \`@(...)\` for array expressions.
- The pipe operator \`|\` passes objects, not text. Use \`Select-Object\`, \`Where-Object\`, and \`ForEach-Object\` for filtering and transformation.
- String interpolation: \`"Hello $name"\` or \`"Hello $($obj.Property)"\`.
- Registry access uses PSDrive prefixes: \`HKLM:\\SOFTWARE\\...\`, \`HKCU:\\...\` - not raw \`HKEY_LOCAL_MACHINE\\...\`.
- Environment variables: read with \`$env:NAME\`, set with \`$env:NAME = "value"\` (not \`Set-Variable\` or bash \`export\`).
- To call a native executable whose path contains spaces, use the call operator: \`& "C:\\Program Files\\App\\app.exe" arg1 arg2\`.

Interactive and blocking commands (they hang - this tool runs with -NonInteractive):
- NEVER use \`Read-Host\`, \`Get-Credential\`, \`Out-GridView\`, \`$Host.UI.PromptForChoice\`, or \`pause\`.
- Destructive cmdlets (\`Remove-Item\`, \`Stop-Process\`, \`Clear-Content\`, etc.) may ask for confirmation. Add \`-Confirm:$false\` when you intend the action to proceed, and \`-Force\` for read-only or hidden items.
- Never use \`git rebase -i\`, \`git add -i\`, or other commands that open an interactive editor.

Passing multiline strings (commit messages, file content) to native executables:
- Use a single-quoted here-string so PowerShell does not expand \`$\` or backticks inside. The closing \`'@\` MUST be at column 0 (no leading whitespace) on its own line - indenting it is a parse error:
<example>
git commit -m @'
Commit message here.
Second line with $literal dollar signs.
'@
</example>
- Use \`@'...'@\` (single-quoted, literal) rather than \`@"..."@\` (double-quoted, interpolated) unless you need variable expansion.
- For arguments containing \`-\`, \`@\`, or other characters PowerShell parses as operators, use the stop-parsing token: \`git log --% --format=%H\`.`
}

function chainGuidance(name: string) {
  if (name === "powershell") {
    return "If the commands depend on each other and must run sequentially, avoid '&&' in this shell because Windows PowerShell (5.1) does not support it. Use PowerShell conditionals such as `cmd1; if ($?) { cmd2 }` when later commands must depend on earlier success."
  }
  if (PS.has(name)) {
    return "If the commands depend on each other and must run sequentially, use a single bash tool call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like New-Item before Copy-Item, Write before bash for git operations, or git add before git commit), run these operations sequentially instead."
  }
  if (CMD.has(name)) {
    return "If the commands depend on each other and must run sequentially, use a single bash tool call with `&&` to chain them together (e.g., `mkdir out && dir out`). For instance, if one operation must complete before another starts, run these operations sequentially instead."
  }
  return "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead."
}

function bashCommandSection(chain: string, limits: Limits) {
  return `Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")
   - Examples of proper quoting:
     - mkdir "/Users/name/My Documents" (correct)
     - mkdir /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${limits.timeoutMs}ms (${Math.round(limits.timeoutMs / 60000)} minutes). Requested timeouts are capped at ${limits.maxTimeoutMs}ms (${Math.round(limits.maxTimeoutMs / 60000)} minutes); pass a larger timeout for commands that are expected to take longer.
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use \`head\`, \`tail\`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.

  - Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two bash tool calls in parallel.
    - ${chain}
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - AVOID using \`cd <directory> && <command>\`. Use the \`workdir\` parameter to change directories instead.
    <good-example>
    Use workdir="/foo/bar" with command: pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>
  - Avoid unnecessary sleep commands:
    - Do not sleep between commands that can run immediately - just run them.
    - If your command is long running and you would like to be notified when it finishes - use \`background: true\`. No sleep needed.
    - Do not retry failing commands in a sleep loop - diagnose the root cause or consider an alternative approach.
    - If waiting for a background task you started with background: true, you will be notified when it completes - do not poll.
    - If you must poll an external process, use a check command rather than sleeping first.
    - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`
}

function powershellCommandSection(name: string, chain: string, pathSep: string, limits: Limits) {
  return `${powershellNotes(name)}

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`Test-Path -LiteralPath <parent>\` to verify the parent directory exists and is the correct location
   - For example, before creating \`foo${pathSep}bar\`, first use \`Test-Path -LiteralPath "foo"\` to check that \`foo\` exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., Remove-Item -LiteralPath "path with spaces${pathSep}file.txt")
   - Examples of proper quoting:
     - New-Item -ItemType Directory -Path "My Documents" (correct)
     - New-Item -ItemType Directory -Path My Documents (incorrect - path is split)
     - & "path with spaces${pathSep}script.ps1" (correct)
     - path with spaces${pathSep}script.ps1 (incorrect - path is split and not invoked)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${limits.timeoutMs}ms (${Math.round(limits.timeoutMs / 60000)} minutes). Requested timeouts are capped at ${limits.maxTimeoutMs}ms (${Math.round(limits.maxTimeoutMs / 60000)} minutes); pass a larger timeout for commands that are expected to take longer.
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use \`Select-Object -First\`, \`Select-Object -Last\`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.

  - Avoid using Shell with PowerShell file/content cmdlets unless explicitly instructed or when these cmdlets are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT Get-ChildItem)
    - Content search: Use Grep (NOT Select-String)
    - Read files: Use Read (NOT Get-Content)
    - Edit files: Use Edit (NOT Set-Content)
    - Write files: Use Write (NOT Set-Content/Out-File or here-strings)
    - Communication: Output text directly (NOT Write-Output/Write-Host)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two bash tool calls in parallel.
    - ${chain}
    - Use \`;\` only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - AVOID changing directories inside the command. Use the \`workdir\` parameter to change directories instead.
    <good-example>
    Use workdir="project${pathSep}subdir" with command: pytest tests
    </good-example>
    <bad-example>
    ${name === "powershell" ? `Set-Location -LiteralPath "project${pathSep}subdir"; if ($?) { pytest tests }` : `Set-Location -LiteralPath "project${pathSep}subdir" && pytest tests`}
    </bad-example>
  - Avoid unnecessary sleep commands:
    - Do not sleep between commands that can run immediately - just run them.
    - If your command is long running and you would like to be notified when it finishes - use \`background: true\`. No sleep needed.
    - Do not retry failing commands in a sleep loop - diagnose the root cause or consider an alternative approach.
    - If waiting for a background task you started with background: true, you will be notified when it completes - do not poll.
    - If you must poll an external process, use a check command rather than sleeping first.
    - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`
}

function cmdCommandSection(chain: string, limits: Limits) {
  return `# cmd.exe shell notes
- Use double quotes for paths with spaces.
- Use %VAR% for environment variables.
- Use \`if exist\` for existence checks.
- Use \`call\` when invoking batch files from another batch-style command.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`if exist\` to verify the parent directory exists and is the correct location
   - For example, before creating \`foo\\bar\`, first use \`if exist "foo\\" dir "foo"\` to check that \`foo\` exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., del "path with spaces\\file.txt")
   - Examples of proper quoting:
     - mkdir "My Documents" (correct)
     - mkdir My Documents (incorrect - path is split)
     - call "path with spaces\\script.bat" (correct)
     - path with spaces\\script.bat (incorrect - path is split and not invoked correctly)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${limits.timeoutMs}ms (${Math.round(limits.timeoutMs / 60000)} minutes). Requested timeouts are capped at ${limits.maxTimeoutMs}ms (${Math.round(limits.maxTimeoutMs / 60000)} minutes); pass a larger timeout for commands that are expected to take longer.
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use \`more\` or other pagination commands to limit output; the full output will already be captured to a file for more precise searching.

  - Avoid using Shell with cmd.exe file/content commands unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT dir /s)
    - Content search: Use Grep (NOT findstr)
    - Read files: Use Read (NOT type)
    - Edit files: Use Edit (NOT copy)
    - Write files: Use Write (NOT echo > file)
    - Communication: Output text directly (NOT echo)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run "dir" and "where cmd", send a single message with two bash tool calls in parallel.
    - ${chain}
    - Use \`&\` only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - AVOID changing directories inside the command. Use the \`workdir\` parameter to change directories instead.
    <good-example>
    Use workdir="project\\subdir" with command: dir
    </good-example>
    <bad-example>
    cd /d "project\\subdir" && dir
    </bad-example>
  - Avoid unnecessary sleep commands:
    - Do not sleep between commands that can run immediately - just run them.
    - If your command is long running and you would like to be notified when it finishes - use \`background: true\`. No sleep needed.
    - Do not retry failing commands in a sleep loop - diagnose the root cause or consider an alternative approach.
    - If waiting for a background task you started with background: true, you will be notified when it completes - do not poll.
    - If you must poll an external process, use a check command rather than sleeping first.
    - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits, dedicated = false) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: cmdCommandSection(chain, limits),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using a temporary body file so cmd.exe quoting stays simple.",
      createPrExample: `(\n  echo ## Summary\n  echo - ^<1-3 bullet points^>\n) > pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
      parameterDescription: descriptions.cmd,
    }
  }
  if (isPowerShell) {
    return {
      intro: dedicated
        ? `Executes a given ${shellDisplayName(name)} command with optional timeout. This tool always runs PowerShell, regardless of the session's configured shell; use it for PowerShell cmdlets, Windows-native executables, and anything that needs PowerShell syntax.`
        : `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: powershellCommandSection(name, chain, platform === "win32" ? "\\" : "/", limits),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using gh pr create with a PowerShell here-string to pass the body correctly.",
      createPrExample: `gh pr create --title "the pr title" --body @'
## Summary
- <1-3 bullet points>
'@`,
      parameterDescription: descriptions.powershell,
    }
  }
  return {
    intro:
      "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.",
    workdirSection:
      "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.",
    commandSection: bashCommandSection(chain, limits),
    gitCommands: "bash commands",
    gitCommandRestriction: "git bash commands",
    createPrInstruction:
      "Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.",
    createPrExample: `gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>`,
    parameterDescription: descriptions.bash,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, opts?: { dedicated?: boolean }) {
  const selected = profile(name, platform, limits, opts?.dedicated === true)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(selected.parameterDescription),
  }
}

export * as ShellPrompt from "./prompt"
