import type {
  VideoGenerationParams,
  VideoGenerationProtocol,
  VideoTaskCreateResult,
  VideoTaskStatusResult,
} from "./index"

/**
 * Agnes Video V2.0 适配器
 *
 * API: POST /v1/videos + GET /agnesapi?video_id={video_id}
 * 文档: https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-v20
 *
 * num_frames 必须满足 8n+1 且 ≤ 441，可选值: 81, 121, 161, 241, 441
 * frame_rate 范围: 1-60
 * 视频时长: seconds = num_frames / frame_rate
 */
export const agnesVideo: VideoGenerationProtocol = {
  id: "agnes-video",
  baseURL: "https://api.agnes-ai.cn/v1",
  createEndpoint: "/videos",
  statusEndpoint: "../agnesapi?video_id={taskId}",

  buildCreateBody: (params: VideoGenerationParams) => {
    const body: Record<string, unknown> = {
      model: params.model || "agnes-video-v2.0",
      prompt: params.prompt,
    }

    if (params.height) {
      body.height = params.height
    }

    if (params.width) {
      body.width = params.width
    }

    if (params.numFrames) {
      body.num_frames = params.numFrames
    }

    if (params.frameRate) {
      body.frame_rate = params.frameRate
    }

    if (params.image) {
      body.image = params.image
    }

    if (params.options) {
      Object.assign(body, params.options)
    }

    return body
  },

  parseCreateResponse: (raw: unknown): VideoTaskCreateResult => {
    const data = raw as { id?: string; task_id?: string; video_id?: string; status?: string }
    return {
      taskId: data.video_id ?? data.id ?? data.task_id ?? "",
      status: (data.status as VideoTaskCreateResult["status"]) ?? "queued",
    }
  },

  parseStatusResponse: (raw: unknown): VideoTaskStatusResult => {
    const data = raw as {
      id?: string
      task_id?: string
      video_id?: string
      status?: string
      progress?: number
      video_url?: string
      url?: string
      metadata?: { url?: string }
      error?: string | { message?: string; detail?: string }
    }
    return {
      taskId: data.video_id ?? data.task_id ?? data.id ?? "",
      status: (data.status as VideoTaskStatusResult["status"]) ?? "queued",
      progress: data.progress,
      videoUrl: data.metadata?.url ?? data.video_url ?? data.url ?? undefined,
      error:
        typeof data.error === "string"
          ? data.error
          : data.error?.message ?? data.error?.detail ?? (data.error ? JSON.stringify(data.error) : undefined),
    }
  },
}
