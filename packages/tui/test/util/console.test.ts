import { describe, expect, test } from "bun:test"
import { readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { redirectConsoleToLog } from "../../src/util/console"

// 这里守的是"画面错位"那条防线:console 的输出绝不允许再进真实终端,
// 只能落到日志文件里 —— alternate-screen 下一个 "\n" 就能把整屏顶上去一行。
describe("redirectConsoleToLog", () => {
  test("console 输出进日志文件,不再写终端;restore 后复原", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nw-console-"))
    try {
      const writes: string[] = []
      const originalLog = console.log
      const originalError = console.error
      console.log = (...args: unknown[]) => writes.push(args.join(" "))
      console.error = (...args: unknown[]) => writes.push(args.join(" "))
      try {
        const restore = redirectConsoleToLog(dir)!

        console.log("一条普通日志", { id: 42 })
        console.error("错误 %s + %d", "占位", 7)

        // 输出没落到被换掉的"终端"上
        await Bun.sleep(30)
        expect(writes).toEqual([])

        const log = await readFile(path.join(dir, "tui.log"), "utf8")
        expect(log).toContain("一条普通日志")
        expect(log).toContain("{ id: 42 }")
        expect(log).toContain("错误 占位 + 7")
        expect(log).toContain("[log]")
        expect(log).toContain("[error]")

        // restore 后 console 回到原样,且可以再次安装
        restore()
        console.log("这条应该回到假终端")
        expect(writes).toEqual(["这条应该回到假终端"])
      } finally {
        console.log = originalLog
        console.error = originalError
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("重复安装是幂等的,不会把第一层 restore 弄丢", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nw-console-"))
    try {
      const restore = redirectConsoleToLog(dir)!
      try {
        // 第二次安装直接被忽略:installed 标记还在
        redirectConsoleToLog(dir)
        console.log("仍然只进文件")
        await Bun.sleep(30)
        const log = await readFile(path.join(dir, "tui.log"), "utf8")
        expect(log).toContain("仍然只进文件")
      } finally {
        restore()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
