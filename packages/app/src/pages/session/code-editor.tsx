import { createEffect, onCleanup, onMount, type Component } from "solid-js"
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { defaultKeymap } from "@codemirror/commands"
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  StreamLanguage,
  bracketMatching,
} from "@codemirror/language"
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state"
import { linter, type Diagnostic } from "@codemirror/lint"
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { syntaxLanguageOf } from "@novaway/core/office/text/language"

export type CodeEditorHandle = {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  scrollTop: number
  scrollLeft: number
  focus: () => void
  setSelectionRange: (start: number, end: number) => void
  getBoundingClientRect: () => DOMRect
}

type CodeEditorSelection = { anchor: number; head: number }

type Props = {
  value: string
  path?: string
  readOnly?: boolean
  fontZoom?: number
  onReady?: (handle: CodeEditorHandle) => void
  onChange?: (value: string, selection: CodeEditorSelection) => void
  onSelectionChange?: (selection: CodeEditorSelection) => void
  onScroll?: (position: { top: number; left: number }) => void
  onMouseDown?: (event: MouseEvent) => void
  onMouseUp?: (event: MouseEvent) => void
  onContextMenu?: (event: MouseEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onBlur?: () => void
  onRequestDiagnostics?: (text: string) => Promise<Diagnostic[]>
}

async function languageOf(path: string | undefined): Promise<Extension> {
  switch (syntaxLanguageOf(path)) {
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript")
      return javascript({ typescript: true })
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript")
      return javascript({ typescript: true, jsx: true })
    }
    case "javascript":
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript")
      return javascript({ jsx: true })
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python")
      return python()
    }
    case "bash":
    case "sh":
    case "zsh": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell")
      return StreamLanguage.define(shell)
    }
    case "powershell": {
      const { powerShell } = await import("@codemirror/legacy-modes/mode/powershell")
      return StreamLanguage.define(powerShell)
    }
    case "ruby": {
      const { ruby } = await import("@codemirror/legacy-modes/mode/ruby")
      return StreamLanguage.define(ruby)
    }
    case "lua": {
      const { lua } = await import("@codemirror/legacy-modes/mode/lua")
      return StreamLanguage.define(lua)
    }
    case "dart": {
      const { dart } = await import("@codemirror/legacy-modes/mode/clike")
      return StreamLanguage.define(dart)
    }
    case "scala": {
      const { scala } = await import("@codemirror/legacy-modes/mode/clike")
      return StreamLanguage.define(scala)
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust")
      return rust()
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go")
      return go()
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java")
      return java()
    }
    case "kotlin": {
      const { kotlin } = await import("@codemirror/legacy-modes/mode/clike")
      return StreamLanguage.define(kotlin)
    }
    case "c":
    case "cpp": {
      const { cpp } = await import("@codemirror/lang-cpp")
      return cpp()
    }
    case "csharp": {
      const { csharp } = await import("@codemirror/legacy-modes/mode/clike")
      return StreamLanguage.define(csharp)
    }
    case "css":
    case "scss":
    case "less": {
      const { css } = await import("@codemirror/lang-css")
      return css()
    }
    case "html":
    case "vue":
    case "svelte":
    case "astro": {
      const { html } = await import("@codemirror/lang-html")
      return html()
    }
    case "json":
    case "jsonc":
    case "json5": {
      const { json } = await import("@codemirror/lang-json")
      return json()
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown")
      return markdown()
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql")
      return sql()
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml")
      return xml()
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml")
      return yaml()
    }
    default:
      return []
  }
}

function completionSource(path: string | undefined) {
  const language = syntaxLanguageOf(path)
  const common = [
    "const",
    "let",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "import",
    "from",
    "export",
    "async",
    "await",
    "class",
    "interface",
    "type",
  ]
  const keywordOptions = (
    language === "python"
      ? ["def", "class", "import", "from", "return", "async", "await", "True", "False", "None", "with", "yield"]
      : language === "rust"
        ? ["fn", "let", "mut", "impl", "struct", "enum", "trait", "match", "use", "pub", "async", "await"]
        : language === "go"
          ? ["func", "package", "import", "type", "struct", "interface", "defer", "go", "chan", "select"]
          : common
  ).map((label) => ({ label, type: "keyword" as const }))

  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_$][\w$]*/)
    if (!word && !context.explicit) return null

    // 除语言关键字外，把当前文件里已经出现的标识符也作为本地补全候选，
    // 这样函数、变量、类型名和 import 名称可以直接用 Tab 接受，不必等待 LSP。
    const identifiers = new Set<string>()
    for (const match of context.state.doc.toString().matchAll(/[A-Za-z_$][\w$]{2,}/g)) {
      const label = match[0]
      if (!keywordOptions.some((item) => item.label === label)) identifiers.add(label)
    }
    const localOptions = [...identifiers]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 120)
      .map((label) => ({ label, type: "variable" as const }))

    return {
      from: word?.from ?? context.pos,
      options: [...keywordOptions, ...localOptions],
      validFor: /^[A-Za-z_$][\w$]*$/,
    }
  }
}

function jsonDiagnostics(text: string): Diagnostic[] {
  const normalized = text
    .replace(/\/\*[\s\S]*?\*\//g, (value) => " ".repeat(value.length))
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
  try {
    JSON.parse(normalized)
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 语法错误"
    const match = message.match(/position (\d+)/i)
    const position = match ? Number(match[1]) : Math.max(0, text.length - 1)
    return [
      { from: Math.min(position, text.length), to: Math.min(position + 1, text.length), severity: "error", message },
    ]
  }
}

function yamlDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const keys = new Map<string, number>()
  let offset = 0
  for (const line of text.split("\n")) {
    const leading = line.match(/^\s*/)?.[0] ?? ""
    if (leading.includes("\t")) {
      diagnostics.push({
        from: offset,
        to: offset + leading.length,
        severity: "error",
        message: "YAML 缩进不能使用 Tab，请改用空格",
      })
    }
    const key = line.match(/^\s*([^#][^:]*):(?:\s|$)/)?.[1]?.trim()
    if (key) {
      const previous = keys.get(key)
      if (previous !== undefined) {
        diagnostics.push({
          from: offset,
          to: offset + Math.max(1, key.length),
          severity: "warning",
          message: `重复的 YAML 键：${key}`,
        })
      }
      keys.set(key, offset)
    }
    offset += line.length + 1
  }
  return diagnostics
}

function diagnosticsFor(view: EditorView, path: string | undefined): Diagnostic[] {
  const language = syntaxLanguageOf(path)
  const text = view.state.doc.toString()
  if (language === "json" || language === "jsonc" || language === "json5") return jsonDiagnostics(text)
  if (language === "yaml") return yamlDiagnostics(text)
  return []
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--foreground)",
    backgroundColor: "transparent",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "24px",
  },
  ".cm-content": {
    padding: "16px 16px 16px 0",
    caretColor: "var(--foreground)",
    minHeight: "100%",
  },
  ".cm-line": { padding: "0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--foreground-subtle)",
    border: "0",
    paddingRight: "8px",
    minWidth: "48px",
  },
  ".cm-gutterElement": {
    padding: "0 8px 0 0",
    minWidth: "40px",
    textAlign: "right",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--surface-interactive-weak) 32%, transparent)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--surface-interactive-base) 32%, transparent) !important",
  },
  ".cm-foldGutter": { width: "16px" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--foreground-subtle)",
    margin: "0 4px",
    padding: "0 4px",
  },
})

export const CodeEditor: Component<Props> = (props) => {
  let host!: HTMLDivElement
  let view: EditorView | undefined
  let syncing = false
  let lastScroll = { top: 0, left: 0 }
  let diagnosticsSequence = 0
  let languageSequence = 0
  const languageCompartment = new Compartment()
  const editableCompartment = new Compartment()

  const languageExtensions = (path: string | undefined, language: Extension = []) => [
    language,
    autocompletion({ override: [completionSource(path)], activateOnTyping: true }),
  ]

  const openCompletionIfFocused = () => {
    if (props.readOnly) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (view?.hasFocus) startCompletion(view)
      })
    })
  }

  const loadLanguage = async (path: string | undefined) => {
    const sequence = ++languageSequence
    const language = await languageOf(path)
    if (!view || sequence !== languageSequence) return
    view.dispatch({ effects: languageCompartment.reconfigure(languageExtensions(path, language)) })
    // 动态语言包加载可能晚于第一次 focus；重新打开一次，避免候选框被语言重配置关闭。
    openCompletionIfFocused()
  }

  const editableExtensions = (readOnly: boolean) => [
    EditorView.editable.of(!readOnly),
    EditorState.readOnly.of(readOnly),
  ]

  const selectionOf = (): CodeEditorSelection => {
    const main = view?.state.selection.main
    return { anchor: main?.anchor ?? 0, head: main?.head ?? 0 }
  }

  const handle: CodeEditorHandle = {
    get value() {
      return view?.state.doc.toString() ?? props.value
    },
    get selectionStart() {
      const selection = selectionOf()
      return Math.min(selection.anchor, selection.head)
    },
    get selectionEnd() {
      const selection = selectionOf()
      return Math.max(selection.anchor, selection.head)
    },
    get scrollTop() {
      return view?.scrollDOM.scrollTop ?? 0
    },
    set scrollTop(value: number) {
      if (view) view.scrollDOM.scrollTop = value
    },
    get scrollLeft() {
      return view?.scrollDOM.scrollLeft ?? 0
    },
    set scrollLeft(value: number) {
      if (view) view.scrollDOM.scrollLeft = value
    },
    focus() {
      view?.focus()
    },
    setSelectionRange(start: number, end: number) {
      if (!view) return
      const length = view.state.doc.length
      const anchor = Math.max(0, Math.min(length, start))
      const head = Math.max(0, Math.min(length, end))
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(head, { y: "nearest" }),
      })
      view.focus()
    },
    getBoundingClientRect() {
      return view?.dom.getBoundingClientRect() ?? host.getBoundingClientRect()
    },
  }

  onMount(() => {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet) props.onSelectionChange?.(selectionOf())
      if (update.docChanged && !syncing) {
        props.onChange?.(view!.state.doc.toString(), selectionOf())
      }
      if (update.viewportChanged || update.geometryChanged) {
        const scroll = view!.scrollDOM
        const next = { top: scroll.scrollTop, left: scroll.scrollLeft }
        if (next.top !== lastScroll.top || next.left !== lastScroll.left) {
          lastScroll = next
          props.onScroll?.(next)
        }
      }
    })

    view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          rectangularSelection(),
          indentOnInput(),
          closeBrackets(),
          bracketMatching(),
          highlightSpecialChars(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.of(languageExtensions(props.path)),
          linter(
            (view) => {
              const local = diagnosticsFor(view, props.path)
              if (!props.onRequestDiagnostics) return local
              const sequence = ++diagnosticsSequence
              return props
                .onRequestDiagnostics(view.state.doc.toString())
                .then((remote) => (sequence === diagnosticsSequence ? [...local, ...remote] : local))
                .catch(() => local)
            },
            { delay: 350 },
          ),
          editorTheme,
          Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
          keymap.of([...completionKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...foldKeymap]),
          updateListener,
          editableCompartment.of(editableExtensions(!!props.readOnly)),
        ],
      }),
      parent: host,
    })
    props.onReady?.(handle)
    props.onSelectionChange?.(selectionOf())
    props.onScroll?.({ top: 0, left: 0 })

    const onFocusIn = () => {
      openCompletionIfFocused()
    }
    host.addEventListener("focusin", onFocusIn)

    onCleanup(() => {
      host.removeEventListener("focusin", onFocusIn)
      view?.destroy()
      view = undefined
    })
  })

  createEffect(() => {
    const nextPath = props.path
    if (!view) return
    void loadLanguage(nextPath)
  })

  createEffect(() => {
    const readOnly = !!props.readOnly
    if (!view) return
    view.dispatch({ effects: editableCompartment.reconfigure(editableExtensions(readOnly)) })
  })

  createEffect(() => {
    const next = props.value
    if (!view || next === view.state.doc.toString()) return
    syncing = true
    const current = view.state.selection.main
    const position = Math.min(next.length, current.head)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: position } })
    syncing = false
  })

  createEffect(() => {
    const zoom = props.fontZoom ?? 100
    host.style.fontSize = `${13 * (zoom / 100)}px`
  })

  return (
    <div
      ref={host}
      class="h-full w-full overflow-hidden bg-background"
      classList={{ "cm-readonly": !!props.readOnly }}
      data-component="code-editor"
      onMouseDown={(event) => props.onMouseDown?.(event)}
      onMouseUp={(event) => props.onMouseUp?.(event)}
      onContextMenu={(event) => props.onContextMenu?.(event)}
      onKeyDown={(event) => props.onKeyDown?.(event)}
      onBlur={() => props.onBlur?.()}
    />
  )
}
