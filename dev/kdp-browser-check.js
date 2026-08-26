/* End-to-end check in a real browser, which jsdom cannot do: web workers,
 * WebCrypto, jsPDF and a genuine file download.
 *
 * Playwright is not a dependency — it is large and rarely needed. Install it
 * only when you want to run this:
 *
 *   cd dev && npm i -D playwright && npx playwright install chromium
 *   (from the repo root, in another shell)  python3 -m http.server 8777
 *   node dev/kdp-browser-check.js
 *
 * The last assertion is the important one: the PDF the browser downloads must
 * be byte-identical to the one dev/kdp-harness.js builds under Node. If those
 * ever diverge, the test suite is verifying something you do not ship.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const BASE = process.env.KDP_URL || "http://127.0.0.1:8777/";

(async () => {
  /* CHROME_PATH lets you point at a Chromium that is already on the machine,
     rather than the exact build this Playwright version wants to download. */
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], consoleErrors = [], badResponses = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) badResponses.push(r.status() + " " + r.url()); });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#libBody tr.book").length > 0,
    { timeout: 15000 });

  console.log("engine   :", (await page.textContent("#engineStatus")).trim());
  const ids = await page.$$eval("#libBody tr.book", rs => rs.map(r => r.dataset.id));
  console.log("library  :", ids.join(", "));

  /* select ZS-001 and read the numbers back */
  await page.click("#libBody tr.book[data-id='ZS-001']");
  await page.waitForTimeout(300);
  const readout = await page.textContent("#readout");
  console.log("pages    :", (readout.match(/Pages\s*([\d]+)/) || [])[1]);
  console.log("spine    :", (readout.match(/Spine\s*([\d.]+ in \/ [\d.]+ cm)/) || [])[1]);
  console.log("cover    :", (readout.match(/Cover wrap\s*([\d.]+ × [\d.]+ in)/) || [])[1]);
  await page.screenshot({ path: path.join(ROOT, "out", "tool.png"), fullPage: true });

  /* a real export through the worker pool */
  await page.check("#xProof");
  await page.fill("#xProofPages", "24");
  const dl = page.waitForEvent("download", { timeout: 180000 });
  await page.click("#btnExport");
  const download = await dl;
  const outPath = path.join(ROOT, "out", "browser-export.pdf");
  await download.saveAs(outPath);
  console.log("download :", download.suggestedFilename(), fs.statSync(outPath).size + " bytes");
  await page.waitForTimeout(500);
  console.log("status   :", (await page.textContent("#progress")).trim().slice(0, 120));
  await page.screenshot({ path: path.join(ROOT, "out", "tool-exported.png"), fullPage: true });

  console.log("pageerrors:", errors.length ? errors : "none");
  console.log("console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("failed requests:", badResponses.length ? badResponses : "none");
  await browser.close();

  let fail = errors.length + consoleErrors.length + badResponses.length;

  const ref = path.join(ROOT, "out", "ZS-001-proof.pdf");
  if (!fs.existsSync(ref)) {
    console.log("reference: out/ZS-001-proof.pdf missing — run: node dev/kdp-harness.js ZS-001 out 24");
  } else {
    const a = fs.readFileSync(ref), b = fs.readFileSync(outPath);
    if (a.equals(b)) console.log("byte match: browser export === node build (" + a.length + " bytes)");
    else { console.error("MISMATCH: browser export differs from the node build"); fail++; }
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("BROWSER CHECK FAILED:", e.message); process.exit(1); });
