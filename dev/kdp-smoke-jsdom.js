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
    ["kdpPlan", "kdpPricing", "kdpLedgerCheck", "kdpAssembler", "kdpFixup"]
      .every(function (n) { return typeof G(n) === "function"; }));

  return settle(200).then(function () {
    check("the page fetches only its own files", fetched.length > 0 &&
      fetched.every(function (u) { return /books\.json|engine\.js|engine\.lock\.json/.test(u); }),
      fetched.join(", "));
    check("the engine is verified against its lock on load",
      /engine verified/.test($("#engineStatus").innerHTML), $("#engineStatus").textContent.trim());

    /* ---- library ------------------------------------------------------- */
    check("the library renders every book from books.json",
      rows().length === Object.keys(books).length,
      rows().length + " rows: " + Array.prototype.map.call(rows(), function (r) { return r.dataset.id; }).join(", "));
    check("the library is persisted to this browser",
      !!win.localStorage.getItem("zaney_books_v1"),
      Object.keys(JSON.parse(win.localStorage.getItem("zaney_books_v1"))).length + " entries stored");
    check("page counts are computed per row",
      /402/.test($("#libBody").textContent) && /110/.test($("#libBody").textContent));

    /* ---- selecting a book drives the export panel and readout ---------- */
    rows()[0].dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle();
  }).then(function () {
    const id = G("SELECTED");
    check("selecting a book fills the export panel", $("#xTitle").value === books[id].title,
      id + " -> " + $("#xTitle").value);
    check("the ledger path is stated before any dealing",
      /UNIQUE RANGE PATH|ALT EDITION PATH/.test($("#ledgerMsg").innerHTML),
      ($("#ledgerMsg").textContent.match(/(UNIQUE RANGE|ALT EDITION) PATH/) || [""])[0]);
    const rd = $("#readout").innerHTML;
    check("the readout shows pages, gutter, spine and cover wrap",
      /Gutter/.test(rd) && /Spine/.test(rd) && /Cover wrap/.test(rd) && /Pages/.test(rd));
    check("the readout shows both royalty models", /Flat 60%/.test(rd) && /Tiered/.test(rd));
    check("the readout carries the Brick-vs-Compact trade note",
      /Brick/.test(rd) && /Compact/.test(rd) && /impulse price/.test(rd));
    check("the readout flags the UK large-trim rate as unverified", /UNVERIFIED/.test(rd));

    /* ---- creating a book ----------------------------------------------- */
    const before = rows().length;
    $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
    check("the new-book editor opens", !$("#editor").classList.contains("hide"));
    check("it proposes a seed start clear of everything in the library",
      parseInt($("#fSeed").value, 10) > Math.max.apply(null, Object.keys(books).map(function (k) { return books[k].seedEnd; })),
      "proposed " + $("#fSeed").value);
    check("puzzle count defaults from the chosen preset",
      parseInt($("#fCount").value, 10) === G("KDP_PRESETS")[$("#fPreset").value].defaultPuzzles,
      $("#fPreset").value + " -> " + $("#fCount").value);

    $("#fTitle").value = "Hyper Sudoku: Expert";
    $("#fMode").value = "hyper";
    $("#fMode").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("difficulties follow the mode",
      Array.prototype.map.call($("#fDiff").options, function (o) { return o.value; }).join(",") === G("H_DIFFS").join(","),
      $("#fDiff").options.length + " options for hyper");
    $("#fDiff").value = "expert";
    $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle();
  }).then(function () {
    check("the new book is added and selected", rows().length === Object.keys(books).length + 1 &&
      G("LIB")[G("SELECTED")].title === "Hyper Sudoku: Expert",
      G("SELECTED") + " · seeds " + G("LIB")[G("SELECTED")].seedStart + "–" + G("LIB")[G("SELECTED")].seedEnd);
    check("its page count was computed and stored", G("LIB")[G("SELECTED")].pageCount > 24,
      G("LIB")[G("SELECTED")].pageCount + " pages");
    check("the new book survives in storage",
      !!JSON.parse(win.localStorage.getItem("zaney_books_v1"))[G("SELECTED")]);

    /* ---- an overlapping range must be refused --------------------------- */
    $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
    $("#fTitle").value = "Deliberate clash";
    $("#fSeed").value = String(books["ZS-003"].seedStart + 10);
    $("#fCount").value = "50";
    $("#fPreset").value = "B";
    const n = rows().length;
    $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
    return settle().then(function () {
      check("an overlapping seed range is refused, with the clash named",
        rows().length === n && /REFUSING TO EXPORT/.test($("#editMsg").innerHTML) &&
        /ZS-003/.test($("#editMsg").innerHTML),
        ($("#editMsg").textContent.match(/overlaps [^.]+/) || [""])[0].slice(0, 70));
      $("#btnCancel").dispatchEvent(new win.Event("click", { bubbles: true }));
      check("cancelling closes the editor without adding anything",
        $("#editor").classList.contains("hide") && rows().length === n);

      /* ---- alt-edition flow ------------------------------------------- */
      $("#btnNew").dispatchEvent(new win.Event("click", { bubbles: true }));
      $("#fAlt").value = "ZS-001";
      $("#fAlt").dispatchEvent(new win.Event("change", { bubbles: true }));
      check("choosing an alt edition locks it to the base book's puzzles",
        $("#fCount").disabled && $("#fSeed").disabled &&
        parseInt($("#fSeed").value, 10) === books["ZS-001"].seedStart,
        "seeds locked to " + $("#fSeed").value);
      $("#fPreset").value = "A";
      $("#fTitle").value = "Classic Medium — Large Print";
      $("#btnSaveBook").dispatchEvent(new win.Event("click", { bubbles: true }));
      return settle();
    });
  }).then(function () {
    const b = G("LIB")[G("SELECTED")];
    check("the alt edition is accepted under a different preset",
      b && b.altEditionOf === "ZS-001" && b.preset === "A" && b.seedStart === books["ZS-001"].seedStart,
      G("SELECTED") + " alt of ZS-001, preset " + (b && b.preset));
    check("its ledger line says it is deliberately reusing the range",
      /ALT EDITION PATH/.test($("#ledgerMsg").innerHTML));

    /* ---- proof toggle ------------------------------------------------- */
    const shown = function (sel) { return win.getComputedStyle($(sel)).display !== "none"; };
    check("the proof page count is really hidden until proof mode is ticked",
      !shown("#xProofRow"), "computed display: " + win.getComputedStyle($("#xProofRow")).display);
    $("#xProof").checked = true;
    $("#xProof").dispatchEvent(new win.Event("change", { bubbles: true }));
    check("ticking proof mode reveals the count, defaulting above KDP's minimum",
      shown("#xProofRow") && parseInt($("#xProofPages").value, 10) >= G("KDP_RATES").minInteriorPages,
      "default " + $("#xProofPages").value + " pages");
    check("the editor is hidden when closed, by computed style too", !shown("#editor"));

    console.log("\n" + (pass + fail) + " checks, " + fail + " failed");
    win.close();
    process.exit(fail ? 1 : 0);
  });
}

setTimeout(run, 120);
