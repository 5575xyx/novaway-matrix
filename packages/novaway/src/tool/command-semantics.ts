/**
 * Exit-code semantics, ported from Claude Code's `commandSemantics.ts`.
 *
 * Most commands use 0 for success and anything else for failure, but a few use
 * non-zero codes as information: `grep` exits 1 when nothing matched, `diff`
 * exits 1 when files differ, `test` exits 1 when the condition is false. Those
 * are not failures, and reporting them as such pushes the model to "fix" a
 * command that behaved exactly as asked.
 *
 * PowerShell 下同样适用：`findstr` 与 grep 一致，`robocopy` 的 0-7 全是成功。
 * 命令名会先去掉调用运算符（`&`）、引号、目录和 `.exe` 后缀再匹配。
 */
export type Interpretation = {
  isError: boolean
  message?: string
}

/** Last command in a pipeline decides the exit code (`a | b` reports `b`). */
function baseCommand(command: string) {
  const segments = command.split(/\|\||&&|[|;\n]/g).map((item) => item.trim())
  const last = [...segments].reverse().find((item) => item.length > 0) ?? ""
  // PowerShell 的调用运算符、绝对路径和 .exe 后缀都要归一化：
  // `& "C:\bin\grep.exe" x` 和 `grep x` 是同一个命令，退出码语义相同。
  const stripped = last.replace(/^[&.]\s+/, "")
  const token = (stripped.split(/\s+/)[0] ?? "").replace(/^["']|["']$/g, "")
  const file = token.split(/[\\/]/).pop() ?? token
  return file.toLowerCase().replace(/\.exe$/, "")
}

const SEMANTICS: Record<string, (code: number) => Interpretation> = {
  // 0 = match, 1 = no match, 2+ = real error
  grep: (code) => ({ isError: code >= 2, message: code === 1 ? "No matches found" : undefined }),
  rg: (code) => ({ isError: code >= 2, message: code === 1 ? "No matches found" : undefined }),
  // Windows 原生文本搜索，与 grep 同一套语义
  findstr: (code) => ({ isError: code >= 2, message: code === 1 ? "No matches found" : undefined }),
  // 1 = some directories were inaccessible
  find: (code) => ({ isError: code >= 2, message: code === 1 ? "Some directories were inaccessible" : undefined }),
  // 1 = files differ
  diff: (code) => ({ isError: code >= 2, message: code === 1 ? "Files differ" : undefined }),
  // 1 = condition false
  test: (code) => ({ isError: code >= 2, message: code === 1 ? "Condition is false" : undefined }),
  "[": (code) => ({ isError: code >= 2, message: code === 1 ? "Condition is false" : undefined }),
  // robocopy 的退出码是位掩码：0-7 都算成功（1 = 已复制文件），8+ 才是错误。
  // 不处理会让“复制成功但退出码 1”看起来像失败。
  robocopy: (code) => ({
    isError: code >= 8,
    message:
      code === 0
        ? "No files copied (already in sync)"
        : code > 0 && code < 8
          ? code & 1
            ? "Files copied successfully"
            : "Robocopy completed (no errors)"
          : undefined,
  }),
}

export function interpretCommandResult(command: string, exitCode: number): Interpretation {
  const semantic = SEMANTICS[baseCommand(command)]
  if (semantic) return semantic(exitCode)
  return {
    isError: exitCode !== 0,
    message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
  }
}

export * as CommandSemantics from "./command-semantics"
