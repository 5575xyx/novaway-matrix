/**
 * 一站式发布的公共类型。
 *
 * 设计目标是"一次内容 → 多个平台/账号"，所以批次（batch）是一等公民：
 * 渲染层只提交一次，主进程按账号逐个执行并把进度流回来。
 */

export type PublishKind = "video" | "image_text" | "article"

export type PublishStatus = "pending" | "running" | "success" | "failed" | "unsupported" | "cancelled"

export interface PublishInput {
  kind: PublishKind
  title: string
  description: string
  /** 本地文件绝对路径；视频 1 个，图文多张。 */
  filePaths: string[]
  tags?: string[]
  /** 定时发布（毫秒时间戳），平台不支持时由驱动忽略。 */
  scheduleTime?: number
}

export interface PublishAccountResult {
  accountId: string
  platform: string
  nickname: string
  status: PublishStatus
  /** 0-100。 */
  progress: number
  message: string
  url?: string
  error?: string
  /** 预检给出的警告（极限词、引流话术…）；不挡发布，但要让用户看见。 */
  warnings?: string[]
  updatedAt: number
}

export interface PublishBatch {
  id: string
  input: PublishInput
  results: PublishAccountResult[]
  startedAt: number
  finishedAt?: number
}

/** 推给渲染层的进度事件（也用于单条结果的最终态）。 */
export interface PublishProgressEvent {
  batchId: string
  result: PublishAccountResult
}
