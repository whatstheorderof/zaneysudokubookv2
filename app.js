/* ==========================================================================
   Zaney Books — browser wiring.

   DOM only. Every calculation lives in core.js, which the Node tests load
   alongside engine.js, so the tests and this page run the same code.

   The library lives in localStorage so books are made here rather than by
   hand-editing JSON. books.json in the repo is the starting point;
   "Download books.json" writes the current library back out to commit.
   ========================================================================== */

const $ = function (s) { return document.querySelector(s); };
const LIB_KEY = "zaney_books_v1";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function setStatus(el, html, cls) { el.className = "status " + (cls || ""); el.innerHTML = html; }
function money(v, cur) { return (cur === "GBP" ? "£" : "$") + v.toFixed(2); }
function diffName(d) { return (DIFF_LABEL && DIFF_LABEL[d]) || d; }

let LIB = {};
let SELECTED = null;
let EDITING = null;

/* ---------------------------------------------------------------------------
   Storage
--------------------------------------------------------------------------- */
function libLoad() {
  try { const raw = localStorage.getItem(LIB_KEY); if (raw) return JSON.parse(raw); }
  catch (e) { /* fall through to the file */ }
  return null;
}
function libSave() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(LIB)); }
  catch (e) { setStatus($("#libMsg"), "Could not save to this browser: " + esc(e.message), "warn"); }
}
function nextBookId() {
  let n = 0;
  for (const k in LIB) { const m = /^ZS-(\d+)$/.exec(k); if (m) n = Math.max(n, parseInt(m[1], 10)); }
  return "ZS-" + String(n + 1).padStart(3, "0");
}
/* A block that cannot collide with anything already here, rounded to a
   thousand so the ledger stays readable. */
function nextSeedStart() {
  let max = 9999;
  for (const k in LIB) if (LIB[k].seedEnd > max) max = LIB[k].seedEnd;
  return Math.ceil((max + 1) / 1000) * 1000;
}
function planFor(b) { try { return kdpPlanFor(b); } catch (e) { return null; } }
function paperChoice() { const el = $("#xPaper"); return el ? el.value : "white"; }

/* ---------------------------------------------------------------------------
   Library table
--------------------------------------------------------------------------- */
function bandSummary(b) {
  const bands = kdpBands(b);
  const mixed = kdpBookModes(bands, b.mode).length > 1;
  const name = function (x) {
    return mixed ? (KDP_MODE_NAME[x.mode] || x.mode) + " " + diffName(x.difficulty).toLowerCase()
                 : diffName(x.difficulty);
  };
  if (bands.length === 1) return name(bands[0]);
  return bands.map(name).join(mixed ? ", " : " → ");
}

/* Checking only the selected book would let a clash sit unnoticed in a corner
   of the library until the day you exported it. Audit the lot, every render. */
function renderAudit() {
  const problems = kdpAuditLedger(LIB);
  if (!problems.length) {
    const n = Object.keys(LIB).length;
    $("#libMsg").innerHTML = n
      ? "<p class='msg ok'>No repeated puzzles: all " + n + " book" + (n === 1 ? "" : "s") +
        " checked against each other, every seed range accounted for.</p>"
      : "";
    return;
  }
  $("#libMsg").innerHTML = "<p class='msg bad'>Repeated puzzles in the library — fix before publishing:<br>" +
    problems.map(function (p) { return "· " + esc(p.message); }).join("<br>") + "</p>";
}

function renderLibrary() {
  const ids = Object.keys(LIB).sort();
  const body = $("#libBody");
  if (!ids.length) {
    body.innerHTML = "<tr><td colspan='6' class='dim' style='padding:18px 0'>" +
      "No books yet. Hit <b>+ New book</b>.</td></tr>";
    $("#expWho").textContent = ""; $("#readout").innerHTML = ""; $("#ledgerMsg").innerHTML = "";
    return;
  }
  body.innerHTML = ids.map(function (id) {
    const b = LIB[id], p = planFor(b);
    const preset = KDP_PRESETS[kdpResolvePreset(b.preset)];
    return "<tr class='book" + (id === SELECTED ? " sel" : "") + "' data-id='" + esc(id) + "'>" +
      "<td class='mono'>" + esc(id) + "</td>" +
      "<td><b>" + esc(b.title) + "</b>" +
        (b.altEditionOf ? " <span class='pill'>same puzzles as " + esc(b.altEditionOf) + "</span>" : "") +
        "<br><span class='dim small'>" + esc((KDP_MODE_NAME[b.mode] || b.mode)) + " · " + esc(bandSummary(b)) + "</span></td>" +
      "<td>" + b.puzzleCount + "</td>" +
      "<td>" + (preset ? esc(preset.trimIn[0] + " × " + preset.trimIn[1] + " in") +
        "<br><span class='dim small'>" + esc(preset.name) + "</span>" : "<span class='bad'>?</span>") + "</td>" +
      "<td>" + (p ? p.total : "<span class='bad'>—</span>") + "</td>" +
      "<td style='text-align:right;white-space:nowrap'>" +
        "<button class='ghost small' data-edit='" + esc(id) + "'>Edit</button> " +
        "<button class='danger small' data-del='" + esc(id) + "'>Delete</button></td></tr>";
  }).join("");

  body.querySelectorAll("tr.book").forEach(function (tr) {
    tr.addEventListener("click", function (e) {
      if (e.target.dataset.edit || e.target.dataset.del) return;
      selectBook(tr.dataset.id);
    });
  });
  body.querySelectorAll("[data-edit]").forEach(function (el) {
    el.addEventListener("click", function () { openEditor(el.dataset.edit); });
  });
  body.querySelectorAll("[data-del]").forEach(function (el) {
    el.addEventListener("click", function () {
      const id = el.dataset.del;
      if (!confirm("Delete " + id + " (" + LIB[id].title + ")?\n\nThis only removes it from this browser.")) return;
      delete LIB[id];
      if (SELECTED === id) SELECTED = null;
      libSave(); refresh();
    });
  });
  if (!SELECTED || !LIB[SELECTED]) SELECTED = ids[0];
  renderAudit();
}

function selectBook(id) {
  SELECTED = id;
  const b = LIB[id];
  $("#xTitle").value = b.title;
  $("#xVolume").value = b.volume || "";
  $("#xSub").value = b.puzzleCount + " puzzles, every one verified";
  refresh();
}

function refresh() {
  renderLibrary();
  const b = LIB[SELECTED];
  if (!b) return;
  $("#expWho").textContent = SELECTED + " · " + b.title;
  try {
    const chk = kdpLedgerCheck(LIB, SELECTED);
    $("#ledgerMsg").innerHTML = "<p class='msg " + (chk.path === "altEdition" ? "warn" : "ok") + "'>" +
      esc(chk.message) + "</p>";
  } catch (e) {
    $("#ledgerMsg").innerHTML = "<p class='msg bad'>" + esc(e.message) + "</p>";
  }
  try {
    const plan = kdpPlanFor(b);
    $("#readout").innerHTML = renderReadout(plan, b);
    wirePriceInputs(plan);
    $("#coverOut").innerHTML = renderCover(plan);
  } catch (e) {
    $("#readout").innerHTML = "<p class='msg bad'>" + esc(e.message) + "</p>";
    $("#coverOut").innerHTML = "";
  }
}

/* ---------------------------------------------------------------------------
   Cover — the same numbers KDP's cover calculator returns, from the page count
   this exporter will actually produce.
--------------------------------------------------------------------------- */
function renderCover(plan) {
  const c = kdpCoverSpec(plan, paperChoice());
  let h = "<table class='kv'>";
  const row = function (k, v) { h += "<tr><th>" + k + "</th><td>" + v + "</td></tr>"; };
  row("Full cover", "<b>" + c.fullIn[0].toFixed(3) + " × " + c.fullIn[1].toFixed(3) + " in</b> · " +
    c.fullCm[0].toFixed(2) + " × " + c.fullCm[1].toFixed(2) + " cm · <b>" +
    c.fullPx300[0] + " × " + c.fullPx300[1] + " px</b> at 300 dpi");
  row("Spine", c.spineIn.toFixed(4) + " in / " + c.spineCm.toFixed(2) + " cm <span class='dim'>· " +
    c.pages + " pages on " + c.paper + " paper</span>");
  row("Spine text", c.spineTextAllowed
    ? "allowed — keep it inside " + c.spineTextSafeIn.toFixed(3) + " in"
    : "<span class='warnInline'>not allowed — KDP needs " + c.spineTextMinPages + "+ pages</span>");
  row("Panels from the left", "back at " + c.backFromLeftIn.toFixed(3) + " in · spine at " +
    c.spineFromLeftIn.toFixed(3) + " in · front at " + c.frontFromLeftIn.toFixed(3) + " in");
  row("Bleed / safe", c.bleedIn + " in bleed on all four edges · keep text " + c.safeMarginIn +
    " in inside the trim");
  row("Barcode", c.barcode.wIn + " × " + c.barcode.hIn + " in on the back cover, " +
    c.barcode.fromLeftIn.toFixed(3) + " in from the left and " + c.barcode.fromBottomIn.toFixed(2) +
    " in up — keep artwork clear of it");
  h += "</table>";
  h += "<p class='dim small'>The template is a PDF at exactly this size with the trim, spine, safe areas " +
    "and barcode zone drawn on it — drop it into Canva as an underlay. Worth checking one against " +
    "<a href='https://kdp.amazon.com/cover-calculator' target='_blank' rel='noopener'>KDP's own calculator</a> " +
    "at title setup; these follow their published formulas, but theirs is what KDP validates.</p>";
  return h;
}

function downloadCover() {
  const b = LIB[SELECTED];
  if (!b) { setStatus($("#coverProg"), "Pick a book first.", "warn"); return; }
  try {
    const plan = kdpPlanFor(b);
    const spec = kdpCoverSpec(plan, paperChoice());
    const out = kdpBuildCoverTemplate(window.jspdf.jsPDF, window.KDP_FONTS, spec,
      { title: [$("#xTitle").value.trim() || b.title, $("#xVolume").value.trim()].filter(Boolean).join(" "),
        bookId: SELECTED });
    const name = "zaney-" + SELECTED + "-cover-" + spec.fullIn[0].toFixed(3) + "x" +
      spec.fullIn[1].toFixed(3) + "in.pdf";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out.bytes], { type: "application/pdf" }));
    a.download = name; a.click();
    setStatus($("#coverProg"), "<b>Done — " + esc(name) + "</b><br>Set your Canva canvas to " +
      spec.fullPx300[0] + " × " + spec.fullPx300[1] + " px and place this underneath.", "ok");
  } catch (e) {
    setStatus($("#coverProg"), esc(e.message), "bad");
  }
}

/* ---------------------------------------------------------------------------
   Editor
--------------------------------------------------------------------------- */
const MODES = [["killer", "Killer"], ["classic", "Classic"], ["x", "Sudoku X"], ["hyper", "Hyper"]];

function fillDiffSelect(sel, mode, want) {
  const ds = kdpValidDifficulties(mode);
  sel.innerHTML = ds.map(function (d) { return "<option value='" + d + "'>" + esc(diffName(d)) + "</option>"; }).join("");
  sel.value = ds.indexOf(want) >= 0 ? want : ds[0];
}

function currentPresetId() { return $("#fTrim").value + "/" + $("#fLayout").value; }

function bandRows() { return Array.prototype.slice.call(document.querySelectorAll("#bands .band")); }

/* A section is a run of puzzles of one type at one level. The type dropdown is
   what makes a variety book possible: leave every row on the book's own type
   and nothing changes, or set them differently and the book carries the rules
   for each. */
function bandMode(row) { return row.querySelector(".bandMode").value; }
function bandDiff(row) { return row.querySelector(".bandDiff").value; }

function addBandRow(mode, difficulty, count) {
  mode = mode || $("#fMode").value;
  const div = document.createElement("div");
  div.className = "band";
  div.innerHTML = "<select class='bandMode'>" +
    MODES.map(function (m) { return "<option value='" + m[0] + "'>" + esc(m[1]) + "</option>"; }).join("") +
    "</select><select class='bandDiff'></select>" +
    "<input type='number' min='1' value='" + (count || 50) + "'>" +
    "<span class='bandFrom'></span><button class='danger small' type='button'>Remove</button>";
  $("#bands").appendChild(div);
  div.querySelector(".bandMode").value = mode;
  fillDiffSelect(div.querySelector(".bandDiff"), mode, difficulty);
  /* Changing a section's type re-offers that type's levels — Coward's exists
     for classic and nowhere else, nightmare only for killer. */
  div.querySelector(".bandMode").addEventListener("change", function () {
    /* Pinned once touched, so changing the book's own type later does not undo
       a section the book deliberately set to something else. */
    div.dataset.pinned = "1";
    fillDiffSelect(div.querySelector(".bandDiff"), bandMode(div), bandDiff(div));
    autoSplit(); updatePreview();
  });
  div.querySelector("input").addEventListener("input", updatePreview);
  div.querySelector(".bandDiff").addEventListener("change", function () { autoSplit(); updatePreview(); });
  div.querySelector("button").addEventListener("click", function () {
    if (bandRows().length <= 1) return;
    div.remove(); autoSplit(); updatePreview();
  });
  updatePreview();
}

/* What the target field asks for, translated into puzzles. */
function targetPuzzles() {
  const n = parseInt($("#fTarget").value, 10);
  if (!(n > 0)) return { count: 0 };
  if ($("#fTargetMode").value === "puzzles") return { count: n };
  try {
    /* kdpPuzzlesForPages names the field puzzleCount; normalise it here so
       every caller sees one shape. */
    const r = kdpPuzzlesForPages(currentPresetId(), n, { modes: editorModes() });
    return { count: r.puzzleCount, pages: r.pages, short: r.short };
  } catch (e) { return { count: 0, error: e.message }; }
}

function readBands() {
  if ($("#fSingle").checked)
    return [{ mode: $("#fMode").value, difficulty: $("#fDiff").value, count: targetPuzzles().count }];
  return bandRows().map(function (r) {
    return { mode: bandMode(r), difficulty: bandDiff(r),
             count: parseInt(r.querySelector("input").value, 10) || 0 };
  });
}

/* The distinct types in the editor right now, in order. The page count depends
   on it, because each type brings its own rules section.

   Read straight off the rows, never via readBands(): readBands() asks
   targetPuzzles() how many puzzles fit, targetPuzzles() asks this which types
   are in play, and routing that through readBands() again is a loop with no
   bottom. */
function editorModes() {
  if ($("#fSingle").checked) return [$("#fMode").value];
  return kdpBookModes(bandRows().map(function (r) { return { mode: bandMode(r) }; }),
                      $("#fMode").value);
}

/* Spread the target across whatever levels are listed. Called whenever the
   target or the level list changes, so the split follows the book rather than
   having to be worked out by hand. */
function autoSplit() {
  if ($("#fSingle").checked) return;
  const rows = bandRows();
  if (!rows.length) return;
  const split = kdpSplitBands(targetPuzzles().count,
    rows.map(function (r) { return { mode: bandMode(r), difficulty: bandDiff(r) }; }));
  rows.forEach(function (r, i) { r.querySelector("input").value = split[i].count; });
}

function updatePreview() {
  const t = targetPuzzles();
  $("#fFit").innerHTML = t.error ? "<span class='bad'>" + esc(t.error) + "</span>"
    : t.count ? (t.count + " puzzles" + (t.pages ? " · " + t.pages + " pages" : "") +
        (t.short ? " <span class='warnInline'>(the shortest KDP will take)</span>" : ""))
    : "—";

  const bands = readBands();
  const total = kdpBandTotal(bands);
  const ranges = kdpBandRanges(bands);
  bandRows().forEach(function (r, i) {
    const g = ranges[i];
    r.querySelector(".bandFrom").textContent = g ? "puzzles " + g.from + "–" + g.to : "";
  });
  $("#bandTotal").textContent = total + " puzzles in total";

  let line = total + " puzzle" + (total === 1 ? "" : "s");
  try {
    const plan = kdpPlan(currentPresetId(), total, { modes: kdpBookModes(bands, $("#fMode").value) });
    const pr = kdpPricing(plan, paperChoice());
    line += " → <b>" + plan.total + " pages</b> · spine " + pr.spineCm.toFixed(2) + " cm · " +
      "print " + money(pr.currencies.GBP.print, "GBP") + " / " + money(pr.currencies.USD.print, "USD");
  } catch (e) {
    line += " → <span class='bad'>" + esc(e.message) + "</span>";
  }
  $("#editPreview").innerHTML = line;
}

function syncAltOptions() {
  const opts = ["<option value=''>— its own puzzles —</option>"];
  for (const id of Object.keys(LIB).sort()) {
    if (id === EDITING || LIB[id].altEditionOf) continue;
    opts.push("<option value='" + esc(id) + "'>" + esc(id) + " — " + esc(LIB[id].title) + "</option>");
  }
  const want = $("#fAlt").value;
  $("#fAlt").innerHTML = opts.join("");
  if (want) $("#fAlt").value = want;
}

function applyAltLock() {
  const base = LIB[$("#fAlt").value];
  const locked = !!base;
  ["fMode", "fDiff", "fSeed", "fSingle", "fClimb", "fTarget", "fTargetMode"].forEach(function (id) { $("#" + id).disabled = locked; });
  bandRows().forEach(function (r) {
    r.querySelector(".bandMode").disabled = locked;
    r.querySelector(".bandDiff").disabled = locked;
    r.querySelector("input").disabled = locked;
  });
  $("#btnAddBand").disabled = locked;
  if (locked) {
    $("#fMode").value = base.mode;
    setBands(kdpBands(base), base.mode);
    $("#fTargetMode").value = "puzzles";
    $("#fTarget").value = base.puzzleCount;
    $("#fSeed").value = base.seedStart;
    $("#editHint").textContent = "This will be the same puzzles as " + $("#fAlt").value +
      " in a different size — a second edition of one title. Pick a different trim or layout below.";
  } else {
    $("#editHint").textContent = "Seed start is chosen for you, clear of every other book. " +
      "Only change it if you know why.";
  }
  updatePreview();
}

function setBands(bands, mode) {
  $("#bands").innerHTML = "";
  fillDiffSelect($("#fDiff"), mode, bands[0].difficulty);
  $(bands.length === 1 ? "#fSingle" : "#fClimb").checked = true;
  for (const b of bands) addBandRow(b.mode || mode, b.difficulty, b.count);
  syncDiffMode();
}

function syncDiffMode() {
  const climb = $("#fClimb").checked;
  $("#climbWrap").classList.toggle("hide", !climb);
  $("#singleWrap").classList.toggle("hide", climb);
  if (climb) {
    /* first time in, offer a sensible ladder rather than one lonely level */
    if (bandRows().length < 2) {
      const ds = kdpValidDifficulties($("#fMode").value);
      $("#bands").innerHTML = "";
      for (const d of ds.slice(0, 3)) addBandRow($("#fMode").value, d, 1);
    }
    autoSplit();
  }
  updatePreview();
}

function openEditor(id) {
  EDITING = id || "";
  const b = id ? LIB[id] : null;

  $("#fMode").innerHTML = MODES.map(function (m) { return "<option value='" + m[0] + "'>" + m[1] + "</option>"; }).join("");
  $("#fTrim").innerHTML = KDP_TRIMS.map(function (t) {
    return "<option value='" + t.id + "'>" + t.wIn + " × " + t.hIn + " in — " + esc(t.name) + "</option>";
  }).join("");
  $("#fLayout").innerHTML = KDP_LAYOUTS.map(function (L) {
    return "<option value='" + L.id + "'>" + esc(L.name) + "</option>";
  }).join("");

  const preset = KDP_PRESETS[kdpResolvePreset(b ? b.preset : "5.06x7.81/1up")] || KDP_PRESETS["5.06x7.81/1up"];
  $("#fMode").value = b ? b.mode : "killer";
  $("#fTrim").value = preset.trimId;
  $("#fLayout").value = preset.layoutId;
  $("#fTitle").value = b ? b.title : "";
  $("#fVolume").value = b ? (b.volume || "") : "Vol 1";

  const startBands = b ? kdpBands(b) : [{ difficulty: "hard", count: preset.defaultPuzzles }];
  const startCount = kdpBandTotal(startBands);
  $("#fTargetMode").value = "pages";
  try { $("#fTarget").value = kdpPlan(currentPresetId(), startCount,
          { modes: kdpBookModes(startBands, b ? b.mode : "killer") }).total; }
  catch (e) { $("#fTargetMode").value = "puzzles"; $("#fTarget").value = startCount; }
  setBands(startBands, $("#fMode").value);
  syncAltOptions();
  $("#fAlt").value = b && b.altEditionOf ? b.altEditionOf : "";
  $("#fSeed").value = b ? b.seedStart : nextSeedStart();
  applyAltLock();

  $("#editMsg").innerHTML = "";
  $("#editor").classList.remove("hide");
  $("#fTitle").focus();
}

function closeEditor() { $("#editor").classList.add("hide"); EDITING = null; }

function saveBook() {
  const fail = function (m) { $("#editMsg").innerHTML = "<p class='msg bad'>" + esc(m) + "</p>"; };
  const bands = readBands();
  const count = kdpBandTotal(bands);
  const seedStart = parseInt($("#fSeed").value, 10);
  const title = $("#fTitle").value.trim();
  const volume = $("#fVolume").value.trim();
  const alt = $("#fAlt").value || null;

  if (!title) return fail("Give the book a name — the middle line of the title page.");
  if (!(count > 0)) return fail("The book needs at least one puzzle.");
  for (const b of bands) if (!(b.count > 0)) return fail("Every difficulty level needs at least one puzzle.");
  if (!(seedStart > 0)) return fail("Seed start must be a positive number.");
  if (seedStart + count - 1 > 100000)
    return fail("That seed range runs past 100,000, which is as far as the puzzle numbering goes. " +
                "Use a lower seed start or fewer puzzles.");

  const id = EDITING || nextBookId();
  const prev = LIB[id];
  const entry = {
    title: title,
    volume: volume,
    mode: $("#fMode").value,
    difficulty: bands[0].difficulty,
    preset: currentPresetId(),
    seedStart: seedStart,
    seedEnd: seedStart + count - 1,
    puzzleCount: count,
    pageCount: 0,
    published: (prev && prev.published) || null,
    asin: (prev && prev.asin) || null
  };
  if (bands.length > 1) entry.bands = bands;
  if (alt) entry.altEditionOf = alt;

  const candidate = Object.assign({}, LIB);
  candidate[id] = entry;
  try { kdpLedgerCheck(candidate, id); } catch (e) { return fail(e.message); }

  const plan = planFor(entry);
  if (!plan)
    return fail("That does not make a valid book — most likely under KDP's 24-page minimum. " +
                "Add more puzzles, or put fewer on a page.");
  entry.pageCount = plan.total;

  LIB[id] = entry;
  SELECTED = id;
  libSave();
  closeEditor();
  selectBook(id);
}

/* ---------------------------------------------------------------------------
   Costs readout
--------------------------------------------------------------------------- */
function renderReadout(plan, book) {
  const pr = kdpPricing(plan, paperChoice()), warns = kdpWarnings(plan);
  const P = plan.preset;
  let h = "";
  for (const w of warns) {
    const cls = w.level === "error" ? "bad" : w.level === "warn" ? "warn" : "note";
    h += "<p class='msg " + cls + "'>" + (w.level === "error" ? "⛔ " : w.level === "warn" ? "⚠ " : "ℹ ") +
      esc(w.text) + "</p>";
  }
  h += "<table class='kv'>";
  const row = function (k, v) { h += "<tr><th>" + k + "</th><td>" + v + "</td></tr>"; };
  row("Size", "<b>" + P.trimIn[0] + " × " + P.trimIn[1] + " in</b> · " + esc(P.name) + " · " + plan.category + " trim");
  row("Puzzles", plan.puzzleCount + " · " + esc(bandSummary(book)) + " · " + P.puzzlesPerPage + " a page");
  row("Pages", "<b>" + plan.total + "</b> <span class='dim'>(" + (plan.puzzleStart - 1) +
    " front + " + plan.puzzlePages + " puzzle + divider + " + plan.solutionPages +
    " solutions + back matter)</span>");
  row("Gutter", plan.gutterIn + " in <span class='dim'>(" + plan.gutterTier.min + "–" + plan.gutterTier.max + " pp tier)</span>");
  row("Spine", pr.spineIn.toFixed(4) + " in / " + pr.spineCm.toFixed(2) + " cm");
  row("Cover wrap", "<b>" + pr.cover.w.toFixed(3) + " × " + pr.cover.h.toFixed(3) + " in</b> <span class='dim'>— for Canva</span>");
  for (const cur of ["GBP", "USD"]) {
    const c = pr.currencies[cur];
    row(cur + " print cost", "<b>" + money(c.print, cur) + "</b> " + (c.flatFee ? "flat" : "per-page") +
      (c.verified ? "" : " <span class='warnInline'>(UNVERIFIED)</span>") +
      " <span class='dim'>· breaks even at " + money(c.minListFlat60, cur) + "</span>");
  }
  h += "</table>";

  h += "<p class='dim small' style='margin:14px 0 2px'><b>What you would earn</b> — type your list price. " +
    "Flat 60% is what I believe KDP pays for paperback; the tiered figure is the 60/50 split, which is the " +
    "Kindle rule. Check in KDP before committing.</p>";
  for (const cur of ["GBP", "USD"]) {
    const c = pr.currencies[cur];
    const suggested = c.points[1] ? c.points[1].list : Math.ceil(c.minListFlat60) + 0.99;
    h += "<div class='price'><div><label for='p" + cur + "'>" + cur + " list price</label>" +
      "<input id='p" + cur + "' type='number' step='0.01' min='0' value='" + suggested.toFixed(2) + "'></div>" +
      "<div class='earn' id='e" + cur + "'></div></div>";
  }

  h += "<p class='trade'>The <b>bigger book at a higher price</b> earns more per copy but is a harder sell and " +
    "slower to produce. The <b>compact one</b> earns roughly £3 a copy at an impulse price. Running both is " +
    "deliberate — this is the trade, every time you export.</p>";
  h += "<p class='dim small'>Rates last verified " + KDP_RATES.LAST_VERIFIED + " — edit KDP_RATES in core.js when Amazon revises them.</p>";
  return h;
}

function wirePriceInputs(plan) {
  const pr = kdpPricing(plan, paperChoice());
  for (const cur of ["GBP", "USD"]) {
    const input = $("#p" + cur), out = $("#e" + cur);
    if (!input) continue;
    const update = function () {
      const list = parseFloat(input.value);
      if (!(list > 0)) { out.innerHTML = ""; return; }
      const r = kdpRoyalty(list, pr.currencies[cur].print, cur);
      const cls = r.flat60 <= 0 ? "bad" : "";
      out.innerHTML = "<span class='" + cls + "'>" + money(r.flat60, cur) + " a copy</span>" +
        "<span class='dim small'> at flat 60% · " + money(r.tiered, cur) + " at the tiered " +
        Math.round(r.tierRate * 100) + "%</span>" +
        (r.flat60 <= 0 ? "<br><span class='bad small'>Below the break-even price — KDP will not accept this.</span>" : "");
    };
    input.addEventListener("input", update);
    update();
  }
}

/* ---------------------------------------------------------------------------
   Engine: verified against its lock, and the source for the worker pool
--------------------------------------------------------------------------- */
let enginePromise = null;
function getEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = Promise.all([
    fetch("./engine.js", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("engine.js " + r.status); return r.text();
    }),
    fetch("./engine.lock.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("engine.lock.json " + r.status); return r.json();
    })
  ]).then(function (res) {
    const src = res[0], lock = res[1];
    if (!self.crypto || !self.crypto.subtle) return { src: src, lock: lock, sha: null, unverified: true };
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(src)).then(function (buf) {
      const hex = Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
      if (hex !== lock.sha256File)
        throw new Error("engine.js does not match engine.lock.json.\nexpected " + lock.sha256File +
          "\nfound    " + hex + "\n\nThat file is copied from the site and must not be edited here — " +
          "changing it changes every puzzle in every book you have already printed.");
      return { src: src, lock: lock, sha: hex };
    });
  }).catch(function (e) { enginePromise = null; throw e; });
  return enginePromise;
}

const WORKER_TAIL =
  ';onmessage=function(e){var d=e.data;' +
  'var p = d.kind==="classic"?dealClassic(d.num,d.diff)' +
  ' : d.kind==="x"?dealX(d.num,d.diff) : d.kind==="hyper"?dealHyper(d.num,d.diff)' +
  ' : dealPuzzle(d.num,d.diff);' +
  'postMessage({i:d.i,num:d.num,diff:d.diff,kind:d.kind,sol:Array.from(p.sol),' +
  'cages:p.cages,cageOf:Array.from(p.cageOf),given:Array.from(p.given)});};';

function dealSync(kind, diff, num) {
  if (kind === "classic") return dealClassic(num, diff);
  if (kind === "x") return dealX(num, diff);
  if (kind === "hyper") return dealHyper(num, diff);
  return Object.assign(dealPuzzle(num, diff), { kind: "killer" });
}

/* seq[i] is {mode, difficulty} for puzzle i, so a book that climbs — or one
   that changes type partway through — deals correctly. */
function dealPool(engineSrc, seq, seedStart, count, onProgress) {
  return new Promise(function (resolve, reject) {
    const out = new Array(count);
    let next = 0, done = 0;
    if (count === 0) return resolve(out);
    const hydrate = function (d) {
      return { num: d.num, diff: d.diff, kind: d.kind, sol: Uint8Array.from(d.sol),
               cages: d.cages, cageOf: Int16Array.from(d.cageOf), given: Uint8Array.from(d.given) };
    };
    const workers = [];
    const settle = function (idx, P) {
      out[idx] = P; done++;
      if (onProgress) onProgress(done, count);
      if (done === count) { workers.forEach(function (w) { try { w.terminate(); } catch (e) {} }); resolve(out); }
    };
    const nw = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    try {
      const url = URL.createObjectURL(new Blob([engineSrc + WORKER_TAIL], { type: "text/javascript" }));
      for (let i = 0; i < nw; i++) workers.push(new Worker(url));
    } catch (e) { /* fall through to the main thread */ }

    if (!workers.length) {
      const tick = function () {
        if (next >= count) return;
        const idx = next++;
        settle(idx, dealSync(seq[idx].mode, seq[idx].difficulty, seedStart + idx));
        setTimeout(tick, 0);
      };
      return tick();
    }
    const feed = function (w) {
      if (next >= count) return false;
      const i = next++;
      w.postMessage({ i: i, num: seedStart + i, diff: seq[i].difficulty, kind: seq[i].mode });
      return true;
    };
    workers.forEach(function (w) {
      w.onmessage = function (e) { settle(e.data.i, hydrate(e.data)); feed(w); };
      w.onerror = function (ev) {
        workers.forEach(function (x) { try { x.terminate(); } catch (e) {} });
        reject(new Error("A dealing worker failed: " + (ev.message || "unknown") + ". Reload and try again."));
      };
    });
    for (let i = 0; i < workers.length; i++) if (!feed(workers[i])) break;
  });
}

/* ---------------------------------------------------------------------------
   Export
--------------------------------------------------------------------------- */
function doExport() {
  const prog = $("#progress");
  const id = SELECTED, book = LIB[id];
  if (!book) { setStatus(prog, "Pick a book from the library first.", "warn"); return; }

  const proof = $("#xProof").checked;
  const proofPages = parseInt($("#xProofPages").value, 10) || 24;
  const seq = kdpBandSequence(kdpBands(book), book.mode);
  let plan;

  setStatus(prog, "Checking the puzzle engine…");
  getEngine().then(function (eng) {
    const chk = kdpLedgerCheck(LIB, id);
    plan = kdpPlanFor(book);
    const errs = kdpWarnings(plan).filter(function (w) { return w.level === "error"; });
    if (errs.length) throw new Error(errs.map(function (w) { return w.text; }).join("\n\n"));

    setStatus(prog, "<b>" + chk.path.toUpperCase() + "</b> — " + esc(chk.message) +
      "<br>" + plan.total + " pages, gutter " + plan.gutterIn + " in, divider on page " + plan.dividerPage + ".");

    const limit = proof ? Math.min(proofPages, plan.pages.length) : plan.pages.length;
    let need = book.puzzleCount;
    if (proof) {
      need = 0;
      for (let i = 0; i < limit; i++) {
        const pg = plan.pages[i];
        if (pg.items) for (const idx of pg.items) need = Math.max(need, idx + 1);
      }
    }
    return dealPool(eng.src, seq, book.seedStart, need, function (d, t) {
      if (d % 4 === 0 || d === t) setStatus(prog, "Dealing " + d + " of " + t + "…");
    }).then(function (deck) {
      /* Overlapping ranges are refused by the ledger; this is the other half of
         the promise — no two puzzles inside one book are the same either. */
      const dupes = kdpFindDuplicates(deck);
      if (dupes.length)
        throw new Error("REPEATED PUZZLES. Puzzle " + dupes[0].repeat + " is identical to puzzle " +
          dupes[0].first + (dupes.length > 1 ? ", and " + (dupes.length - 1) + " more pair(s)" : "") +
          ". Nothing has been exported. This should be impossible — please report the book id and seed range.");
      return { deck: deck, limit: limit };
    });
  }).then(function (bundle) {
    const modeName = KDP_MODE_NAME[book.mode] || book.mode;
    const bookModes = kdpBookModes(kdpBands(book), book.mode);
    const puzzles = bundle.deck.map(function (P, i) {
      const label = diffName(seq[i].difficulty);
      const kind = KDP_MODE_NAME[seq[i].mode] || seq[i].mode;
      /* In a variety book the label above the grid names the kind too, because
         the reader has to know which rules apply before they start. */
      const shown = bookModes.length > 1 ? kind + " · " + label : label;
      return { P: P, n: i + 1, label: "Puzzle " + (i + 1), solLabel: String(i + 1),
               diffLabel: shown, runHead: kind + " · " + label };
    });
    const front = kdpDefaultFront(book.mode, book.difficulty, {
      bookName: $("#xTitle").value.trim() || book.title,
      volume: $("#xVolume").value.trim(),
      subtitle: $("#xSub").value.trim(),
      author: $("#xAuthor").value.trim() || undefined,
      isbn: $("#xIsbn").value.trim(),
      puzzleCount: book.puzzleCount,
      year: new Date().getUTCFullYear(),
      bands: kdpBands(book), modes: bookModes
    });
    const solPage = plan.solutionStart;
    front.howto = front.howto.map(function (pg) {
      return pg.map(function (b) {
        const c = Object.assign({}, b);
        if (c.s) c.s = String(c.s).split("{{SOLUTIONS_PAGE}}").join(String(solPage));
        return c;
      });
    });
    const cfg = {
      bookId: id, mode: book.mode, diff: book.difficulty, bands: kdpBands(book),
      seedStart: book.seedStart, seedEnd: book.seedEnd, puzzleCount: book.puzzleCount,
      puzzles: puzzles, front: front,
      runningHead: modeName + " · " + diffName(book.difficulty),
      seriesList: kdpSeriesList(LIB, id),
      trace: false
    };
    const asm = kdpAssembler(window.jspdf.jsPDF, window.KDP_FONTS, plan, cfg, bundle.limit);
    return new Promise(function (resolve, reject) {
      const pump = function () {
        try {
          asm.step(6);
          if (!asm.done()) {
            setStatus(prog, "Composing page " + asm.progress() + " of " + asm.total + "…");
            return setTimeout(pump, 0);
          }
          setStatus(prog, "Embedding fonts and finalising…");
          setTimeout(function () {
            try {
              const outp = asm.finish();
              const name = "zaney-" + id + "-" + plan.preset.trimId.replace(/\./g, "_") +
                (proof ? "-PROOF-" + asm.total + "of" + plan.total + "pp" : "-" + plan.total + "pp") + ".pdf";
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([outp.bytes], { type: "application/pdf" }));
              a.download = name; a.click();
              resolve({ out: outp, name: name });
            } catch (e) { reject(e); }
          }, 0);
        } catch (e) { reject(e); }
      };
      pump();
    });
  }).then(function (r) {
    setStatus(prog, "<b>Done — " + esc(r.name) + "</b><br>" +
      "No repeated puzzles. Stripped " + r.out.report.stripped.length +
      " unembedded base-14 fonts, normalised " + r.out.report.mediaBoxes +
      " MediaBoxes, pinned /ID to <code>" + r.out.report.id + "</code>." +
      ($("#xProof").checked ? "<br>Proof mode — KDP rejects interiors under " + KDP_RATES.minInteriorPages +
        " pages, so keep the proof at " + KDP_RATES.minInteriorPages + "+ if you want the upload to go through." : ""), "ok");
  }).catch(function (e) {
    setStatus(prog, esc(e.message || e), "bad");
  });
}

/* ---------------------------------------------------------------------------
   Boot
--------------------------------------------------------------------------- */
function downloadLedger() {
  const clean = {};
  for (const id of Object.keys(LIB).sort()) clean[id] = LIB[id];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 2) + "\n"], { type: "application/json" }));
  a.download = "books.json"; a.click();
  setStatus($("#libMsg"), "Downloaded. Drop it in the repo root and commit it to keep the library.", "ok");
}

function boot() {
  if (location.protocol === "file:") {
    setStatus($("#engineStatus"), "Open this over http, not file:// — the browser blocks the fetches it needs.", "bad");
    return;
  }
  getEngine().then(function (eng) {
    if (eng.unverified) setStatus($("#engineStatus"), "engine not verified (needs https or localhost)", "warn");
    else setStatus($("#engineStatus"), "engine verified · <code>" + eng.sha.slice(0, 12) + "…</code>", "ok");
  }).catch(function (e) { setStatus($("#engineStatus"), esc(e.message), "bad"); });

  const stored = libLoad();
  if (stored) { LIB = stored; refresh(); return; }
  fetch("./books.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (seed) { LIB = seed || {}; libSave(); refresh(); });
}

$("#btnNew").addEventListener("click", function () { openEditor(""); });
$("#btnCancel").addEventListener("click", closeEditor);
$("#btnSaveBook").addEventListener("click", saveBook);
$("#btnSave").addEventListener("click", downloadLedger);
$("#btnReset").addEventListener("click", function () {
  if (!confirm("Discard this browser's library and reload books.json from the repo?")) return;
  try { localStorage.removeItem(LIB_KEY); } catch (e) {}
  LIB = {}; SELECTED = null; boot();
});
$("#btnAddBand").addEventListener("click", function () {
  const last = bandRows().slice(-1)[0];
  const mode = last ? bandMode(last) : $("#fMode").value;
  const ds = kdpValidDifficulties(mode);
  let nextDiff = ds[0];
  if (last) {
    const i = ds.indexOf(bandDiff(last));
    nextDiff = ds[Math.min(i + 1, ds.length - 1)];
  }
  addBandRow(mode, nextDiff, 1);
  autoSplit();
  updatePreview();
});
$("#btnVariety").addEventListener("click", function () {
  /* One section of each type, all at the same level, split evenly. The fastest
     route to a variety book, which is a category of its own on KDP. */
  const want = $("#fClimb").checked ? null : $("#fDiff").value;
  $("#fClimb").checked = true; syncDiffMode();
  $("#bands").innerHTML = "";
  for (const m of MODES) {
    const ds = kdpValidDifficulties(m[0]);
    addBandRow(m[0], ds.indexOf(want) >= 0 ? want : ds[Math.min(1, ds.length - 1)], 1);
  }
  autoSplit();
  updatePreview();
});
$("#fMode").addEventListener("change", function () {
  const mode = $("#fMode").value;
  fillDiffSelect($("#fDiff"), mode, $("#fDiff").value);
  /* Sections still pointing at the old book type follow it; ones deliberately
     set to something else are left alone. */
  bandRows().forEach(function (r) {
    if (r.dataset.pinned === "1") return;
    r.querySelector(".bandMode").value = mode;
    fillDiffSelect(r.querySelector(".bandDiff"), mode, bandDiff(r));
  });
  updatePreview();
});
$("#fTrim").addEventListener("change", function () { autoSplit(); updatePreview(); });
$("#fLayout").addEventListener("change", function () { autoSplit(); updatePreview(); });
$("#fDiff").addEventListener("change", updatePreview);
$("#fTarget").addEventListener("input", function () { autoSplit(); updatePreview(); });
$("#fTargetMode").addEventListener("change", function () { autoSplit(); updatePreview(); });
$("#btnSplitEven").addEventListener("click", function () { autoSplit(); updatePreview(); });
$("#xPaper").addEventListener("change", refresh);
$("#btnCover").addEventListener("click", downloadCover);
$("#fSingle").addEventListener("change", syncDiffMode);
$("#fClimb").addEventListener("change", syncDiffMode);
$("#fAlt").addEventListener("change", applyAltLock);
$("#xProof").addEventListener("change", function () {
  $("#xProofRow").classList.toggle("hide", !$("#xProof").checked);
});
$("#btnExport").addEventListener("click", doExport);

boot();
