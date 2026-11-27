import { describe, expect, test } from "bun:test"
import { retryablePublishAccountIds, type PublishAccountResult } from "./publish-types"

const result = (accountId: string, status: PublishAccountResult["status"]): PublishAccountResult => ({
  accountId,
  platform: "xhs",
  nickname: accountId,
  status,
  progress: 100,
  message: status,
  updatedAt: 1,
})

describe("publish retry selection", () => {
  test("只选择失败和取消账号，不重复提交成功账号", () => {
    expect(
      retryablePublishAccountIds([
        result("success", "success"),
        result("failed", "failed"),
        result("cancelled", "cancelled"),
        result("pending", "pending"),
      ]),
    ).toEqual(["failed", "cancelled"])
  })
})
