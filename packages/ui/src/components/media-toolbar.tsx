import { createSignal, onCleanup, type JSX } from "solid-js"
import { useI18n } from "../context/i18n"
import { copyMediaToClipboard } from "../util/clipboard"
import { downloadFile, filenameFromUrl } from "../util/download"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

export type MediaType = "image" | "video"

export interface MediaToolbarProps {
  url: string
  type: MediaType
  alt?: string
}

export function MediaToolbar(props: MediaToolbarProps): JSX.Element {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let timeout: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  const copyLabel = () => (props.type === "video" ? i18n.t("ui.message.copyVideo") : i18n.t("ui.message.copyImage"))

  const handleCopy = async () => {
    if (await copyMediaToClipboard(props.url, props.type)) {
      setCopied(true)
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const fallback = props.type === "video" ? "video.mp4" : "image.png"
    void downloadFile(props.url, filenameFromUrl(props.url, fallback))
  }

  return (
    <div data-component="media-toolbar" style={{ display: "flex", gap: "6px" }}>
      <Tooltip value={copied() ? i18n.t("ui.message.copied") : copyLabel()}>
        <IconButton
          icon={copied() ? "check" : "copy"}
          variant="secondary"
          size="small"
          aria-label={copied() ? i18n.t("ui.message.copied") : copyLabel()}
          onClick={handleCopy}
        />
      </Tooltip>
      <Tooltip value={i18n.t("ui.message.download")}>
        <IconButton
          icon="download"
          variant="secondary"
          size="small"
          aria-label={i18n.t("ui.message.download")}
          onClick={handleDownload}
        />
      </Tooltip>
    </div>
  )
}
