/* The deployment is a plain static site with no config at all: no vercel.json,
 * no .vercelignore, no package.json at the root, no build step. That is
 * deliberate — every deployment failure this project has had came from one of
 * those files, not from the code. This asserts none of them come back. */
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const bad = [];

for (const f of ["vercel.json", ".vercelignore", "package.json", "netlify.toml"])
  if (fs.existsSync(path.join(ROOT, f)))
    bad.push(f + " is back at the repo root — zero-config static hosting needs none of it, " +
             "and each one is a way to deploy nothing");

for (const f of ["index.html", "app.js", "core.js", "engine.js", "engine.lock.json",
                 "fonts.js", "assets.js", "books.json", "robots.txt",
                 "vendor/jspdf.umd.min.js"])
  if (!fs.existsSync(path.join(ROOT, f))) bad.push(f + " is missing");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const srcs = (html.match(/<script src="([^"]+)"><\/script>/g) || [])
  .map(function (t) { return t.replace(/.*src="\.?\/?([^"]+)".*/, "$1"); });
for (const s of srcs)
  if (!fs.existsSync(path.join(ROOT, s))) bad.push("index.html loads " + s + ", which does not exist");
if (srcs.length !== 6) bad.push("index.html loads " + srcs.length + " scripts, expected 6");

if (!/name="robots"[^>]*noindex/.test(html)) bad.push("index.html is missing its noindex meta tag");
if (!/Disallow: \/\s*$/m.test(fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8")))
  bad.push("robots.txt no longer disallows crawling");

/* Anything the browser needs must sit at the root, not under dev/. */
for (const s of srcs)
  if (s.indexOf("dev/") === 0) bad.push("index.html loads " + s + " from dev/, which is test-only");

if (bad.length) {
  console.error("  LAYOUT CHECK FAILED:");
  bad.forEach(function (b) { console.error("    - " + b); });
  process.exit(1);
}
console.log("  layout: static root, no build config, " + srcs.length + " scripts all present");
