import { lazy, Match, Suspense, Switch } from "solid-js"
import { useLanguage } from "@/context/language"
import type { OfficeFilePreviewProps } from "@/pages/session/office-file-preview"
import { OfficePreviewFailureState } from "@/pages/session/office-preview-failure"
import { OfficeRibbonBar, OfficeRibbonProvider } from "@/pages/session/office-ribbon"
import { isImagePreviewPath, isOfficePreviewPath } from "@/pages/session/office-preview-utils"

export type FileMediaPreviewKind = "audio" | "video"

/**
 * 预览分发器按需加载：它连带 `@novaway/core/office/pdf/engine`（pdf-lib ~750KB）
 * 与 Lexora 编辑器宿主，属于「只有真的打开文件才需要」的重量级依赖。
 * 静态引入会让每次进入会话都先解析这坨代码，首帧和切换会话都被拖慢。
 */
const officeFilePreviewModule = import("@/pages/session/office-file-preview")
const OfficeFilePreview = lazy(() => officeFilePreviewModule.then((mod) => ({ default: mod.OfficeFilePreview })))

/** 在会话页后台预热右侧文件预览模块，避免第一次打开 Office 文件时才下载代码块。 */
export function preloadSessionFilePreview() {
  void officeFilePreviewModule
}

const MEDIA_PREVIEW_FORMATS: Readonly<Record<string, { kind: FileMediaPreviewKind; mimeType: string }>> = {
  mp4: { kind: "video", mimeType: "video/mp4" },
  mov: { kind: "video", mimeType: "video/quicktime" },
  webm: { kind: "video", mimeType: "video/webm" },
  m4v: { kind: "video", mimeType: "video/x-m4v" },
  mp3: { kind: "audio", mimeType: "audio/mpeg" },
  wav: { kind: "audio", mimeType: "audio/wav" },
  m4a: { kind: "audio", mimeType: "audio/mp4" },
  ogg: { kind: "audio", mimeType: "audio/ogg" },
  opus: { kind: "audio", mimeType: "audio/opus" },
  flac: { kind: "audio", mimeType: "audio/flac" },
  weba: { kind: "audio", mimeType: "audio/webm" },
}

export const FILE_MEDIA_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

export function getFileMediaPreviewFormat(path: string | undefined) {
  if (!path) return undefined
  const extension = path.replace(/\\/g, "/").toLowerCase().split("/").at(-1)?.split(".").at(-1)
  return extension ? MEDIA_PREVIEW_FORMATS[extension] : undefined
}

export function fileMediaPreviewSource(url: string | undefined) {
  return url || undefined
}

/** 预览分片下载期间的占位：与数据加载中的样式保持一致，避免出现空白跳变。 */
function OfficePreviewLoading(props: { label: string }) {
  return (
    <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
      {props.label}...
    </div>
  )
}

export function FilePreviewBinaryContent(props: {
  path: () => string | undefined
  loaded: () => boolean
  loading: () => boolean
  error: () => string | undefined
  officeFailure: () => Parameters<typeof OfficePreviewFailureState>[0]["failure"] | undefined
  officeBase64: () => string | undefined
  imageBase64: () => string | undefined
  mediaUrl: () => string | undefined
  mediaFailure: () => string | undefined
  onMediaError?: () => void
  officePreviewProps: Omit<OfficeFilePreviewProps, "path" | "base64">
  editing: () => boolean
  loadingLabel: string
  onSaveImage: NonNullable<OfficeFilePreviewProps["onSaveImage"]>
}) {
  const language = useLanguage()
  const showOffice = () => props.loaded() && !!props.path() && isOfficePreviewPath(props.path())
  const showImage = () => props.loaded() && !!props.path() && isImagePreviewPath(props.path())
  const media = () => getFileMediaPreviewFormat(props.path())
  const mediaUrl = () => fileMediaPreviewSource(props.mediaUrl())

  return (
    <Switch>
      <Match when={showImage() && props.imageBase64()}>
        <Suspense fallback={<OfficePreviewLoading label={props.loadingLabel} />}>
          <OfficeFilePreview path={props.path()!} base64={props.imageBase64()!} onSaveImage={props.onSaveImage} />
        </Suspense>
      </Match>
      <Match when={props.loaded() && media()}>
        <Switch>
          <Match when={props.mediaFailure()}>
            {(failure) => (
              <div class="p-3 text-12-regular text-critical-base" role="alert">
                {failure()}
              </div>
            )}
          </Match>
          <Match when={mediaUrl()}>
            {(url) => (
              <div class="flex h-full min-h-0 items-center justify-center overflow-auto bg-background p-6">
                {media()?.kind === "video" ? (
                  <video
                    controls
                    playsinline
                    preload="metadata"
                    class="max-h-full max-w-full rounded-lg"
                    src={url()}
                    onError={() => props.onMediaError?.()}
                  >
                    {language.t("session.files.mediaUnsupported")}
                  </video>
                ) : (
                  <audio
                    controls
                    preload="metadata"
                    class="w-full max-w-2xl"
                    src={url()}
                    onError={() => props.onMediaError?.()}
                  >
                    {language.t("session.files.mediaUnsupported")}
                  </audio>
                )}
              </div>
            )}
          </Match>
          <Match when={true}>
            <div class="p-3 text-12-regular text-foreground-subtle">{props.loadingLabel}...</div>
          </Match>
        </Switch>
      </Match>
      <Match when={showOffice()}>
        <Switch>
          <Match when={props.officeFailure()}>{(failure) => <OfficePreviewFailureState failure={failure()} />}</Match>
          <Match when={props.officeBase64()}>
            {(value) => (
              <OfficeRibbonProvider>
                <OfficeRibbonBar />
                <Suspense fallback={<OfficePreviewLoading label={props.loadingLabel} />}>
                  <OfficeFilePreview path={props.path()!} base64={value()} {...props.officePreviewProps} />
                </Suspense>
              </OfficeRibbonProvider>
            )}
          </Match>
          <Match when={true}>
            <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
              {props.loadingLabel}...
            </div>
          </Match>
        </Switch>
      </Match>
      <Match when={props.loaded()}>
        <div class="flex h-full items-center justify-center px-6 text-12-regular text-foreground-subtle">
          {language.t("session.files.binaryContent")}
        </div>
      </Match>
      <Match when={props.loading()}>
        <div class="px-6 py-4 text-foreground-subtle">{props.loadingLabel}...</div>
      </Match>
      <Match when={props.error()}>{(error) => <div class="px-6 py-4 text-foreground-subtle">{error()}</div>}</Match>
    </Switch>
  )
}
