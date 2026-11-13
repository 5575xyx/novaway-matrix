import type { Component, JSX } from "solid-js"
import { createMemo, createUniqueId, splitProps } from "solid-js"
import sprite from "./file-icons/sprite.svg"
import { chooseIconName } from "./file-icons/choose"

/**
 * 文件图标配色：单色剪影 + 按类型给一个冷色。
 *
 * 原来直接渲染 sprite 里的彩色图形（Material File Icons 那套），一屏十几个色相，
 * 观感偏"贴纸"。这里只取图形轮廓（mask）再染一个克制的冷色，色相收敛到 6 个；
 * `mono` 仍然走 `currentColor`，供标签栏"未激活灰、激活上色"的两层叠放使用。
 */
type FileIconCategory = "code" | "doc" | "data" | "style" | "shell" | "plain"

const EXTENSIONS: Record<Exclude<FileIconCategory, "plain">, string[]> = {
  code: [
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "vue",
    "svelte",
    "py",
    "rb",
    "php",
    "go",
    "rs",
    "java",
    "kt",
    "kts",
    "swift",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "scala",
    "dart",
    "lua",
    "pl",
    "pm",
    "r",
    "zig",
    "ex",
    "exs",
    "erl",
    "hs",
    "ml",
    "clj",
    "groovy",
    "v",
    "dhall",
    "purs",
  ],
  doc: [
    "md",
    "markdown",
    "mdx",
    "txt",
    "text",
    "rst",
    "adoc",
    "asciidoc",
    "org",
    "rtf",
    "doc",
    "docx",
    "pdf",
    "odt",
    "pages",
    "epub",
    "tex",
    "bib",
  ],
  data: [
    "json",
    "jsonc",
    "json5",
    "ndjson",
    "jsonl",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "properties",
    "xml",
    "plist",
    "csv",
    "tsv",
    "xls",
    "xlsx",
    "ods",
    "parquet",
    "avro",
    "db",
    "sqlite",
    "sqlite3",
    "lock",
    "gradle",
    "sql",
    "prisma",
    "graphql",
    "gql",
    "proto",
    "avsc",
  ],
  style: [
    "css",
    "scss",
    "sass",
    "less",
    "styl",
    "pcss",
    "svg",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "avif",
    "bmp",
    "tiff",
    "ico",
    "icns",
    "heic",
    "mp4",
    "mov",
    "avi",
    "mkv",
    "webm",
    "wmv",
    "flv",
    "mp3",
    "wav",
    "flac",
    "ogg",
    "oga",
    "m4a",
    "aac",
    "opus",
    "aiff",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    "ppt",
    "pptx",
    "odp",
    "key",
  ],
  shell: [
    "sh",
    "bash",
    "zsh",
    "fish",
    "ksh",
    "ps1",
    "psm1",
    "bat",
    "cmd",
    "dockerfile",
    "makefile",
    "mk",
    "bazel",
    "bzl",
    "nix",
    "justfile",
    "envrc",
  ],
}

// 主题 token 尚未落地时也用独立的文件类别语义色兜底，避免串用 Agent、状态或语法色。
const FALLBACK: Record<FileIconCategory, string> = {
  code: "var(--icon-file-category-0)",
  doc: "var(--icon-file-category-1)",
  data: "var(--icon-file-category-2)",
  style: "var(--icon-file-category-3)",
  shell: "var(--icon-file-category-3)",
  plain: "var(--foreground-subtle)",
}

const buckets = new Map<string, FileIconCategory>()
for (const [category, list] of Object.entries(EXTENSIONS) as [Exclude<FileIconCategory, "plain">, string[]][]) {
  for (const extension of list) buckets.set(extension, category)
}

/** 目录、无扩展名文件与未知类型都落 `plain`；`Dockerfile` 这类靠整名命中。 */
export const fileIconCategory = (path: string, type: "file" | "directory" = "file"): FileIconCategory => {
  if (type === "directory") return "plain"
  const name = path.split(/[/\\]/).pop() ?? ""
  const dot = name.lastIndexOf(".")
  const key = (dot > 0 ? name.slice(dot + 1) : name).toLowerCase()
  return buckets.get(key) ?? "plain"
}

export const fileIconColor = (path: string, type: "file" | "directory" = "file") => {
  const category = fileIconCategory(path, type)
  return `var(--file-icon-${category}, ${FALLBACK[category]})`
}

export type FileIconProps = JSX.GSVGAttributes<SVGSVGElement> & {
  node: { path: string; type: "file" | "directory" }
  expanded?: boolean
  mono?: boolean
}

export const FileIcon: Component<FileIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["node", "class", "classList", "expanded", "mono"])
  const name = createMemo(() => chooseIconName(local.node.path, local.node.type, local.expanded || false))
  const id = `file-icon-mono-${createUniqueId()}`
  return (
    <svg
      data-component="file-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <defs>
        <mask id={id} mask-type="alpha">
          <use href={`${sprite}#${name()}`} />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={local.mono ? "currentColor" : fileIconColor(local.node.path, local.node.type)}
        mask={`url(#${id})`}
      />
    </svg>
  )
}
