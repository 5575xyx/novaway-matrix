import { describe, expect, test } from "bun:test"
import { drainPendingOpenFiles, drainQueuedOpenFiles, queueOpenFiles } from "./open-files"

describe("系统打开文件的队列", () => {
  test("取走主进程挂载前排下的路径，取完清空", () => {
    const target = { __NOVAWAY__: { openFiles: ["/tmp/a.docx", "/tmp/b.xlsx"] } }
    expect(drainPendingOpenFiles(target)).toEqual(["/tmp/a.docx", "/tmp/b.xlsx"])
    expect(drainPendingOpenFiles(target)).toEqual([])
    expect(target.__NOVAWAY__.openFiles).toEqual([])
  })

  test("没有排队时返回空数组，不新建 __NOVAWAY__", () => {
    const target = {}
    expect(drainPendingOpenFiles(target)).toEqual([])
    expect("__NOVAWAY__" in target).toBe(false)
  })

  test("任务页未挂载时先排队，挂载后按顺序取走一次", () => {
    queueOpenFiles(["/tmp/a.docx", ""])
    queueOpenFiles(["/tmp/b.xlsx"])
    expect(drainQueuedOpenFiles()).toEqual(["/tmp/a.docx", "/tmp/b.xlsx"])
    expect(drainQueuedOpenFiles()).toEqual([])
  })
})
