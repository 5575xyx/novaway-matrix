import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@novaway/sdk/v2/client"

/**
 * 回归测试：SDK 重新生成后嵌套客户端改名时，客户端工厂不能崩。
 *
 * 曾经 `session.background` 从嵌套客户端变成 GET 方法，
 * 兼容别名对 undefined 调 `.bind()`，导致 createOpencodeClient 抛
 * "Cannot read properties of undefined (reading 'bind')"，
 * 整个应用在启动健康检查阶段直接白屏。
 */
describe("createOpencodeClient compatibility aliases", () => {
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" }) as any

  test("builds the client without throwing", () => {
    expect(client).toBeDefined()
    expect(typeof client.session).toBe("object")
  })

  test("keeps the flattened session aliases callable", () => {
    expect(typeof client.session.backgroundCancel).toBe("function")
    expect(typeof client.session.tempFilesList).toBe("function")
    expect(typeof client.session.tempFilesClean).toBe("function")
  })

  test("keeps the knowledge eval aliases callable", () => {
    expect(typeof client.knowledge.runEval).toBe("function")
    expect(typeof client.knowledge.suggestEvalCases).toBe("function")
    expect(typeof client.knowledge.evalHistory).toBe("function")
    expect(typeof client.knowledge.evalDiff).toBe("function")
    expect(typeof client.knowledge.evalReport).toBe("function")
  })

  test("native nested clients still work", () => {
    expect(typeof client.session.background).toBe("function")
    expect(typeof client.session.tempFiles.list).toBe("function")
    expect(typeof client.knowledge.eval.history).toBe("function")
  })
})
