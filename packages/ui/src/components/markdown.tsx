import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import { useDialog } from "../context/dialog"
import { ImagePreview } from "./image-preview"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@novaway/core/util/encode"
import { copyMediaToClipboard } from "../util/clipboard"
import { downloadFile, filenameFromUrl } from "../util/download"
import { ComponentProps, createEffect, createMemo, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { plainStreamingRender, stream } from "./markdown-stream"
import { dirPath, filePath, urlPattern } from "./markdown-file-path"
import { chooseIconName } from "./file-icons/choose"
import sprite from "./file-icons/sprite.svg"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path", "img", "video"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "src", "alt", "controls", "width"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
  download:
    '<path d="M13.9583 10.6257L10 14.584L6.04167 10.6257M10 2.08398V13.959M16.25 17.9173H3.75" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

type CopyLabels = {
  copy: string
  copied: string
  copyImage: string
  copyVideo: string
  download: string
}

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

/**
 * 行内文件 / 目录图标。
 *
 * 和 `FileIcon` 用同一张 sprite、同一套 `chooseIconName` 选图规则 ——
 * 差别只是这里的节点是 marked 渲染出来的 DOM，挂不进 Solid 组件，
 * 所以照 createIcon 的办法手搭一个 svg + use。
 */
function attachFileIcon(code: HTMLElement, path: string, type: "file" | "directory") {
  if (code.firstElementChild?.getAttribute("data-component") === "file-icon") return
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  const name = chooseIconName(path, type, false)
  const id = `markdown-file-icon-${crypto.randomUUID()}`
  svg.setAttribute("data-component", "file-icon")
  svg.setAttribute("data-kind", type)
  svg.setAttribute("aria-hidden", "true")
  const defs = document.createElementNS(ns, "defs")
  const mask = document.createElementNS(ns, "mask")
  mask.setAttribute("id", id)
  mask.setAttribute("mask-type", "alpha")
  const shape = document.createElementNS(ns, "use")
  shape.setAttribute("href", `${sprite}#${name}`)
  mask.appendChild(shape)
  defs.appendChild(mask)
  svg.appendChild(defs)
  const rect = document.createElementNS(ns, "rect")
  rect.setAttribute("width", "100%")
  rect.setAttribute("height", "100%")
  rect.setAttribute("fill", "currentColor")
  rect.setAttribute("mask", `url(#${id})`)
  svg.appendChild(rect)
  code.insertBefore(svg, code.firstChild)
}

function markFileLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null
    if (parentLink) continue
    const path = filePath(code.textContent ?? "")
    if (!path) continue
    const element = code as HTMLElement
    element.setAttribute("data-file-open", "")
    element.setAttribute("data-file-path", path)
    element.style.cursor = "pointer"
    attachFileIcon(element, path, "file")
  }
}

/** 目录 chip：只加图标，不加 data-file-open —— 点开目录会开出空标签。 */
function markDirIcons(root: HTMLDivElement) {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(":not(pre) > code"))) {
    if (element.hasAttribute("data-file-open")) continue
    const path = dirPath(element.textContent ?? "")
    if (!path) continue
    attachFileIcon(element, path, "directory")
  }
}

function setupFileOpen(root: HTMLDivElement, onFileOpen: ((path: string) => void) | undefined) {
  if (!onFileOpen) return

  const handler = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const node = target.closest("[data-file-open]")
    if (!(node instanceof HTMLElement)) return
    const path = node.getAttribute("data-file-path")
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    onFileOpen(path)
  }

  root.addEventListener("click", handler)
  return () => {
    root.removeEventListener("click", handler)
  }
}

/**
 * 任务列表复选框：marked 输出的是 `disabled` 的复选框，阅读时点不动。
 * 宿主提供 `onTaskToggle` 时去掉 disabled，并给每个框标上序号（按文档顺序），
 * 点击时把序号交回去 —— 宿主据此改对应那一行的 `[ ]` / `[x]`。
 */
function markTaskBoxes(root: HTMLDivElement) {
  const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  boxes.forEach((box, index) => {
    box.removeAttribute("disabled")
    box.setAttribute("data-task-index", String(index))
    box.style.cursor = "pointer"
  })
}

function setupTaskToggle(root: HTMLDivElement, onTaskToggle: ((index: number) => void) | undefined) {
  if (!onTaskToggle) return

  const handler = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return
    const raw = target.getAttribute("data-task-index")
    if (raw === null) return
    event.preventDefault()
    event.stopPropagation()
    onTaskToggle(Number(raw))
  }

  root.addEventListener("click", handler)
  return () => {
    root.removeEventListener("click", handler)
  }
}

function setupLinkOpen(root: HTMLDivElement, onLinkOpen: ((url: string) => boolean | void) | undefined) {
  if (!onLinkOpen) return

  const handler = (event: MouseEvent) => {
    // Keep the browser's normal new-tab behavior for modified clicks. Plain
    // primary clicks are the ones the host can route into its embedded browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const node = target.closest("a[href]")
    if (!(node instanceof HTMLAnchorElement)) return
    const rawHref = node.getAttribute("href")?.trim() ?? ""
    if (!rawHref || rawHref.startsWith("#")) return
    const href = node.href
    if (!href) return

    const handled = onLinkOpen(href)
    if (handled !== false) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  root.addEventListener("click", handler)
  return () => {
    root.removeEventListener("click", handler)
  }
}

/**
 * `[[wikilink]]`：链接目标交给调用方按当前文件所在目录解析成真实路径。
 */
function setupWikiLinks(root: HTMLDivElement, onWikiLink: ((target: string) => void) | undefined) {
  if (!onWikiLink) return

  const handler = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const node = target.closest("[data-wikilink]")
    if (!(node instanceof HTMLElement)) return
    const value = node.getAttribute("data-wikilink")
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    onWikiLink(value)
  }

  root.addEventListener("click", handler)
  return () => {
    root.removeEventListener("click", handler)
  }
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("data-tooltip", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function decorate(
  root: HTMLDivElement,
  labels: CopyLabels,
  openImagePreview: (url: string, alt?: string) => void,
  onFileOpen?: (path: string) => void,
) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
  markCodeLinks(root)
  if (onFileOpen) markFileLinks(root)
  markDirIcons(root)
  setupImagePreview(root, openImagePreview)
  setupMediaActions(root, labels)
}

function setupImagePreview(root: HTMLDivElement, openImagePreview: (url: string, alt?: string) => void) {
  const images = Array.from(root.querySelectorAll("img"))
  for (const img of images) {
    img.style.cursor = "pointer"
  }
  const handler = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLImageElement)) return
    openImagePreview(target.src, target.alt)
  }
  root.addEventListener("click", handler)
  return () => {
    root.removeEventListener("click", handler)
  }
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function createMediaButton(iconPath: string, label: string, onClick: () => void) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("aria-label", label)
  button.style.display = "flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.padding = "4px"
  button.style.background = "color-mix(in srgb, var(--surface-raised-strong) 88%, transparent)"
  button.style.color = "var(--foreground)"
  button.style.border = "none"
  button.style.borderRadius = "4px"
  button.style.cursor = "pointer"
  button.appendChild(createIcon(iconPath, "icon"))
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    onClick()
  })
  return button
}

function createMediaToolbar(url: string, kind: "image" | "video", labels: CopyLabels) {
  const toolbar = document.createElement("div")
  toolbar.setAttribute("data-slot", "markdown-media-toolbar")
  toolbar.style.position = "absolute"
  toolbar.style.bottom = "8px"
  toolbar.style.right = "8px"
  toolbar.style.display = "flex"
  toolbar.style.gap = "6px"
  toolbar.style.opacity = "0"
  toolbar.style.transition = "opacity 0.15s ease"
  toolbar.style.zIndex = "10"

  const copyLabel = kind === "video" ? labels.copyVideo : labels.copyImage
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined
  const copyButton = createMediaButton(iconPaths.copy, copyLabel, async () => {
    if (await copyMediaToClipboard(url, kind)) {
      copyButton.innerHTML = ""
      copyButton.appendChild(createIcon(iconPaths.check, "icon"))
      copyButton.setAttribute("aria-label", labels.copied)
      if (copiedTimeout) clearTimeout(copiedTimeout)
      copiedTimeout = setTimeout(() => {
        copyButton.innerHTML = ""
        copyButton.appendChild(createIcon(iconPaths.copy, "icon"))
        copyButton.setAttribute("aria-label", copyLabel)
      }, 2000)
    }
  })
  toolbar.appendChild(copyButton)

  const downloadButton = createMediaButton(iconPaths.download, labels.download, () => {
    const fallback = kind === "video" ? "video.mp4" : "image.png"
    void downloadFile(url, filenameFromUrl(url, fallback))
  })
  toolbar.appendChild(downloadButton)

  return toolbar
}

function wrapMediaElement(element: HTMLImageElement | HTMLVideoElement, labels: CopyLabels) {
  if (element.parentElement?.getAttribute("data-component") === "markdown-media") return
  const url = element.src
  const kind = element instanceof HTMLImageElement ? "image" : "video"
  const container = document.createElement("div")
  container.setAttribute("data-component", "markdown-media")
  container.style.position = "relative"
  container.style.display = "inline-block"
  container.style.maxWidth = "100%"
  element.parentNode?.replaceChild(container, element)
  container.appendChild(element)
  const toolbar = createMediaToolbar(url, kind, labels)
  container.appendChild(toolbar)
  container.addEventListener("mouseenter", () => {
    toolbar.style.opacity = "1"
  })
  container.addEventListener("mouseleave", () => {
    toolbar.style.opacity = "0"
  })
}

function setupMediaActions(root: HTMLDivElement, labels: CopyLabels) {
  const images = Array.from(root.querySelectorAll("img"))
  const videos = Array.from(root.querySelectorAll("video"))
  for (const img of images) wrapMediaElement(img, labels)
  for (const video of videos) wrapMediaElement(video, labels)
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    class?: string
    classList?: Record<string, boolean>
    onFileOpen?: (path: string) => void
    /** Open a rendered link through the host application instead of navigating the page. */
    onLinkOpen?: (url: string) => boolean | void
    /** 点 `[[wikilink]]`：目标原样交回去，由调用方解析成工作区路径。 */
    onWikiLink?: (target: string) => void
    /** 点任务列表复选框：序号按渲染结果里的顺序（0 起）。 */
    onTaskToggle?: (index: number) => void
  },
) {
  const [local, others] = splitProps(props, [
    "text",
    "cacheKey",
    "streaming",
    "class",
    "classList",
    "onFileOpen",
    "onLinkOpen",
    "onWikiLink",
    "onTaskToggle",
  ])
  const marked = useMarked()
  const i18n = useI18n()
  const dialog = useDialog()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  let previousPlainRender: ReturnType<typeof plainStreamingRender>
  const plainRender = createMemo(() => {
    if (!local.streaming) {
      previousPlainRender = undefined
      return undefined
    }
    const render = plainStreamingRender(local.text, previousPlainRender)
    previousPlainRender = render
    return render
  })
  const [html] = createResource(
    () => {
      if (plainRender()) return false
      return {
        text: local.text,
        key: local.cacheKey,
        streaming: local.streaming ?? false,
      }
    },
    (src) => {
      if (isServer) return fallback(src.text)
      if (!src.text) return ""

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        stream(src.text, src.streaming).map(async (block, index) => {
          const hash = checksum(block.raw)
          const key = base ? `${base}:${index}:${block.mode}` : hash

          if (key && hash) {
            const cached = cache.get(key)
            if (cached && cached.hash === hash) {
              touch(key, cached)
              return cached.html
            }
          }

          const next = await Promise.resolve(marked.parse(block.src))
          const safe = sanitize(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .then((list) => list.join(""))
        .catch(() => fallback(src.text))
    },
    { initialValue: fallback(local.text) },
  )

  // Until an async parse settles, `html.latest` can still be the last rendered value.
  // The raw text may change many times without changing the HTML we should paint.
  const displayedHtml = createMemo(() => {
    if (!local.text) return ""
    return plainRender()?.html ?? html.latest ?? html() ?? ""
  })

  const openImagePreview = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }

  let copyCleanup: (() => void) | undefined
  let imagePreviewCleanup: (() => void) | undefined
  let fileOpenCleanup: (() => void) | undefined
  let linkOpenCleanup: (() => void) | undefined
  let wikiOpenCleanup: (() => void) | undefined
  let taskCleanup: (() => void) | undefined
  let previousPlainParagraphCount = 0
  let previousPlainPrefix = ""

  createEffect(() => {
    const container = root()
    const content = displayedHtml()
    const plain = plainRender()
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      previousPlainParagraphCount = 0
      previousPlainPrefix = ""
      return
    }

    if (
      plain &&
      plain.paragraphCount > 0 &&
      plain.paragraphCount === previousPlainParagraphCount &&
      content.startsWith(previousPlainPrefix) &&
      container.lastElementChild instanceof HTMLParagraphElement
    ) {
      container.lastElementChild.textContent = plain.tailText
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
      copyImage: i18n.t("ui.message.copyImage"),
      copyVideo: i18n.t("ui.message.copyVideo"),
      download: i18n.t("ui.message.download"),
    }
    const temp = document.createElement("div")
    temp.innerHTML = content
    decorate(temp, labels, openImagePreview, local.onFileOpen)

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (
          fromEl instanceof HTMLButtonElement &&
          toEl instanceof HTMLButtonElement &&
          fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
          toEl.getAttribute("data-slot") === "markdown-copy-button" &&
          fromEl.getAttribute("data-copied") === "true"
        ) {
          setCopyState(toEl, labels, true)
        }
        if (fromEl.isEqualNode(toEl)) return false
        return true
      },
    })
    previousPlainParagraphCount = plain?.paragraphCount ?? 0
    const lastParagraphStart = plain ? content.lastIndexOf("<p>") : -1
    previousPlainPrefix = lastParagraphStart >= 0 ? content.slice(0, lastParagraphStart) : ""

    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
        copyImage: i18n.t("ui.message.copyImage"),
        copyVideo: i18n.t("ui.message.copyVideo"),
        download: i18n.t("ui.message.download"),
      }))
    if (!imagePreviewCleanup) imagePreviewCleanup = setupImagePreview(container, openImagePreview)
    if (!fileOpenCleanup) fileOpenCleanup = setupFileOpen(container, local.onFileOpen)
    if (!linkOpenCleanup) linkOpenCleanup = setupLinkOpen(container, local.onLinkOpen)
    if (!wikiOpenCleanup) wikiOpenCleanup = setupWikiLinks(container, local.onWikiLink)
    if (local.onTaskToggle) markTaskBoxes(container)
    if (!taskCleanup) taskCleanup = setupTaskToggle(container, local.onTaskToggle)
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (imagePreviewCleanup) imagePreviewCleanup()
    if (fileOpenCleanup) fileOpenCleanup()
    if (linkOpenCleanup) linkOpenCleanup()
    if (wikiOpenCleanup) wikiOpenCleanup()
    if (taskCleanup) taskCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
