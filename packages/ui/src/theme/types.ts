export type HexColor = `#${string}`

export interface OklchColor {
  l: number // Lightness 0-1
  c: number // Chroma 0-0.4+
  h: number // Hue 0-360
}

export interface ThemeSeedColors {
  neutral: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
}

export interface ThemePaletteColors {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  accent?: HexColor
  interactive?: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
}

type ThemeVariantBase = {
  overrides?: Record<string, ColorValue>
}

export type ThemeVariant =
  | ({ seeds: ThemeSeedColors; palette?: never } & ThemeVariantBase)
  | ({ palette: ThemePaletteColors; seeds?: never } & ThemeVariantBase)

export interface DesktopTheme {
  $schema?: string
  name: string
  id: string
  light: ThemeVariant
  dark: ThemeVariant
}

export type TokenCategory =
  | "background"
  | "surface"
  | "text"
  | "border"
  | "icon"
  | "input"
  | "button"
  | "syntax"
  | "markdown"
  | "diff"
  | "avatar"

export type ThemeToken = string

export type CssVarRef = `var(--${string})`
export type CssColorMix = `color-mix(in oklab, ${string})`
export type CssRgba = `rgba(${string})`

/** Runtime theme values may be hex, a CSS variable, or CSS color functions emitted by the resolver. */
export type ColorValue = HexColor | CssVarRef | CssColorMix | CssRgba

export type ResolvedTheme = Record<ThemeToken, ColorValue>
