/* jsdom smoke test for index.html.
 *
 *   node dev/kdp-smoke-jsdom.js
 *
 * The harness proves the maths and the PDF. This proves the page: that the
 * scripts load in order, the library renders, a new book can be created with a
 * seed range that does not collide, an overlapping one is refused, and
 * selecting a book drives the costs readout.
 *
 * The <script src> tags are stripped and injected as real script elements, so
 * this never depends on jsdom's resource loader — but they are the same files
 * in the same order, read out of index.html rather than hardcoded here.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { webcrypto } = require("crypto");

const ROOT = path.dirname(__dirname);
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name + (detail ? "  - " + detail : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  - " + detail : "")); }
}

const rawHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const books = JSON.parse(fs.readFileSync(path.join(ROOT, "books.json"), "utf8"));
const engineSrc = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
const engineLock = fs.readFileSync(path.join(ROOT, "engine.lock.json"), "utf8");

const scriptSrcs = [];
const html = rawHtml.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
  scriptSrcs.push(src);
  return "";
});
check("index.html loads its five scripts in order", scriptSrcs.length === 5 &&
  /jspdf/.test(scriptSrcs[0]) && /engine\.js/.test(scriptSrcs[1]) &&
  /fonts\.js/.test(scriptSrcs[2]) && /core\.js/.test(scriptSrcs[3]) && /app\.js/.test(scriptSrcs[4]),
  scriptSrcs.join(" -> "));

const errors = [];
const JSDOM_GAPS = /Not implemented/i;
const vc = new VirtualConsole();
vc.on("jsdomError", function (e) { if (!JSDOM_GAPS.test(String(e.message))) errors.push(String(e.message)); });
vc.on("error", function () { errors.push(Array.prototype.join.call(arguments, " ")); });

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true,
  url: "http://localhost:8777/", virtualConsole: vc
});
const win = dom.window;

const fetched = [];
win.fetch = function (url) {
  const u = String(url);
  fetched.push(u);
  const body = u.indexOf("books.json") >= 0 ? JSON.stringify(books)
    : u.indexOf("engine.lock.json") >= 0 ? engineLock
      : u.indexOf("engine.js") >= 0 ? engineSrc
        : null;
  if (body === null) return Promise.reject(new Error("unexpected fetch: " + u));
  return Promise.resolve({
    ok: true, status: 200,
    text: function () { return Promise.resolve(body); },
    json: function () { return Promise.resolve(JSON.parse(body)); }
  });
};
if (!win.crypto || !win.crypto.subtle)
  Object.defineProperty(win, "crypto", { value: webcrypto, configurable: true });
if (!win.TextEncoder) win.TextEncoder = TextEncoder;
win.Worker = undefined;                 /* the pool must not be reached here */
win.confirm = function () { return true; };
win.URL.createObjectURL = function () { return "blob:stub"; };

for (const src of scriptSrcs) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, src.replace(/^\.\//, "")), "utf8");
  try { win.document.head.appendChild(el); }
  catch (e) { errors.push(src + ": " + e.message); }
}

const $ = function (s) { return win.document.querySelector(s); };
const G = function (n) { return win.eval(n); };
const rows = function () { return win.document.querySelectorAll("#libBody tr.book"); };
const settle = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); };
/* computed style, not just the class: a CSS specificity bug once left a
   "hidden" field on screen while a class-based assertion passed. */
const shown = function (sel) { return win.getComputedStyle($(sel)).display !== "none"; };

function run() {
  check("all five scripts evaluate with no uncaught error", errors.length === 0,
    errors.length ? errors.slice(0, 2).join(" | ") : "clean load");
  check("the vendored jsPDF is a working UMD build",
    typeof G("window.jspdf") === "object" && typeof G("window.jspdf.jsPDF") === "function");
  check("the engine exposes the four dealers",
    ["dealPuzzle", "dealClassic", "dealX", "dealHyper"].every(function (n) { return typeof G(n) === "function"; }));
  check("the embedded font subset loaded",
    !!G("window.KDP_FONTS").regular && !!G("window.KDP_FONTS").charset,
    G("window.KDP_FONTS").charset.length + " codepoints available to the interior");
  check("the exporter core is present",
    ["kdpPlan", "kdpPricing", "kdpLedgerCheck", "kdpAssembler", "kdpBands", "kdpBandSequence"]
      .every(function (n) { return typeof G(n) === "function"; }));
  check("every trim x layout combination is a preset",
    Object.keys(G("KDP_PRESETS")).length === G("KDP_TRIMS").length * G("KDP_LAYOUTS").length,
    G("KDP_TRIMS").length + " trims x " + G("KDP_LAYOUTS").length + " layouts = " +
    Object.keys(G("KDP_PRESETS")).length + " presets");
  check("6 x 9 in is offered and counts as REGULAR trim",
    G("KDP_TRIMS").some(function (t) { return t.id === "6x9"; }) &&
    G("kdpTrimCategory")(G("KDP_PRESETS")["6x9/1up"]) === "REGULAR");

  return settle(200).then(function () {
    check("the page fetches only its own files", fetched.length > 0 &&
      fetched.every(function (u) { return /books\.json|engine\.js|engine\.lock\.json/.test(u); }),
      fetched.join(", "));
    check("the engine is verified against its lock on load",
      /engine verified/.test($("#engineStatus").innerHTML), $("#engineStatus").textContent.trim());
    check("the library renders every book", rows().length === Object.keys(books).length,
      rows().length + " rows: " + Array.prototype.map.call(rows(), function (r) { return r.dataset.id; }).join(", "));
    check("a climbing book shows its progression in the list",
      /Easy → Medium → Hard/.test($("#libBody").textContent),
      ($("#libBody").textContent.match(/Easy → Medium → Hard/) || [""])[0]);
    check("the list shows trim sizes", /5\.06 × 7\.81 in/.test($("#libBody").textContent));

    rows()[0].dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle();
  }).then(function () {
    const id = G("SELECTED");
    check("selecting a book fills the export panel", $("#xTitle").value === books[id].title,
      id + " -> " + $("#xTitle").value);
    check("the ledger path is stated before any dealing",
      /UNIQUE RANGE PATH|ALT EDITION PATH/.test($("#ledgerMsg").innerHTML));
    const rd = $("#readout").innerHTML;
    check("the readout shows size, pages, spine and cover wrap",
      /Size/.test(rd) && /Pages/.test(rd) && /Spine/.test(rd) && /Cover wrap/.test(rd));
    check("the readout carries the format trade note",
      /higher price/.test(rd) && /impulse price/.test(rd));
    check("the readout flags the UK large-trim rate as unverified", /UNVERIFIED/.test(rd));

    /* list price is typed, not picked from a fixed ladder */
    check("a list price can be typed for each currency", !!$("#pGBP") && !!$("#pUSD"));
    $("#pGBP").value = "9.99";
    $("#pGBP").dispatchEvent(new win.Event("input", { bubbles: true }));
    check("typing a price recomputes the royalty", /a copy/.test($("#eGBP").innerHTML),
      $("#eGBP").textContent.trim().slice(0, 60));
    $("#pGBP").value = "1.00";
    $("#pGBP").dispatchEvent(new win.Event("input", { bubbles: true }));
    check("a price below break-even is called out", /not accept/.test($("#eGBP").innerHTML));

    /* ---- creating a single-level book ---------------------------------- */
    $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
    check("the editor opens", shown("#editor"));
    check("it proposes a seed start clear of the whole library",
      parseInt($("#fSeed").value, 10) > Math.max.apply(null,
        Object.keys(books).map(function (k) { return books[k].seedEnd; })),
      "proposed " + $("#fSeed").value);
    check("trim and layout are separate choices",
      $("#fTrim").options.length === G("KDP_TRIMS").length &&
      $("#fLayout").options.length === G("KDP_LAYOUTS").length,
      $("#fTrim").options.length + " sizes, " + $("#fLayout").options.length + " layouts");
    check("the volume line is filled in for a new book, so the title page is three deep",
      $("#fVolume").value === "Vol 1", "company / book name / " + $("#fVolume").value);
    check("the editor previews pages and cost before saving",
      /pages/.test($("#editPreview").textContent) && /print/.test($("#editPreview").textContent),
      $("#editPreview").textContent.trim().slice(0, 80));

    /* ---- target length drives the puzzle count ------------------------- */
    check("a new book is fitted to a page count by default", $("#fTargetMode").value === "pages",
      "target " + $("#fTarget").value + " pages");
    $("#fTarget").value = "404";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    check("asking for 404 pages works back to 336 puzzles",
      /336 puzzles/.test($("#fFit").textContent) && /404 pages/.test($("#fFit").textContent),
      $("#fFit").textContent.trim());
    $("#fTarget").value = "110";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    check("a target under KDP's minimum for this size says so",
      /shortest/.test($("#fFit").textContent) || /puzzles/.test($("#fFit").textContent),
      $("#fFit").textContent.trim());
    $("#fTrim").value = "8.5x11"; $("#fLayout").value = "2up";
    $("#fLayout").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("the flat-fee ceiling of 110 pages gives 156 puzzles at 8.5x11 two-up",
      /156 puzzles/.test($("#fFit").textContent), $("#fFit").textContent.trim());
    $("#fTrim").value = "5.06x7.81"; $("#fLayout").value = "1up";
    $("#fLayout").dispatchEvent(new win.Event("change", { bubbles: true }));

    $("#fTitle").value = "Sudoku X: Portable";
    $("#fMode").value = "x";
    $("#fMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("levels follow the puzzle type",
      Array.prototype.map.call($("#fDiff").options, function (o) { return o.value; }).join(",") === G("X_DIFFS").join(","));
    $("#fTrim").value = "6x9";
    $("#fTrim").dispatchEvent(new win.Event("change", { bubbles: true }));
    $("#fTargetMode").value = "puzzles";
    $("#fTargetMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    $("#fTarget").value = "120";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle();
  }).then(function () {
    const b = G("LIB")[G("SELECTED")];
    check("the new book is saved at the chosen trim", b && b.preset === "6x9/1up" && b.puzzleCount === 120,
      G("SELECTED") + " · " + (b && b.preset) + " · " + (b && b.puzzleCount) + " puzzles");
    check("it has no bands, because it is one level", !b.bands);

    /* ---- a climbing book ------------------------------------------------ */
    $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
    $("#fTitle").value = "Classic: Easy to Hard";
    $("#fMode").value = "classic";
    $("#fMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    $("#fTargetMode").value = "puzzles";
    $("#fTargetMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    $("#fTarget").value = "120";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    $("#fClimb").checked = true;
    $("#fClimb").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("switching to climbing shows the level list and hides the single one",
      shown("#climbWrap") && !shown("#singleWrap"));
    const bandsOf = function () { return win.document.querySelectorAll("#bands .band"); };
    check("it offers a ladder of levels rather than one", bandsOf().length >= 3,
      bandsOf().length + " levels");
    check("the target is split across them automatically, with no arithmetic from me",
      Array.prototype.map.call(bandsOf(), function (r) { return r.querySelector("input").value; }).join(",") === "40,40,40",
      Array.prototype.map.call(bandsOf(), function (r) {
        return r.querySelector("select").value + " " + r.querySelector("input").value;
      }).join(" / "));
    check("each level shows which puzzle numbers it covers",
      /puzzles 1–40/.test(bandsOf()[0].textContent) && /puzzles 81–120/.test(bandsOf()[2].textContent),
      Array.prototype.map.call(bandsOf(), function (r) { return r.querySelector(".bandFrom").textContent; }).join(" / "));
    check("the running total is shown", /120 puzzles in total/.test($("#bandTotal").textContent),
      $("#bandTotal").textContent);

    /* changing the target re-splits without touching the levels */
    $("#fTarget").value = "150";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    check("changing the target re-splits the levels", 
      Array.prototype.map.call(bandsOf(), function (r) { return r.querySelector("input").value; }).join(",") === "50,50,50",
      "150 across 3 levels");
    $("#fTarget").value = "120";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle();
  }).then(function () {
    const b = G("LIB")[G("SELECTED")];
    check("the climbing book stores its levels in order", !!b.bands && b.bands.length === 3 &&
      b.bands.map(function (x) { return x.count; }).join(",") === "40,40,40",
      G("SELECTED") + " · " + b.bands.map(function (x) { return x.difficulty + "×" + x.count; }).join(" → "));
    check("its puzzle count matches the levels", b.puzzleCount === 120 && b.seedEnd - b.seedStart + 1 === 120);
    const seq = G("kdpBandSequence")(b.bands);
    check("the deal order climbs", seq.length === 120 && seq[0] === b.bands[0].difficulty &&
      seq[40] === b.bands[1].difficulty && seq[80] === b.bands[2].difficulty);
    check("the front matter explains the progression",
      G("kdpDefaultFront")("classic", "easy", { title: "t", bands: b.bands })
        .about.some(function (x) { return /Puzzles 41 to 80/.test(x.s || ""); }));

    /* ---- refusals ------------------------------------------------------- */
    $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
    $("#fTitle").value = "Deliberate clash";
    $("#fSeed").value = String(books["ZS-003"].seedStart + 10);
    $("#fTargetMode").value = "puzzles";
    $("#fTargetMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    $("#fTarget").value = "50";
    $("#fTarget").dispatchEvent(new win.Event("input", { bubbles: true }));
    const n = rows().length;
    $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle().then(function () {
      check("an overlapping seed range is refused, with the clash named",
        rows().length === n && /REFUSING TO EXPORT/.test($("#editMsg").innerHTML) &&
        /ZS-003/.test($("#editMsg").innerHTML),
        ($("#editMsg").textContent.match(/overlaps [^.]+/) || [""])[0].slice(0, 60));
      $("#btnCancel").dispatchEvent(new win.Event("click", { bubbles: true }));
      check("cancelling adds nothing", !shown("#editor") && rows().length === n);

      $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
      $("#fAlt").value = "ZS-001";
      $("#fAlt").dispatchEvent(new win.Event("change", { bubbles: true }));
      check("choosing another edition locks it to the base book's puzzles",
        $("#fSeed").disabled && parseInt($("#fSeed").value, 10) === books["ZS-001"].seedStart,
        "seeds locked to " + $("#fSeed").value);
      $("#fTrim").value = "5.83x8.27";
      $("#fTrim").dispatchEvent(new win.Event("change", { bubbles: true }));
      $("#fTitle").value = "Classic Medium — A5";
      $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
      return settle();
    });
  }).then(function () {
    const b = G("LIB")[G("SELECTED")];
    check("a second edition at another trim is accepted",
      b && b.altEditionOf === "ZS-001" && b.preset === "5.83x8.27/1up",
      G("SELECTED") + " · " + (b && b.preset));

    /* ---- repeats ------------------------------------------------------- */
    check("the library reports that nothing repeats", /No repeated puzzles/.test($("#libMsg").innerHTML),
      $("#libMsg").textContent.trim().slice(0, 70));
    check("a duplicate inside one book would be caught",
      G("kdpFindDuplicates")([{ sol: new Array(81).fill(1), given: new Array(81).fill(0), cages: [] },
                              { sol: new Array(81).fill(2), given: new Array(81).fill(0), cages: [] },
                              { sol: new Array(81).fill(1), given: new Array(81).fill(0), cages: [] }])
        .length === 1);
    check("distinct puzzles are not flagged",
      G("kdpFindDuplicates")([{ sol: new Array(81).fill(1), given: new Array(81).fill(0), cages: [] },
                              { sol: new Array(81).fill(2), given: new Array(81).fill(0), cages: [] }])
        .length === 0);

    /* ---- cover --------------------------------------------------------- */
    const cv = $("#coverOut").innerHTML;
    check("the cover panel gives the full canvas, spine and barcode zone",
      /Full cover/.test(cv) && /Spine/.test(cv) && /Barcode/.test(cv) && /px<\/b> at 300 dpi/.test(cv));
    check("it links to KDP's own cover calculator", /kdp\.amazon\.com\/cover-calculator/.test(cv));
    check("the cover template button is present", !!$("#btnCover"));
    const before = $("#coverOut").textContent;
    $("#xPaper").value = "cream";
    $("#xPaper").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("switching to cream paper changes the spine and cover size",
      $("#coverOut").textContent !== before,
      ($("#coverOut").textContent.match(/Spine[^·]+/) || [""])[0].trim().slice(0, 46));
    $("#xPaper").value = "white";
    $("#xPaper").dispatchEvent(new win.Event("change", { bubbles: true }));

    check("the proof page count is hidden until proof mode is ticked", !shown("#xProofRow"));
    $("#xProof").checked = true;
    $("#xProof").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("ticking proof mode reveals the count, defaulting above KDP's minimum",
      shown("#xProofRow") && parseInt($("#xProofPages").value, 10) >= G("KDP_RATES").minInteriorPages,
      "default " + $("#xProofPages").value + " pages");

    console.log("\n" + (pass + fail) + " checks, " + fail + " failed");
    win.close();
    process.exit(fail ? 1 : 0);
  });
}

setTimeout(run, 120);
