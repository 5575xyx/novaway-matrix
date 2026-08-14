export function normalizeRawTextMarkdownElement(element) {
  const runs = Array.isArray(element.runs) ? element.runs : element.text ? [{ text: String(element.text) }] : []
  return {
    element,
    runs,
    changed: false,
  }
}
