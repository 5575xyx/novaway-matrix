// 发布相关的渲染层类型（与 packages/desktop/src/preload/types.ts 一一对应）。
// 两个进程之间只传可序列化的普通对象，所以这里保持纯数据结构，不放行为。
import type { PublishKind } from "./publish-capabilities"

export type { PublishKind }

export type PublishStatus = "pending" | "running" | "success" | "failed" | "unsupported" | "cancelled"

export interface PublishBatchInput {
  kind: PublishKind
  title: string
  description: string
  filePaths: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PublishAccountResult {
  accountId: string
  platform: string
  nickname: string
  status: PublishStatus
  progress: number
  message: string
  url?: string
  error?: string
  updatedAt: number
}

export interface PublishBatch {
  id: string
  input: PublishBatchInput
  results: PublishAccountResult[]
  startedAt: number
  finishedAt?: number
}

export interface PublishProgressEvent {
  batchId: string
  result: PublishAccountResult
}
