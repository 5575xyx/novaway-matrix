/**
 * AI 员工头像：按名字哈希生成一张稳定的机器人头像 SVG。
 *
 * 不依赖网络图床（离线、内网也能显示），也不需要在后端存二进制；
 * 同一个名字永远得到同一张图，改名/新建会换一张。
 */
const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const EYES = [
  // 圆眼
  `<circle cx="24" cy="34" r="4" fill="#fff"/><circle cx="40" cy="34" r="4" fill="#fff"/>`,
  // 横条眼
  `<rect x="19" y="31" width="10" height="5" rx="2.5" fill="#fff"/><rect x="35" y="31" width="10" height="5" rx="2.5" fill="#fff"/>`,
  // 竖条眼
  `<rect x="22" y="28" width="5" height="12" rx="2.5" fill="#fff"/><rect x="37" y="28" width="5" height="12" rx="2.5" fill="#fff"/>`,
  // 星星眼
  `<path d="M24 29l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-1.9-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill="#fff"/><path d="M40 29l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-1.9-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill="#fff"/>`,
  // 眯眼
  `<path d="M19 34q5-5 10 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M35 34q5-5 10 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  // 一只圆一只横条
  `<circle cx="24" cy="34" r="4.5" fill="#fff"/><rect x="35" y="31" width="10" height="5" rx="2.5" fill="#fff"/>`,
] as const

const MOUTHS = [
  `<path d="M26 44q6 5 12 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  `<rect x="27" y="43" width="10" height="3" rx="1.5" fill="#fff"/>`,
  `<path d="M26 45h12" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  `<circle cx="32" cy="45" r="3" fill="#fff"/>`,
] as const

const ANTENNAS = [
  `<line x1="32" y1="10" x2="32" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="8" r="3.5" fill="#fff"/>`,
  `<line x1="24" y1="12" x2="27" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><line x1="40" y1="12" x2="37" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
  `<rect x="29" y="8" width="6" height="10" rx="3" fill="#fff"/>`,
] as const

export function agentAvatarSrc(name: string): string {
  const seed = hash(name || "agent")
  const hue = seed % 360
  const second = (hue + 38 + (seed % 40)) % 360
  const eyes = EYES[(seed >> 3) % EYES.length]
  const mouth = MOUTHS[(seed >> 7) % MOUTHS.length]
  const antenna = ANTENNAS[(seed >> 11) % ANTENNAS.length]
  const tilt = ((seed >> 15) % 7) - 3
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 72% 58%)"/><stop offset="1" stop-color="hsl(${second} 68% 46%)"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#bg)"/>
<g transform="rotate(${tilt} 32 34)">
<rect x="12" y="17" width="40" height="36" rx="13" fill="rgba(15,23,42,.28)" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
<rect x="8" y="27" width="4" height="13" rx="2" fill="rgba(255,255,255,.5)"/>
<rect x="52" y="27" width="4" height="13" rx="2" fill="rgba(255,255,255,.5)"/>
${eyes}
${mouth}
${antenna}
</g>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
