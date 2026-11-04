export async function GET() {
  const response = await fetch(
    "https://raw.githubusercontent.com/5575xyx/novaway-matrix/refs/heads/main/packages/sdk/js/openapi.json",
  )
  const json = await response.json()
  return json
}
