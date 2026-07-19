const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const outDir = path.join(process.cwd(), ".tmp-browser-qa");
fs.mkdirSync(outDir, { recursive: true });
const html = `<!doctype html><html><body><h1>Todo 样板</h1><button>添加</button><div id="list"></div></body></html>`;
const server = http.createServer((req,res)=>{res.writeHead(200,{"content-type":"text/html;charset=utf-8"});res.end(html);});
server.listen(0,"127.0.0.1", async () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  try {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const viewports = [{n:"desktop",w:1440,h:900},{n:"mobile",w:390,h:844}];
    const results = [];
    for (const v of viewports) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText();
      const shot = path.join(outDir, `${v.n}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const passed = text.includes("Todo 样板") && text.includes("添加") && fs.existsSync(shot);
      results.push({ viewport: v.n, passed, shot });
    }
    await browser.close();
    server.close();
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ ok: results.every(r=>r.passed), results }, null, 2));
    console.log(JSON.stringify({ ok: results.every(r=>r.passed), results }, null, 2));
    process.exit(results.every(r=>r.passed) ? 0 : 1);
  } catch (e) {
    console.error(String(e && e.stack || e));
    try { server.close(); } catch {}
    process.exit(2);
  }
});