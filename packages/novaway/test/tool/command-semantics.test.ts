import { describe, expect, test } from "bun:test"
import { interpretCommandResult } from "../../src/tool/command-semantics"

describe("tool.command-semantics", () => {
  test("zero is always success", () => {
    expect(interpretCommandResult("grep foo bar", 0)).toEqual({ isError: false, message: undefined })
    expect(interpretCommandResult("bun test", 0)).toEqual({ isError: false, message: undefined })
  })

  test("grep and rg treat 1 as 'no matches' instead of failure", () => {
    expect(interpretCommandResult("grep -n foo src", 1)).toEqual({ isError: false, message: "No matches found" })
    expect(interpretCommandResult("rg foo", 1)).toEqual({ isError: false, message: "No matches found" })
    expect(interpretCommandResult("grep foo", 2)).toMatchObject({ isError: true })
    expect(interpretCommandResult("rg foo", 2)).toMatchObject({ isError: true })
  })

  test("diff, find and test have their own non-error exit codes", () => {
    expect(interpretCommandResult("diff a b", 1)).toEqual({ isError: false, message: "Files differ" })
    expect(interpretCommandResult("find . -name x", 1)).toEqual({
      isError: false,
      message: "Some directories were inaccessible",
    })
    expect(interpretCommandResult("test -f a", 1)).toEqual({ isError: false, message: "Condition is false" })
    expect(interpretCommandResult("[ -f a ]", 1)).toEqual({ isError: false, message: "Condition is false" })
  })

  test("the last command of a pipeline decides the semantics", () => {
    expect(interpretCommandResult("cat log | grep error", 1)).toEqual({
      isError: false,
      message: "No matches found",
    })
    expect(interpretCommandResult("grep foo && false", 1)).toMatchObject({ isError: true })
  })

  test("PowerShell call operators and .exe suffixes map to the same command", () => {
    expect(interpretCommandResult('& "C:\\bin\\grep.exe" foo', 1)).toEqual({
      isError: false,
      message: "No matches found",
    })
    expect(interpretCommandResult("findstr foo *", 1)).toEqual({ isError: false, message: "No matches found" })
    expect(interpretCommandResult("Get-ChildItem -Recurse | findstr foo", 1)).toEqual({
      isError: false,
      message: "No matches found",
    })
    expect(interpretCommandResult("findstr foo *", 2)).toMatchObject({ isError: true })
  })

  test("robocopy bitfield exit codes 0-7 are success", () => {
    expect(interpretCommandResult("robocopy src dst", 0)).toEqual({
      isError: false,
      message: "No files copied (already in sync)",
    })
    expect(interpretCommandResult("robocopy src dst", 1)).toEqual({
      isError: false,
      message: "Files copied successfully",
    })
    expect(interpretCommandResult("robocopy src dst", 2)).toEqual({
      isError: false,
      message: "Robocopy completed (no errors)",
    })
    expect(interpretCommandResult("robocopy src dst", 8)).toEqual({ isError: true, message: undefined })
  })

  test("other non-zero exits are failures", () => {
    expect(interpretCommandResult("bun test", 1)).toEqual({
      isError: true,
      message: "Command failed with exit code 1",
    })
    expect(interpretCommandResult("npm run build", 2)).toEqual({
      isError: true,
      message: "Command failed with exit code 2",
    })
  })
})
