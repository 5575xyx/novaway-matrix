import { ComponentProps } from "solid-js"

const glowFilter = (id: string, deviation: string) => (
  <filter id={id}>
    <feGaussianBlur stdDeviation={deviation} result="coloredBlur" />
    <feMerge>
      <feMergeNode in="coloredBlur" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
)

const iconFill = "var(--icon-strong-base)"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {glowFilter("novaGlow", "1.5")}
      </defs>
      <g filter="url(#novaGlow)">
        <path d="M8 34V6L16 20V6H22V34H16V18L8 34Z" fill={iconFill} />
        <path d="M22 6H28L32 18L36 6H42V34H36V20L32 32L28 20V34H22V6Z" fill={iconFill} />
      </g>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {glowFilter("splashGlow", "4")}
        {glowFilter("splashGlowStrong", "8")}
      </defs>
      <path d="M60 6L114 60L60 114L6 60L60 6Z" fill={iconFill} opacity="0.08" filter="url(#splashGlow)" />
      <path d="M60 18L102 60L60 102L18 60L60 18Z" fill={iconFill} opacity="0.12" />
      <g filter="url(#splashGlowStrong)">
        <path d="M24 102V18L48 60V18H60V102H48V54L24 102Z" fill={iconFill} />
        <path d="M60 18H72L84 54L96 18H108V102H96V60L84 96L72 60V102H60V18Z" fill={iconFill} />
      </g>
      <circle cx="60" cy="60" r="7" fill={iconFill} opacity="0.3" />
      <circle cx="60" cy="60" r="3.5" fill={iconFill} />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 60"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        {glowFilter("logoGlow", "1")}
      </defs>
      <g filter="url(#logoGlow)">
        <path d="M30 6L54 30L30 54L6 30L30 6Z" fill={iconFill} opacity="0.15" />
        <path d="M12 46V14L24 30V14H30V46H24V28L12 46Z" fill={iconFill} />
        <path d="M30 14H36L42 30L48 14H54V46H48V30L42 44L36 30V46H30V14Z" fill={iconFill} />
        <circle cx="30" cy="30" r="3.5" fill={iconFill} opacity="0.3" />
        <circle cx="30" cy="30" r="2" fill={iconFill} />
      </g>
      <g fill={iconFill}>
        <path d="M70 16H80V44H70V16ZM75 16V44" />
        <path d="M90 30C90 24.5 94.5 20 100 20C105.5 20 110 24.5 110 30C110 35.5 105.5 40 100 40C94.5 40 90 35.5 90 30ZM100 26C97.8 26 96 27.8 96 30C96 32.2 97.8 34 100 34C102.2 34 104 32.2 104 30C104 27.8 102.2 26 100 26Z" />
        <path d="M115 16H122L127 30L132 16H139L130 44H124L115 16Z" />
        <path d="M149 30C149 24.5 153.5 20 159 20H164V26H159C156.8 26 155 27.8 155 30C155 32.2 156.8 34 159 34H161C166.5 34 171 31.5 171 26V20H177V26C177 33.5 169.5 40 161 40H159C153.5 40 149 35.5 149 30Z" />
        <path d="M180 16H187L192 30L197 16H204L199 30L204 44H197L192 30L187 44H180L185 30L180 16Z" />
        <path d="M214 30C214 24.5 218.5 20 224 20H229V26H224C221.8 26 220 27.8 220 30C220 32.2 221.8 34 224 34H226C231.5 34 236 31.5 236 26V20H242V26C242 33.5 234.5 40 226 40H224C218.5 40 214 35.5 214 30Z" />
        <path d="M247 16H254V30L262 16H269V22L260 35V44H253V35L247 26V16Z" />
      </g>
    </svg>
  )
}