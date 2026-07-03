import type {
  VideoGenerationParams,
  VideoGenerationProtocol,
  VideoTaskCreateResult,
  VideoTaskStatusResult,
} from "./index"

/**
 * Agnes Video V2.0 适配器
 *
 * API: POST /v1/videos + GET /v1/videos/{task_id}
 * 文档: https://agnes-ai.com/doc/agnes-video-v20
 *
 * num_frames 必须满足 8n+1 且 ≤ 441，可选值: 81, 121, 161, 241, 441
 * frame_rate 范围: 1-60
 * 视频时长: seconds = num_frames / frame_rate
 */
export const agnesVideo: VideoGenerationProtocol = {
  id: "agnes-video",
  baseURL: "https://apihub.agnes-ai.com/v1",

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
    const data = raw as { id?: string; status?: string }
    return {
      taskId: data.id ?? "",
      status: (data.status as VideoTaskCreateResult["status"]) ?? "queued",
    }
  },

  buildStatusUrl: (taskId: string) => `/videos/${taskId}`,

  parseStatusResponse: (raw: unknown): VideoTaskStatusResult => {
    const data = raw as {
      id?: string
      status?: string
      progress?: number
      video_url?: string
      url?: string
      error?: string
    }
    return {
      taskId: data.id ?? "",
      status: (data.status as VideoTaskStatusResult["status"]) ?? "queued",
      progress: data.progress,
      videoUrl: data.video_url ?? data.url ?? undefined,
      error: data.error,
    }
  },
}
