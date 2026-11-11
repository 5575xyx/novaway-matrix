/** Flatten fetched provider logos to inherited paint so the active theme can tint them. */
export function themeProviderSvg(svg: string) {
  const normalizePaint = (value: string) =>
    /^(?:none|transparent|inherit|currentcolor|url\()/i.test(value.trim()) ? value : "currentColor"

  return svg
    .replace(/((?:fill|stroke)\s*=\s*["'])([^"']+)(["'])/gi, (_match, prefix, value, suffix) => {
      return `${prefix}${normalizePaint(value)}${suffix}`
    })
    .replace(/((?:fill|stroke)\s*:\s*)([^;}'"\s]+)/gi, (_match, prefix, value) => {
      return `${prefix}${normalizePaint(value)}`
    })
}
