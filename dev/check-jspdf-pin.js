/* The browser exports with vendor/jspdf.umd.min.js and the tests verify with
 * the npm copy. If those two drift apart, a book verified here is not the book
 * the tool produces — and reprint matching quietly breaks. */
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const want = require(path.join(__dirname, "package.json")).devDependencies.jspdf;
const got = require(path.join(__dirname, "node_modules", "jspdf", "package.json")).version;
if (got !== want) {
  console.error("  jsPDF pin mismatch: dev/package.json wants " + want + ", node_modules has " + got);
  process.exit(1);
}
const vendored = fs.readFileSync(path.join(ROOT, "vendor", "jspdf.umd.min.js"), "utf8");
if (vendored.indexOf(want) < 0) {
  console.error("  vendor/jspdf.umd.min.js does not carry the string " + want +
                " — re-copy it from node_modules/jspdf/dist/jspdf.umd.min.js");
  process.exit(1);
}
console.log("  jsPDF pinned at " + want + " in package.json, node_modules and vendor/");
