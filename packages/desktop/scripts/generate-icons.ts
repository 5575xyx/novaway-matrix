import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "../../..")
const iconsDir = path.join(rootDir, "packages", "desktop", "icons")
const resourcesDir = path.join(rootDir, "packages", "desktop", "resources")

const sourceSvg = path.join(iconsDir, "novaway-icon.svg")

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd, stdio: "inherit" })
    process.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with code ${code}`))
      }
    })
  })
}

async function generateIcons() {
  console.log("🚀 Generating NovaWay desktop icons...")
  
  const channels = ["dev", "beta", "prod"]
  
  for (const channel of channels) {
    console.log(`\n📦 Processing ${channel} channel...`)
    
    const channelDir = path.join(iconsDir, channel)
    
    console.log(`Copying SVG to ${channelDir}...`)
    try {
      await runCommand("cp", [sourceSvg, path.join(channelDir, "icon.svg")], rootDir)
    } catch {
      await runCommand("copy", [sourceSvg, path.join(channelDir, "icon.svg")], rootDir)
    }
    
    console.log(`Creating resources/icons directory...`)
    const resourcesIconsDir = path.join(resourcesDir, "icons")
    try {
      await runCommand("mkdir", ["-p", resourcesIconsDir], rootDir)
    } catch {
      await runCommand("mkdir", ["-p", resourcesIconsDir], rootDir)
    }
    
    console.log(`Copying icons to resources...`)
    try {
      await runCommand("cp", ["-r", channelDir, resourcesIconsDir], rootDir)
    } catch {
      await runCommand("xcopy", [channelDir, resourcesIconsDir, "/E/H/Y"], rootDir)
    }
  }
  
  console.log("\n✅ NovaWay icons generated successfully!")
  console.log("\n📋 Next steps:")
  console.log("1. Use ImageMagick or similar tool to convert SVG to PNG:")
  console.log(`   magick convert ${sourceSvg} -resize 256x256 ${path.join(iconsDir, "dev", "icon.png")}`)
  console.log("2. Use Image2Icon (macOS) to generate icon.icns")
  console.log("3. Use icotool or similar to generate icon.ico")
}

generateIcons().catch((error) => {
  console.error("❌ Error generating icons:", error)
  process.exit(1)
})
