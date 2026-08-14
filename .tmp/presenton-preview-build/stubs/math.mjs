export function normalizeMathLatex(value) {
  return String(value ?? "")
}

export function renderMathHtml(latex) {
  const text = String(latex ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
  return `<div>${text}</div>`
}
