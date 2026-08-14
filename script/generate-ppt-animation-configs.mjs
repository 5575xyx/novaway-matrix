import { readdirSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const assetRoot = resolve(repoRoot, "packages/app/public/assets/office-ppt-templates")

const profiles = {
  "swiss-grid": { title: "wipe", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.2 },
  brutalist: { title: "wipe", body: "fade", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.16 },
  glassmorphism: { title: "fade", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.22 },
  "data-dashboard": { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.18 },
  "editorial-magazine": { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.24 },
  "memphis-pop": { title: "wipe", body: "fly", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.14 },
  "risograph-zine": { title: "fade", body: "fade", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.18 },
  architecture: { title: "fade", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.2 },
  botanical: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.22 },
  finance: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.18 },
  "tech-blueprint": { title: "wipe", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.18 },
  "ai-ops": { title: "fade", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.18 },
  "minimal-luxury": { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.26 },
  academic: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.2 },
  government: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.2 },
  "startup-pitch": { title: "wipe", body: "fade", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.16 },
  medical: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.18 },
  engineering: { title: "wipe", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.18 },
  education: { title: "wipe", body: "fly", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.14 },
  "retro-terminal": { title: "wipe", body: "fade", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.12 },
  dynamic: { title: "wipe", body: "fly", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.14 },
  editorial: { title: "fade", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.2 },
  executive: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.22 },
  general: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.2 },
  modern: { title: "fade", body: "fade", cards: "fade", image: "zoom", chart: "wipe", stagger: 0.2 },
  momentum: { title: "wipe", body: "fly", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.14 },
  standard: { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.2 },
  swift: { title: "fade", body: "fade", cards: "fly", image: "zoom", chart: "wipe", stagger: 0.16 },
}

const defaultProfile = { title: "fade", body: "fade", cards: "fade", image: "fade", chart: "wipe", stagger: 0.2 }

function group(selector, profile, effect, duration, delay) {
  return {
    selector,
    effect,
    duration,
    ...(delay === undefined ? {} : { delay }),
  }
}

function slideConfig(profile, role) {
  if (role === "cover") {
    return {
      groups: [
        group("title", profile, profile.title, 0.6, 0),
        group("image", profile, profile.image, 0.55, 0.2),
        group("body", profile, profile.body, 0.5, 0.25),
      ],
    }
  }
  if (role === "overview") {
    return {
      groups: [
        group("title", profile, profile.title, 0.5, 0),
        group("body", profile, profile.body, 0.4, 0.2),
        group("cards", profile, profile.cards, 0.4, profile.stagger),
        group("chart", profile, profile.chart, 0.5, profile.stagger),
      ],
    }
  }
  if (role === "cards") {
    return {
      groups: [
        group("title", profile, profile.title, 0.5, 0),
        group("cards", profile, profile.cards, 0.4, profile.stagger),
        group("body", profile, profile.body, 0.4, profile.stagger),
        group("image", profile, profile.image, 0.5, profile.stagger),
        group("chart", profile, profile.chart, 0.5, profile.stagger),
      ],
    }
  }
  if (role === "data") {
    return {
      groups: [
        group("title", profile, profile.title, 0.5, 0),
        group("chart", profile, profile.chart, 0.55, 0.15),
        group("body", profile, profile.body, 0.4, 0.2),
        group("cards", profile, profile.cards, 0.35, profile.stagger),
      ],
    }
  }
  if (role === "closing") {
    return {
      groups: [
        group("title", profile, profile.title, 0.6, 0),
        group("body", profile, profile.body, 0.5, 0.3),
        group("image", profile, profile.image, 0.5, 0.25),
      ],
    }
  }
  return {
    groups: [
      group("title", profile, profile.title, 0.5, 0),
      group("body", profile, profile.body, 0.4, 0.2),
      group("cards", profile, profile.cards, 0.4, profile.stagger),
      group("image", profile, profile.image, 0.5, profile.stagger),
      group("chart", profile, profile.chart, 0.5, profile.stagger),
    ],
  }
}

function templateConfig(name) {
  const profile = profiles[name] ?? defaultProfile
  return {
    version: 1,
    defaults: {
      transition: { effect: "fade", duration: 0.35 },
      animation: {
        effect: profile.body,
        duration: 0.4,
        stagger: profile.stagger,
        trigger: "after-previous",
      },
    },
    slides: Object.fromEntries(
      ["cover", "overview", "content", "cards", "data", "closing"].map((role) => [role, slideConfig(profile, role)]),
    ),
  }
}

for (const groupName of ["pptx", "presenton-pptx"]) {
  const groupRoot = join(assetRoot, groupName)
  for (const entry of readdirSafe(groupRoot)) {
    const templateDir = join(groupRoot, entry)
    const templateFile = join(templateDir, "template.pptx")
    if (!existsSync(templateFile)) continue
    writeFileSync(join(templateDir, "animations.json"), JSON.stringify(templateConfig(entry), null, 2), "utf8")
    console.log(`生成 ${groupName}/${entry}/animations.json`)
  }
}

function readdirSafe(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function existsSync(path) {
  try {
    return Boolean(statSync(path))
  } catch {
    return false
  }
}
