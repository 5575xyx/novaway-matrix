import path from "path"
import os from "os"
import fs from "fs"
import { fileURLToPath } from "url"
import { xdgCache } from "xdg-basedir"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
const cacheDir = path.join(xdgCache ?? path.join(os.homedir(), ".cache"), "novaway")
const cachePath = path.join(cacheDir, "models.json")

async function fetchModels(): Promise<string> {
  const text = await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cachePath, text)
  return text
}

async function loadModelsData(): Promise<string> {
  if (process.env.MODELS_DEV_API_JSON) {
    return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  }

  try {
    return await fetchModels()
  } catch (error) {
    console.warn(`Failed to fetch models from ${modelsUrl}: ${error}`)
    console.warn("If you are behind a proxy, set HTTPS_PROXY (e.g. HTTPS_PROXY=http://127.0.0.1:7897)")

    try {
      const cached = fs.readFileSync(cachePath, "utf-8")
      console.warn(`Falling back to cached models at ${cachePath}`)
      return cached
    } catch {
      console.warn("No cached models found, using empty catalog")
      return "{}"
    }
  }
}

export const modelsData = await loadModelsData()
console.log("Loaded models.dev snapshot")
