type OmmlNode =
  | { kind: "run"; value: string }
  | { kind: "frac"; numerator: OmmlNode[]; denominator: OmmlNode[] }
  | { kind: "sup"; base: OmmlNode[]; superscript: OmmlNode[] }
  | { kind: "sub"; base: OmmlNode[]; subscript: OmmlNode[] }
  | { kind: "subsup"; base: OmmlNode[]; subscript: OmmlNode[]; superscript: OmmlNode[] }
  | { kind: "nary"; operator: string; subscript: OmmlNode[]; superscript: OmmlNode[]; base: OmmlNode[] }
  | { kind: "limLow"; base: OmmlNode[]; limit: OmmlNode[] }
  | { kind: "limUpp"; base: OmmlNode[]; limit: OmmlNode[] }
  | { kind: "bar"; position: "top" | "bottom"; body: OmmlNode[] }
  | { kind: "acc"; char: string; body: OmmlNode[] }
  | { kind: "rad"; index?: OmmlNode[]; radicand: OmmlNode[] }
  | { kind: "delim"; left: string; body: OmmlNode[]; right: string }
  | { kind: "matrix"; rows: OmmlNode[][][]; left?: string; right?: string }

type NaryNode = Extract<OmmlNode, { kind: "nary" }>

export type FormulaSegment =
  | { kind: "text"; value: string }
  | { kind: "inline"; latex: string }
  | { kind: "block"; latex: string }

const a14Namespace = "http://schemas.microsoft.com/office/drawing/2010/main"
const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math"

const naryOperators = new Set(["∑", "∏", "∫", "∬", "∭", "∮"])
const limitOperators = new Set(["lim", "max", "min", "sup", "inf", "det", "argmax", "argmin"])
const accentChars: Record<string, string> = {
  hat: "^",
  widehat: "^",
  tilde: "~",
  widetilde: "~",
  vec: "→",
  dot: "˙",
  ddot: "¨",
  acute: "´",
  grave: "`",
  check: "ˇ",
  breve: "˘",
}
const delimiterSymbols: Record<string, string> = {
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lbrace: "{",
  rbrace: "}",
  lbrack: "[",
  rbrack: "]",
  lvert: "|",
  rvert: "|",
  Vert: "‖",
  lVert: "‖",
  rVert: "‖",
  uparrow: "↑",
  downarrow: "↓",
  updownarrow: "↕",
}

const greekSymbols: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
}

const mathSymbols: Record<string, string> = {
  times: "×",
  cdot: "⋅",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  circ: "∘",
  bullet: "∙",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  equiv: "≡",
  approx: "≈",
  propto: "∝",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  neg: "¬",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  mapsto: "↦",
  triangle: "△",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  degree: "°",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  emptyset: "∅",
  varnothing: "∅",
  because: "∵",
  therefore: "∴",
  lim: "lim",
  max: "max",
  min: "min",
  sup: "sup",
  inf: "inf",
  det: "det",
  argmax: "argmax",
  argmin: "argmin",
}

function splitFormulaSegments(text: string): FormulaSegment[] {
  const result: FormulaSegment[] = []
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([^\\\n]+?\\\))/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) result.push({ kind: "text", value: text.slice(cursor, start) })
    const raw = match[0]
    const block = raw.startsWith("$$") || raw.startsWith("\\[")
    const latex = raw
      .replace(/^\$\$/, "")
      .replace(/\$\$$/, "")
      .replace(/^\$/, "")
      .replace(/\$$/, "")
      .replace(/^\\\[/, "")
      .replace(/\\\]$/, "")
      .replace(/^\\\(/, "")
      .replace(/\\\)$/, "")
    result.push({ kind: block ? "block" : "inline", latex: latex.trim() })
    cursor = start + raw.length
  }
  if (cursor < text.length) result.push({ kind: "text", value: text.slice(cursor) })
  return result
}

function latexToOMath(latex: string): string {
  return serializeNodes(parseLatex(latex))
}

export function ommlMathXml(latex: string, block = false): string {
  const math = `<m:oMath>${latexToOMath(latex)}</m:oMath>`
  if (!block) return `<a14:m xmlns:a14="${a14Namespace}" xmlns:m="${mathNamespace}">${math}</a14:m>`
  return `<a14:m xmlns:a14="${a14Namespace}" xmlns:m="${mathNamespace}"><m:oMathPara>${math}</m:oMathPara></a14:m>`
}

export function ommlWordXml(latex: string, block = false): string {
  const inner = latexToOMath(latex)
  if (!block) return `<m:oMath xmlns:m="${mathNamespace}">${inner}</m:oMath>`
  return `<m:oMathPara xmlns:m="${mathNamespace}"><m:oMath>${inner}</m:oMath></m:oMathPara>`
}

export { splitFormulaSegments }

function parseLatex(input: string): OmmlNode[] {
  let cursor = 0
  return parseNodes()

  function parseNodes(stopAtRight = false, stopAtCell = false, stopAtEnd = false): OmmlNode[] {
    const nodes: OmmlNode[] = []
    let pendingNary: NaryNode | undefined
    while (cursor < input.length) {
      const char = input[cursor]
      if (char === "}") break
      if (stopAtRight && char === "\\" && input.startsWith("\\right", cursor)) break
      if (stopAtEnd && char === "\\" && input.startsWith("\\end", cursor)) break
      if (stopAtCell && (char === "&" || (char === "\\" && input.startsWith("\\\\", cursor)))) break
      if (pendingNary && char !== "^" && char !== "_") {
        pendingNary.base = parseNodes(stopAtRight, stopAtCell, stopAtEnd)
        pendingNary = undefined
        continue
      }
      if (char === "{") {
        cursor += 1
        nodes.push(...parseNodes())
        if (input[cursor] === "}") cursor += 1
        continue
      }
      if (char === " ") {
        cursor += 1
        continue
      }
      if (char === "^" || char === "_") {
        const isSup = char === "^"
        cursor += 1
        const script = readGroup()
        const last = nodes.pop()
        if (!last) {
          nodes.push(
            isSup ? { kind: "sup", base: [], superscript: script } : { kind: "sub", base: [], subscript: script },
          )
          continue
        }
        if (last.kind === "nary") {
          if (isSup) last.superscript = script
          else last.subscript = script
          pendingNary = last
          nodes.push(last)
          continue
        }
        if (last.kind === "run" && limitOperators.has(last.value)) {
          nodes.push(
            isSup ? { kind: "limUpp", base: [last], limit: script } : { kind: "limLow", base: [last], limit: script },
          )
          continue
        }
        if (last.kind === "run" && naryOperators.has(last.value)) {
          const nary: NaryNode = {
            kind: "nary",
            operator: last.value,
            subscript: isSup ? [] : script,
            superscript: isSup ? script : [],
            base: [],
          }
          pendingNary = nary
          nodes.push(nary)
          continue
        }
        if (isSup && last.kind === "sub") {
          nodes.push({
            kind: "subsup",
            base: last.base,
            subscript: last.subscript,
            superscript: script,
          })
          continue
        }
        if (!isSup && last.kind === "sup") {
          nodes.push({
            kind: "subsup",
            base: last.base,
            subscript: script,
            superscript: last.superscript,
          })
          continue
        }
        nodes.push(
          isSup ? { kind: "sup", base: [last], superscript: script } : { kind: "sub", base: [last], subscript: script },
        )
        continue
      }
      if (char === "\\") {
        parseCommand(nodes, stopAtRight)
        continue
      }
      appendRun(nodes, char)
      cursor += 1
    }
    return nodes
  }

  function readGroup(): OmmlNode[] {
    while (input[cursor] === " ") cursor += 1
    if (input[cursor] !== "{") return readSingleAtom()
    cursor += 1
    const nodes = parseNodes()
    if (input[cursor] === "}") cursor += 1
    return nodes
  }

  function readRawGroup(): string {
    if (input[cursor] !== "{") return ""
    cursor += 1
    let depth = 1
    let value = ""
    while (cursor < input.length && depth > 0) {
      const char = input[cursor]
      if (char === "{") depth += 1
      if (char === "}") {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
      value += char
      cursor += 1
    }
    return value
  }

  function readSingleAtom(): OmmlNode[] {
    if (cursor >= input.length) return []
    if (input[cursor] === "\\") {
      const before = cursor
      const nodes: OmmlNode[] = []
      parseCommand(nodes, false)
      return before === cursor ? [] : nodes
    }
    const node: OmmlNode = { kind: "run", value: input[cursor] }
    cursor += 1
    return [node]
  }

  function parseCommand(nodes: OmmlNode[], stopAtRight: boolean) {
    const commandStart = cursor
    cursor += 1
    const nameStart = cursor
    while (cursor < input.length && /[A-Za-z]/.test(input[cursor] ?? "")) cursor += 1
    const name = input.slice(nameStart, cursor)
    if (!name) {
      if (cursor < input.length) {
        appendRun(nodes, input[cursor])
        cursor += 1
      }
      return
    }
    if (name === "right" && stopAtRight) {
      cursor = commandStart
      return
    }
    if (name === "frac") {
      const numerator = readGroup()
      const denominator = readGroup()
      nodes.push({ kind: "frac", numerator, denominator })
      return
    }
    if (name === "binom") {
      const numerator = readGroup()
      const denominator = readGroup()
      nodes.push({
        kind: "matrix",
        rows: [[numerator], [denominator]],
        left: "(",
        right: ")",
      })
      return
    }
    if (name === "sqrt") {
      let index: OmmlNode[] | undefined
      if (input[cursor] === "[") {
        cursor += 1
        const start = cursor
        while (cursor < input.length && input[cursor] !== "]") cursor += 1
        index = parseLatex(input.slice(start, cursor))
        if (input[cursor] === "]") cursor += 1
      }
      const radicand = readGroup()
      nodes.push({ kind: "rad", index, radicand })
      return
    }
    if (name === "overset" || name === "stackrel") {
      const over = readGroup()
      const base = readGroup()
      nodes.push({ kind: "limUpp", base, limit: over })
      return
    }
    if (name === "underset") {
      const under = readGroup()
      const base = readGroup()
      nodes.push({ kind: "limLow", base, limit: under })
      return
    }
    if (name === "overline" || name === "underline" || name === "bar") {
      nodes.push({
        kind: "bar",
        position: name === "underline" ? "bottom" : "top",
        body: readGroup(),
      })
      return
    }
    if (accentChars[name]) {
      nodes.push({
        kind: "acc",
        char: accentChars[name],
        body: readGroup(),
      })
      return
    }
    if (name === "left" || name === "right") {
      const delimiter = readDelimiter()
      if (name === "left") {
        const body = parseNodes(true)
        if (input.startsWith("\\right", cursor)) {
          cursor += "\\right".length
          const right = readDelimiter()
          nodes.push({ kind: "delim", left: delimiter, body, right })
        } else {
          nodes.push(...body)
        }
      }
      return
    }
    if (name === "text") {
      appendRun(nodes, readRawGroup())
      return
    }
    if (name === "mathrm" || name === "operatorname" || name === "mathbf") {
      nodes.push(...readGroup())
      return
    }
    const symbol = greekSymbols[name] ?? mathSymbols[name]
    if (symbol) {
      appendRun(nodes, symbol)
      return
    }
    if (name === "quad" || name === "qquad") {
      appendRun(nodes, name === "quad" ? "  " : "    ")
      return
    }
    if (name === "limits" || name === "nolimits" || name === "displaystyle" || name === "textstyle") {
      return
    }
    if (name === "," || name === ":" || name === ";" || name === "~") {
      appendRun(nodes, " ")
      return
    }
    if (name === "{" || name === "}") {
      appendRun(nodes, name === "{" ? "{" : "}")
      return
    }
    if (name === "begin" || name === "end") {
      const environment = readEnvironmentName()
      if (environment === "array" && input[cursor] === "{") readEnvironmentName()
      if (environment && isMatrixEnvironment(environment)) {
        const rows = parseEnvironmentBody()
        if (input.startsWith("\\end", cursor)) {
          cursor += "\\end".length
          readEnvironmentName()
        }
        const delimiters = matrixDelimiters[environment]
        nodes.push({
          kind: "matrix",
          rows,
          left: delimiters.left,
          right: delimiters.right,
        })
        return
      }
      if (environment) appendRun(nodes, `\\${name}{${environment}}`)
      return
    }
    appendRun(nodes, `\\${name}`)
  }

  function readEnvironmentName(): string | undefined {
    if (input[cursor] !== "{") return undefined
    cursor += 1
    const start = cursor
    while (cursor < input.length && input[cursor] !== "}") cursor += 1
    const environment = input.slice(start, cursor)
    if (input[cursor] === "}") cursor += 1
    return environment
  }

  function readDelimiter(): string {
    while (input[cursor] === " ") cursor += 1
    if (input[cursor] === ".") {
      cursor += 1
      return ""
    }
    if (input[cursor] === "\\") {
      cursor += 1
      const start = cursor
      while (cursor < input.length && /[A-Za-z]/.test(input[cursor] ?? "")) cursor += 1
      const command = input.slice(start, cursor)
      return delimiterSymbols[command] ?? input[cursor] ?? ""
    }
    const delimiter = input[cursor] ?? ""
    cursor += 1
    return delimiter
  }

  function parseEnvironmentBody(): OmmlNode[][][] {
    const rows: OmmlNode[][][] = []
    let row: OmmlNode[][] = []
    let cell: OmmlNode[] = []
    while (cursor < input.length && !input.startsWith("\\end", cursor)) {
      if (input.startsWith("\\\\", cursor)) {
        cursor += 2
        row.push(cell)
        cell = []
        rows.push(row)
        row = []
        continue
      }
      if (input[cursor] === "&") {
        cursor += 1
        row.push(cell)
        cell = []
        continue
      }
      cell.push(...parseNodes(false, true, true))
    }
    row.push(cell)
    rows.push(row)
    return rows
  }
}

const matrixDelimiters: Record<string, { left: string; right: string }> = {
  matrix: { left: "", right: "" },
  smallmatrix: { left: "", right: "" },
  aligned: { left: "", right: "" },
  alignedat: { left: "", right: "" },
  gathered: { left: "", right: "" },
  array: { left: "", right: "" },
  pmatrix: { left: "(", right: ")" },
  bmatrix: { left: "[", right: "]" },
  Bmatrix: { left: "{", right: "}" },
  vmatrix: { left: "|", right: "|" },
  Vmatrix: { left: "‖", right: "‖" },
  cases: { left: "{", right: "" },
  "cases*": { left: "{", right: "" },
  dcases: { left: "{", right: "" },
  "dcases*": { left: "{", right: "" },
  rcases: { left: "", right: "}" },
  drcases: { left: "", right: "}" },
}

function isMatrixEnvironment(environment: string) {
  return environment in matrixDelimiters
}

function appendRun(nodes: OmmlNode[], value: string) {
  if (!value) return
  const last = nodes[nodes.length - 1]
  if (last?.kind === "run") {
    last.value += value
    return
  }
  nodes.push({ kind: "run", value })
}

function serializeNodes(nodes: OmmlNode[]): string {
  return nodes.map(serializeNode).join("")
}

function serializeNode(node: OmmlNode): string {
  if (node.kind === "run") return `<m:r><m:t xml:space="preserve">${escapeXml(node.value)}</m:t></m:r>`
  if (node.kind === "frac") {
    return `<m:f><m:num>${serializeNodes(node.numerator)}</m:num><m:den>${serializeNodes(node.denominator)}</m:den></m:f>`
  }
  if (node.kind === "sup") {
    return `<m:sSup><m:e>${serializeNodes(node.base)}</m:e><m:sup>${serializeNodes(node.superscript)}</m:sup></m:sSup>`
  }
  if (node.kind === "sub") {
    return `<m:sSub><m:e>${serializeNodes(node.base)}</m:e><m:sub>${serializeNodes(node.subscript)}</m:sub></m:sSub>`
  }
  if (node.kind === "subsup") {
    return `<m:sSubSup><m:e>${serializeNodes(node.base)}</m:e><m:sub>${serializeNodes(node.subscript)}</m:sub><m:sup>${serializeNodes(node.superscript)}</m:sup></m:sSubSup>`
  }
  if (node.kind === "limLow") {
    return `<m:limLow><m:e>${serializeNodes(node.base)}</m:e><m:lim>${serializeNodes(node.limit)}</m:lim></m:limLow>`
  }
  if (node.kind === "limUpp") {
    return `<m:limUpp><m:e>${serializeNodes(node.base)}</m:e><m:lim>${serializeNodes(node.limit)}</m:lim></m:limUpp>`
  }
  if (node.kind === "bar") {
    return `<m:bar><m:barPr><m:pos m:val="${node.position}"/></m:barPr><m:e>${serializeNodes(node.body)}</m:e></m:bar>`
  }
  if (node.kind === "acc") {
    return `<m:acc><m:accPr><m:chr m:val="${escapeXml(node.char)}"/></m:accPr><m:e>${serializeNodes(node.body)}</m:e></m:acc>`
  }
  if (node.kind === "nary") {
    return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.operator)}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${serializeNodes(node.subscript)}</m:sub><m:sup>${serializeNodes(node.superscript)}</m:sup><m:e>${serializeNodes(node.base)}</m:e></m:nary>`
  }
  if (node.kind === "rad") {
    const degree = node.index ? `<m:deg>${serializeNodes(node.index)}</m:deg>` : "<m:deg/>"
    const hide = node.index ? 'm:val="0"' : 'm:val="1"'
    return `<m:rad><m:radPr><m:degHide ${hide}/></m:radPr>${degree}<m:e>${serializeNodes(node.radicand)}</m:e></m:rad>`
  }
  if (node.kind === "matrix") {
    const columnCount = Math.max(1, ...node.rows.map((row) => row.length))
    const matrix = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${columnCount}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${node.rows
      .map((row) => `<m:mr>${row.map((cell) => `<m:e>${serializeNodes(cell)}</m:e>`).join("")}</m:mr>`)
      .join("")}</m:m>`
    if (!node.left && !node.right) return matrix
    return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left ?? "")}"/><m:endChr m:val="${escapeXml(node.right ?? "")}"/></m:dPr><m:e>${matrix}</m:e></m:d>`
  }
  return `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.left)}"/><m:endChr m:val="${escapeXml(node.right)}"/></m:dPr><m:e>${serializeNodes(node.body)}</m:e></m:d>`
}

function escapeXml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
