// Renders the crest in emblem.js to web/public: icon.svg plus the PNG sizes the
// manifest and iOS need. Needs playwright-core and a Chromium; point at them with
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome node icons/render.js
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const { svg } = require("./emblem");
const PUB = path.join(__dirname, "..", "public");
const CHROME = process.env.CHROME || path.join(os.homedir(), ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");

// purpose "any" and the favicon: the emblem fills most of the square
const anySvg = svg({ scale: 0.92 });
// purpose "maskable" and the iOS icon: the OS may crop to a circle or round the
// corners, so the emblem stays inside the inner 80 % (the safe zone)
const maskSvg = svg({ scale: 0.76 });
fs.writeFileSync(path.join(PUB, "icon.svg"), anySvg);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const jobs = [
    ["icon-512.png", anySvg, 512],
    ["icon-192.png", anySvg, 192],
    ["icon-maskable-512.png", maskSvg, 512],
    ["icon-maskable-192.png", maskSvg, 192],
    ["apple-touch-icon.png", maskSvg, 180],
  ];
  for (const [name, body, size] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><body style="margin:0">${body.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body>`);
    await page.screenshot({ path: path.join(PUB, name), clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log("wrote", name);
  }
  await browser.close();
})();
