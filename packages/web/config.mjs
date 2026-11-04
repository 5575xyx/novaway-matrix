const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://novaway.ai" : `https://${stage}.novaway.ai`,
  console: stage === "production" ? "https://novaway.ai/auth" : `https://${stage}.novaway.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/5575xyx/novaway-matrix",
  discord: "https://novaway.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
