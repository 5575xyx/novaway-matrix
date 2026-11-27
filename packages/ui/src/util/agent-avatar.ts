/**
 * Offline illustrated AI portraits.
 *
 * A stable seed chooses the palette, face, hair, outfit and accessories. This is
 * intentionally closer to a small character illustration than a generic robot
 * glyph, while remaining deterministic and safe for offline installations.
 */
const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const backgrounds = [
  ["#d9efff", "#6da7e8"],
  ["#ffe1d2", "#ed9b82"],
  ["#e2f4d8", "#82bf9a"],
  ["#eee2ff", "#a88ce0"],
  ["#fff0bd", "#e8b45d"],
  ["#d9f4ee", "#61b8ad"],
] as const
const skinTones = ["#f8d2b5", "#e9b18f", "#c98562", "#8b543e", "#f1c09b", "#6f4033"] as const
const hairTones = ["#2a211f", "#4a2d24", "#793f2f", "#b96a3d", "#d39a4a", "#413b68"] as const
const shirtTones = ["#263f70", "#d45d5d", "#247d78", "#7957a7", "#d18b37", "#202b3d"] as const

const hair = (style: number, color: string) => {
  const stroke = "rgba(35,25,35,.16)"
  if (style === 0) {
    return `<path d="M16 29c0-13 7-21 17-21 11 0 17 8 16 22-4-4-7-8-10-13-6 6-13 9-23 12z" fill="${color}" stroke="${stroke}"/><path d="M17 28c-2 9-1 15 3 19" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
  }
  if (style === 1) {
    return `<path d="M14 31c0-15 7-24 18-24s18 9 18 24v17c-4 2-7-2-8-10-5 3-14 3-20 0-1 8-4 12-8 10z" fill="${color}" stroke="${stroke}"/><path d="M17 25c5-7 10-9 15-9 6 0 11 2 16 9" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2"/>`
  }
  if (style === 2) {
    return `<path d="M14 28c-1-12 7-22 18-22 12 0 20 10 18 23l-5 5H19z" fill="${color}" stroke="${stroke}"/><g fill="${color}"><circle cx="17" cy="18" r="6"/><circle cx="24" cy="10" r="6"/><circle cx="33" cy="8" r="6"/><circle cx="42" cy="11" r="6"/><circle cx="49" cy="19" r="6"/></g>`
  }
  if (style === 3) {
    return `<path d="M14 26c1-14 8-22 18-22s17 8 18 22c-8-5-13-7-18-7s-10 2-18 7z" fill="${color}" stroke="${stroke}"/><path d="M12 25c11-5 28-5 40 0" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
  }
  if (style === 4) {
    return `<path d="M15 31c0-14 7-23 17-23s17 9 17 23v12c-4 6-10 9-17 9s-13-3-17-9z" fill="${color}" stroke="${stroke}"/><path d="M15 25c4-5 10-7 17-7s13 2 17 7" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>`
  }
  return `<path d="M13 28c1-14 8-22 19-22s18 8 19 22l-6 5H19z" fill="${color}" stroke="${stroke}"/><path d="M17 18c4-5 9-7 15-7 7 0 12 2 16 7" fill="none" stroke="#f0c36b" stroke-width="3" stroke-linecap="round"/>`
}

const portrait = (seed: number) => {
  const skin = skinTones[(seed >>> 2) % skinTones.length]!
  const hairColor = hairTones[(seed >>> 7) % hairTones.length]!
  const shirt = shirtTones[(seed >>> 12) % shirtTones.length]!
  const glasses = (seed >>> 9) % 5 === 0
  const eyeOffset = ((seed >>> 16) % 3) - 1
  const mouth = (seed >>> 19) % 3
  const accessory = (seed >>> 22) % 6
  const mouthPath = mouth === 0 ? "M27 43q5 4 10 0" : mouth === 1 ? "M28 44h8" : "M27 43q5 2 10 0"
  const headAccessory = accessory === 0
    ? `<path d="M16 28c-4 2-4 9 0 11M48 28c4 2 4 9 0 11" fill="none" stroke="#5a5264" stroke-width="3" stroke-linecap="round"/><path d="M16 29c0-9 7-15 16-15s16 6 16 15" fill="none" stroke="#5a5264" stroke-width="3" stroke-linecap="round"/>`
    : accessory === 1
      ? `<path d="M18 18c3-5 8-8 14-8s11 3 14 8" fill="none" stroke="#f0c36b" stroke-width="2.5" stroke-linecap="round"/>`
      : ""
  const faceAccessory = accessory === 2
    ? `<path d="M23 43q9 9 18 0v8q-9 6-18 0z" fill="${hairColor}" opacity=".92"/>`
    : accessory === 3
      ? `<path d="M25 40q7 5 14 0v5q-7 5-14 0z" fill="${hairColor}" opacity=".82"/>`
      : accessory === 4
        ? `<circle cx="17" cy="37" r="1.5" fill="#f5c85f"/><circle cx="47" cy="37" r="1.5" fill="#f5c85f"/>`
        : ""
  return `<path d="M27 45v8h10v-8" fill="${skin}"/><path d="M10 64c2-11 10-17 22-17s20 6 22 17z" fill="${shirt}"/><path d="M24 49l8 7 8-7" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><ellipse cx="32" cy="30" rx="15" ry="18" fill="${skin}"/><ellipse cx="17" cy="32" rx="2.5" ry="4" fill="${skin}"/><ellipse cx="47" cy="32" rx="2.5" ry="4" fill="${skin}"/>${hair((seed >>> 4) % 6, hairColor)}${headAccessory}<path d="M21 24q3-6 8-8" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2" stroke-linecap="round"/><circle cx="23" cy="38" r="2.5" fill="rgba(190,78,83,.12)"/><circle cx="41" cy="38" r="2.5" fill="rgba(190,78,83,.12)"/><path d="M22 ${30 + eyeOffset}h3M39 ${30 - eyeOffset}h3" stroke="rgba(35,25,35,.72)" stroke-width="2" stroke-linecap="round"/><circle cx="25" cy="34" r="1.5" fill="#292235"/><circle cx="40" cy="34" r="1.5" fill="#292235"/><path d="M32 34v5" stroke="rgba(126,73,57,.45)" stroke-width="1.5" stroke-linecap="round"/><path d="${mouthPath}" fill="none" stroke="rgba(100,43,48,.8)" stroke-width="1.8" stroke-linecap="round"/>${glasses ? `<path d="M19 31h10l1 2-1 4H20l-1-4zM35 31h10l-1 6h-9l-1-4zM30 33h5" fill="none" stroke="#3d3444" stroke-width="1.5"/>` : ""}${faceAccessory}`
}

const teamPortrait = (seed: number) => {
  const first = skinTones[(seed >>> 2) % skinTones.length]!
  const second = skinTones[(seed >>> 8) % skinTones.length]!
  const third = skinTones[(seed >>> 14) % skinTones.length]!
  const firstHair = hairTones[(seed >>> 17) % hairTones.length]!
  const secondHair = hairTones[(seed >>> 21) % hairTones.length]!
  const thirdHair = hairTones[(seed >>> 25) % hairTones.length]!
  return `<path d="M5 64c1-9 7-14 15-14s14 5 15 14z" fill="${shirtTones[(seed >>> 5) % shirtTones.length]}"/><path d="M29 64c1-10 7-16 15-16s14 6 15 16z" fill="${shirtTones[(seed >>> 11) % shirtTones.length]}"/><circle cx="18" cy="29" r="11" fill="${first}"/><circle cx="45" cy="28" r="12" fill="${second}"/><circle cx="32" cy="18" r="10" fill="${third}"/><path d="M9 27c2-10 7-14 13-13 5 0 8 4 9 9-7-3-14-3-22 4z" fill="${firstHair}"/><path d="M35 17c2-8 8-11 14-7 4 2 6 6 5 12-6-5-12-6-19-5z" fill="${secondHair}"/><path d="M25 14c2-7 7-10 13-9 4 1 7 4 8 8-8-3-14-2-21 1z" fill="${thirdHair}"/><g fill="#292235"><circle cx="15" cy="30" r="1.5"/><circle cx="21" cy="30" r="1.5"/><circle cx="42" cy="29" r="1.5"/><circle cx="48" cy="29" r="1.5"/><circle cx="29" cy="18" r="1.3"/><circle cx="35" cy="18" r="1.3"/></g><g fill="none" stroke="rgba(100,43,48,.75)" stroke-width="1.2" stroke-linecap="round"><path d="M16 35q2 2 4 0"/><path d="M43 34q2 2 4 0"/><path d="M30 23q2 1 4 0"/></g>`
}

export function agentAvatarSrc(name: string): string {
  const seed = hash(name || "agent")
  const palette = backgrounds[seed % backgrounds.length]!
  const isTeam = name.startsWith("team-avatar:")
  const artwork = isTeam ? teamPortrait(seed) : portrait(seed)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#bg)"/><circle cx="52" cy="10" r="13" fill="rgba(255,255,255,.18)"/><circle cx="8" cy="57" r="17" fill="rgba(255,255,255,.1)"/><g>${artwork}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
