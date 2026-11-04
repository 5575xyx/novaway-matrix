/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://novaway.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/5575xyx/novaway-matrix",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/novaway",
    discord: "https://discord.gg/novaway",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const
