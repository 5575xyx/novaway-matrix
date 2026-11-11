/**
 * Office / 素材预览的读取契约：要么拿到字节，要么带 code 说清为什么拿不到。
 *
 * 单独一个模块是因为这条通道原来把三种情况折成了同一个空字符串：
 * 「文件不存在」「越界被拒」「读取抛异常」都返回 `""`，而面板只用
 * `<Show when={base64}>` 判有没有，于是失败长得和「还在加载」一模一样，
 * 骨架屏永远转圈（聊天区点裸文件名打不开 pptx 就是这条）。
 * 现在三态互斥，失败压掉骨架屏 —— `pending / failure / doc`。
 */

/** 前四个 code 与服务端 `File.ReadErrorCode` 逐字一致；后两个是面板本地的补充。 */
export type OfficePreviewErrorCode =
  | "invalid_path"
  | "path_outside_workspace"
  | "not_found"
  | "unsupported_type"
  | "empty"
  | "read_failed"

export type OfficePreviewFailure = { code: OfficePreviewErrorCode; path: string; message: string }

export type OfficePreviewLoad = { base64: string } | OfficePreviewFailure

export const isOfficePreviewFailure = (load: OfficePreviewLoad): load is OfficePreviewFailure => "code" in load

/** 面板的两条取值：失败态和内容态互斥，两边都空才是「还在读」。 */
export const officePreviewFailure = (load: OfficePreviewLoad | undefined) =>
  load && isOfficePreviewFailure(load) ? load : undefined

export const officePreviewBase64 = (load: OfficePreviewLoad | undefined) =>
  load && !isOfficePreviewFailure(load) ? load.base64 : undefined

/** 每种失败原因的一句话说法；技术细节和路径另起一行，不混进标题。 */
const FAILURE_TITLES: Record<OfficePreviewErrorCode, string> = {
  invalid_path: "这里没有可预览的文件路径",
  path_outside_workspace: "这个文件在项目目录之外，面板不读",
  not_found: "文件不存在",
  unsupported_type: "这种格式不能预览",
  empty: "文件是空的，没有可预览的内容",
  read_failed: "读取失败",
}

export const officePreviewFailureTitle = (code: OfficePreviewErrorCode) => FAILURE_TITLES[code]

const SERVER_ERROR_CODES: readonly OfficePreviewErrorCode[] = [
  "invalid_path",
  "path_outside_workspace",
  "not_found",
  "unsupported_type",
]

/** 服务端的 code 是外部输入：认得的原样用，不认得的收成 read_failed，不猜。 */
function toErrorCode(code: string | undefined) {
  return SERVER_ERROR_CODES.find((item) => item === code) ?? "read_failed"
}

/** `/file/content?encoding=base64` 用到的最小切片；SDK 不 reject，失败藏在 `error` 里。 */
export type PreviewReadResult = {
  data?: { content?: string }
  error?: { data?: { code?: string; path?: string; message?: string } }
}

export type OfficePreviewReader = {
  isExternal: (path: string) => boolean
  /** 桌面端读项目外文件；Web 形态没有这个通道，只能是 undefined。 */
  readLocal?: (path: string) => Promise<string | null>
  readServer: (path: string) => Promise<PreviewReadResult>
}

/**
 * 总函数：任何异常都收成失败，绝不把 reject 漏给调用方
 * —— 资源 reject 会沿渲染树抛穿，把整个面板带崩。
 */
export async function readOfficePreview(reader: OfficePreviewReader, path: string): Promise<OfficePreviewLoad> {
  try {
    if (reader.isExternal(path) && reader.readLocal) {
      const local = await reader.readLocal(path)
      if (!local) return { code: "not_found", path, message: "本地文件读不到，可能已被移动或删除。" }
      return { base64: local }
    }
    const result = await reader.readServer(path)
    if (result.error) {
      const data = result.error.data
      return {
        code: toErrorCode(data?.code),
        path: data?.path || path,
        message: data?.message || "服务端拒绝了这个路径。",
      }
    }
    const content = result.data?.content
    if (!content) return { code: "empty", path, message: "服务端返回了空内容。" }
    return { base64: content }
  } catch (error) {
    return { code: "read_failed", path, message: error instanceof Error ? error.message : String(error) }
  }
}
