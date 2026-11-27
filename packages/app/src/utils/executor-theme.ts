export type ExecutorTheme = {
  accent: string
  accentStrong: string
  surface: string
  glow: string
  gradient: string
}

const themes: readonly ExecutorTheme[] = [
  {
    accent: "#55d6be",
    accentStrong: "#168f91",
    surface: "rgba(65, 205, 190, 0.16)",
    glow: "rgba(65, 205, 190, 0.28)",
    gradient: "linear-gradient(135deg, rgba(65,205,190,.26), rgba(50,110,210,.08) 54%, transparent)",
  },
  {
    accent: "#a98bff",
    accentStrong: "#7045cf",
    surface: "rgba(155, 119, 255, 0.16)",
    glow: "rgba(155, 119, 255, 0.3)",
    gradient: "linear-gradient(135deg, rgba(155,119,255,.28), rgba(50,110,210,.08) 54%, transparent)",
  },
  {
    accent: "#ff8e70",
    accentStrong: "#d34e55",
    surface: "rgba(255, 142, 112, 0.16)",
    glow: "rgba(255, 142, 112, 0.28)",
    gradient: "linear-gradient(135deg, rgba(255,142,112,.28), rgba(245,190,70,.08) 54%, transparent)",
  },
  {
    accent: "#6ba7ff",
    accentStrong: "#3f63d4",
    surface: "rgba(107, 167, 255, 0.16)",
    glow: "rgba(107, 167, 255, 0.28)",
    gradient: "linear-gradient(135deg, rgba(107,167,255,.28), rgba(70,210,190,.08) 54%, transparent)",
  },
  {
    accent: "#f3c76b",
    accentStrong: "#c1842f",
    surface: "rgba(243, 199, 107, 0.18)",
    glow: "rgba(243, 199, 107, 0.26)",
    gradient: "linear-gradient(135deg, rgba(243,199,107,.3), rgba(255,142,112,.08) 54%, transparent)",
  },
  {
    accent: "#f277b7",
    accentStrong: "#b441a0",
    surface: "rgba(242, 119, 183, 0.16)",
    glow: "rgba(242, 119, 183, 0.28)",
    gradient: "linear-gradient(135deg, rgba(242,119,183,.28), rgba(155,119,255,.08) 54%, transparent)",
  },
]

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

/** Stable visual language for one executor: the same expert keeps the same accent everywhere. */
export function executorTheme(name: string) {
  return themes[hash(name.trim() || "executor") % themes.length]!
}
