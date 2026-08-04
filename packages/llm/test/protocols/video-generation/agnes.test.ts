import { describe, expect, test } from "bun:test"
import { agnesVideo } from "@opencode-ai/llm/protocols/video-generation/agnes"

describe("agnes video protocol", () => {
  test("uses the current Agnes API gateway", () => {
    expect(agnesVideo.baseURL).toBe("https://api.agnes-ai.cn/v1")
  })

  test("builds text-to-video body", () => {
    const body = agnesVideo.buildCreateBody({
      prompt: "a cat walking on the beach",
      model: "agnes-video-v2.0",
      height: 768,
      width: 1152,
      numFrames: 121,
      frameRate: 24,
    })

    expect(body).toEqual({
      model: "agnes-video-v2.0",
      prompt: "a cat walking on the beach",
      height: 768,
      width: 1152,
      num_frames: 121,
      frame_rate: 24,
    })
  })

  test("builds image-to-video body with image at top level", () => {
    const body = agnesVideo.buildCreateBody({
      prompt: "woman turns around",
      model: "agnes-video-v2.0",
      image: "https://example.com/image.png",
      numFrames: 121,
      frameRate: 24,
    })

    expect(body).toEqual({
      model: "agnes-video-v2.0",
      prompt: "woman turns around",
      image: "https://example.com/image.png",
      num_frames: 121,
      frame_rate: 24,
    })
    expect(body.image).toBe("https://example.com/image.png")
  })

  test("status endpoint resolves outside the v1 prefix", () => {
    expect(agnesVideo.statusEndpoint).toBe("../agnesapi?video_id={taskId}")
  })

  test("create response prefers video_id as task id", () => {
    const result = agnesVideo.parseCreateResponse({
      id: "task_123",
      task_id: "task_123",
      video_id: "video_456",
      status: "queued",
    })
    expect(result.taskId).toBe("video_456")
    expect(result.status).toBe("queued")
  })

  test("status response extracts video url", () => {
    const result = agnesVideo.parseStatusResponse({
      id: "task_123",
      video_id: "video_456",
      status: "completed",
      progress: 100,
      metadata: {
        url: "https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/video_xxxxxx.mp4",
      },
      error: null,
    })
    expect(result.taskId).toBe("video_456")
    expect(result.status).toBe("completed")
    expect(result.videoUrl).toBe("https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/video_xxxxxx.mp4")
  })

  test("status response extracts structured error message", () => {
    const result = agnesVideo.parseStatusResponse({
      task_id: "task_123",
      status: "failed",
      error: { message: "generation rejected" },
    })

    expect(result.taskId).toBe("task_123")
    expect(result.error).toBe("generation rejected")
  })

  test("status response maps in_progress status", () => {
    const result = agnesVideo.parseStatusResponse({
      id: "task_123",
      video_id: "video_456",
      status: "in_progress",
      progress: 50,
    })
    expect(result.status).toBe("in_progress")
    expect(result.progress).toBe(50)
  })
})
