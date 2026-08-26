/* ==========================================================================
   Zaney Books — browser wiring.

   DOM only. Every calculation lives in core.js, which the Node tests load
   alongside engine.js, so the tests and this page run the same code.

   The library lives in localStorage so you can create and edit books here
   rather than hand-editing JSON. books.json in the repo is only the starting
   point; "Download books.json" writes the current library back out so you can
   commit it.
   ========================================================================== */

const $ = function (s) { return document.querySelector(s); };
const LIB_KEY = "zaney_books_v1";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function setStatus(el, html, cls) {
  el.className = "status " + (cls || "");
  el.innerHTML = html;
}

/* ---------------------------------------------------------------------------
   Library
--------------------------------------------------------------------------- */
let LIB = {};
let SELECTED = null;
let EDITING = null;          /* book id being edited, or "" for a new one */

function libLoad() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to the file */ }
  return null;
}
function libSave() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(LIB)); }
  catch (e) { setStatus($("#libMsg"), "Could not save to this browser's storage: " + esc(e.message), "warn"); }
}

function nextBookId() {
  let n = 0;
  for (const k in LIB) {
    const m = /^ZS-(\d+)$/.exec(k);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  }
  return "ZS-" + String(n + 1).padStart(3, "0");
}

/* Hand back a block that cannot collide with anything already in the library,
   rounded up to the next thousand so the ledger stays readable. */
function nextSeedStart() {
  let max = 9999;
  for (const k in LIB) if (LIB[k].seedEnd > max) max = LIB[k].seedEnd;
  return Math.ceil((max + 1) / 1000) * 1000;
}

function planFor(b) {
  try { return kdpPlan(b.preset, b.puzzleCount); }
  catch (e) { return null; }
}

function renderLibrary() {
  const ids = Object.keys(LIB).sort();
  const body = $("#libBody");
  if (!ids.length) {
    body.innerHTML = "<tr><td colspan='8' class='dim' style='padding:18px 0'>" +
      "No books yet. Hit <b>+ New book</b> to make one.</td></tr>";
    $("#expWho").textContent = "";
    $("#readout").innerHTML = "";
    $("#ledgerMsg").innerHTML = "";
    return;
  }
  body.innerHTML = ids.map(function (id) {
    const b = LIB[id], p = planFor(b);
    const label = (typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[b.difficulty]) || b.difficulty;
    return "<tr class='book" + (id === SELECTED ? " sel" : "") + "' data-id='" + esc(id) + "'>" +
      "<td class='mono'>" + esc(id) + "</td>" +
      "<td><b>" + esc(b.title) + "</b>" +
        (b.altEditionOf ? " <span class='pill'>alt of " + esc(b.altEditionOf) + "</span>" : "") + "</td>" +
      "<td>" + esc((KDP_MODE_NAME[b.mode] || b.mode).replace(" Sudoku", "")) + " · " + esc(label) + "</td>" +
      "<td>" + esc(b.preset) + " <span class='dim'>" + esc(KDP_PRESETS[b.preset] ? KDP_PRESETS[b.preset].name : "?") + "</span></td>" +
      "<td>" + b.puzzleCount + "</td>" +
      "<td>" + (p ? p.total : "<span class='bad'>—</span>") + "</td>" +
      "<td class='mono'>" + b.seedStart + "–" + b.seedEnd + "</td>" +
      "<td style='text-align:right;white-space:nowrap'>" +
        "<button class='ghost small' data-edit='" + esc(id) + "'>Edit</button> " +
        "<button class='danger small' data-del='" + esc(id) + "'>Delete</button></td>" +
      "</tr>";
  }).join("");

  body.querySelectorAll("tr.book").forEach(function (tr) {
    tr.addEventListener("click", function (e) {
      if (e.target.dataset.edit || e.target.dataset.del) return;
      selectBook(tr.dataset.id);
    });
  });
  body.querySelectorAll("[data-edit]").forEach(function (b) {
    b.addEventListener("click", function () { openEditor(b.dataset.edit); });
  });
  body.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () {
      const id = b.dataset.del;
      if (!confirm("Delete " + id + " (" + LIB[id].title + ")?\n\nThis only removes it from this browser. " +
                   "Download books.json afterwards if you want the change kept.")) return;
      delete LIB[id];
      if (SELECTED === id) SELECTED = null;
      libSave(); refresh();
    });
  });

  if (!SELECTED || !LIB[SELECTED]) SELECTED = ids[0];
}

function selectBook(id) {
  SELECTED = id;
  const b = LIB[id];
  $("#xTitle").value = b.title;
  $("#xSub").value = b.puzzleCount + " puzzles, every one verified";
  refresh();
}

function refresh() {
  renderLibrary();
  const b = LIB[SELECTED];
  if (!b) return;

  const label = DIFF_LABEL[b.difficulty] || b.difficulty;
  $("#expWho").textContent = SELECTED + " · " + b.title;

  let msg = "";
  try {
    const chk = kdpLedgerCheck(LIB, SELECTED);
    msg = "<p class='msg " + (chk.path === "altEdition" ? "warn" : "ok") + "'>" + esc(chk.message) + "</p>";
  } catch (e) {
    msg = "<p class='msg bad'>" + esc(e.message) + "</p>";
  }
  $("#ledgerMsg").innerHTML = msg;

  try {
    const plan = kdpPlan(b.preset, b.puzzleCount);
    $("#readout").innerHTML = renderReadout(plan, b.preset);
  } catch (e) {
    $("#readout").innerHTML = "<p class='msg bad'>" + esc(e.message) + "</p>";
  }
}

/* ---------------------------------------------------------------------------
   New / edit book
--------------------------------------------------------------------------- */
const MODES = [["killer", "Killer"], ["classic", "Classic"], ["x", "Sudoku X"], ["hyper", "Hyper"]];

function diffsFor(mode) {
  if (mode === "killer") return DIFFS;
  if (mode === "classic") return CLASSIC_DIFFS;
  if (mode === "x") return X_DIFFS;
  return H_DIFFS;
}

function syncDiffs() {
  const mode = $("#fMode").value, want = $("#fDiff").value;
  const ds = diffsFor(mode);
  $("#fDiff").innerHTML = ds.map(function (d) {
    return "<option value='" + d + "'>" + esc(DIFF_LABEL[d] || d) + "</option>";
  }).join("");
  if (ds.indexOf(want) >= 0) $("#fDiff").value = want;
}

function syncAltOptions() {
  const opts = ["<option value=''>— not an alt edition —</option>"];
  for (const id of Object.keys(LIB).sort()) {
    if (id === EDITING) continue;
    if (LIB[id].altEditionOf) continue;      /* no alt-of-an-alt */
    opts.push("<option value='" + esc(id) + "'>" + esc(id) + " — " + esc(LIB[id].title) + "</option>");
  }
  const want = $("#fAlt").value;
  $("#fAlt").innerHTML = opts.join("");
  if (want) $("#fAlt").value = want;
}

function applyAltLock() {
  const base = LIB[$("#fAlt").value];
  const locked = !!base;
  ["fMode", "fDiff", "fCount", "fSeed"].forEach(function (id) { $("#" + id).disabled = locked; });
  if (locked) {
    $("#fMode").value = base.mode; syncDiffs();
    $("#fDiff").value = base.difficulty;
    $("#fCount").value = base.puzzleCount;
    $("#fSeed").value = base.seedStart;
    $("#editHint").textContent = "An alt edition reuses " + $("#fAlt").value +
      "'s exact puzzles under a different preset — the same book in another format.";
  } else {
    $("#editHint").textContent = "";
  }
}

function openEditor(id) {
  EDITING = id || "";
  const b = id ? LIB[id] : null;
  $("#fMode").innerHTML = MODES.map(function (m) {
    return "<option value='" + m[0] + "'>" + m[1] + "</option>";
  }).join("");
  $("#fPreset").innerHTML = Object.keys(KDP_PRESETS).map(function (k) {
    return "<option value='" + k + "'>" + k + " — " + KDP_PRESETS[k].name + "</option>";
  }).join("");

  $("#fMode").value = b ? b.mode : "killer";
  syncDiffs();
  $("#fDiff").value = b ? b.difficulty : "hard";
  $("#fPreset").value = b ? b.preset : "A";
  $("#fCount").value = b ? b.puzzleCount : KDP_PRESETS[$("#fPreset").value].defaultPuzzles;
  $("#fTitle").value = b ? b.title : "";
  syncAltOptions();
  $("#fAlt").value = b && b.altEditionOf ? b.altEditionOf : "";
  $("#fSeed").value = b ? b.seedStart : nextSeedStart();
  applyAltLock();

  $("#editMsg").innerHTML = "";
  $("#editor").classList.remove("hide");
  $("#fTitle").focus();
}

function closeEditor() {
  $("#editor").classList.add("hide");
  EDITING = null;
}

function saveBook() {
  const count = parseInt($("#fCount").value, 10);
  const seedStart = parseInt($("#fSeed").value, 10);
  const title = $("#fTitle").value.trim();
  const alt = $("#fAlt").value || null;

  const fail = function (m) { $("#editMsg").innerHTML = "<p class='msg bad'>" + esc(m) + "</p>"; };

  if (!title) return fail("Give the book a title.");
  if (!(count > 0)) return fail("Puzzle count must be a positive number.");
  if (!(seedStart > 0)) return fail("Seed start must be a positive number.");
  if (seedStart + count - 1 > 100000)
    return fail("That seed range runs past 100,000, which is as far as the generator goes. " +
                "Use a lower seed start or fewer puzzles.");

  const id = EDITING || nextBookId();
  const entry = {
    title: title,
    mode: $("#fMode").value,
    difficulty: $("#fDiff").value,
    preset: $("#fPreset").value,
    seedStart: seedStart,
    seedEnd: seedStart + count - 1,
    puzzleCount: count,
    pageCount: 0,
    published: (EDITING && LIB[id] && LIB[id].published) || null,
    asin: (EDITING && LIB[id] && LIB[id].asin) || null
  };
  if (alt) entry.altEditionOf = alt;

  /* Validate against a copy, so a rejected edit cannot corrupt the library. */
  const candidate = Object.assign({}, LIB);
  candidate[id] = entry;
  try {
    kdpLedgerCheck(candidate, id);
  } catch (e) {
    return fail(e.message);
  }
  const plan = planFor(entry);
  if (!plan)
    return fail("That combination does not make a valid book — most likely under KDP's 24-page " +
                "minimum. Add more puzzles or pick a preset with fewer per page.");
  entry.pageCount = plan.total;

  LIB[id] = entry;
  SELECTED = id;
  libSave();
  closeEditor();
  selectBook(id);
}

/* ---------------------------------------------------------------------------
   Readout
--------------------------------------------------------------------------- */
function money(v, cur) { return (cur === "GBP" ? "£" : "$") + v.toFixed(2); }

function renderReadout(plan, presetId) {
  const pr = kdpPricing(plan), warns = kdpWarnings(plan);
  const P = plan.preset, cover = pr.cover;
  let h = "";
  for (const w of warns) {
    const cls = w.level === "error" ? "bad" : w.level === "warn" ? "warn" : "note";
    h += "<p class='msg " + cls + "'>" + (w.level === "error" ? "⛔ " : w.level === "warn" ? "⚠ " : "ℹ ") + esc(w.text) + "</p>";
  }
  h += "<table class='kv'>";
  const row = function (k, v) { h += "<tr><th>" + k + "</th><td>" + v + "</td></tr>"; };
  row("Preset", "<b>" + presetId + " — " + P.name + "</b> · " + P.trimIn[0] + " × " + P.trimIn[1] + " in · " + plan.category + " trim");
  row("Puzzles", plan.puzzleCount + " · " + P.puzzlesPerPage + "/page · solutions " + P.solsPerPage + "/page");
  row("Pages", "<b>" + plan.total + "</b> <span class='dim'>(6 front + " + plan.puzzlePages +
    " puzzle + divider/verso + " + plan.solutionPages + " solutions + back matter" +
    (plan.recotFiller ? " + 1 recto filler" : "") + (plan.evenPad ? " + 1 even pad" : "") + ")</span>");
  row("Gutter", plan.gutterIn + " in <span class='dim'>(" + plan.gutterTier.min + "–" + plan.gutterTier.max +
    " pp tier; KDP's own minimum there is " + plan.gutterTier.tierIn + " in)</span>");
  row("Divider", "page " + plan.dividerPage + " <span class='dim'>(recto ✓)</span>");
  row("Spine", pr.spineIn.toFixed(4) + " in / " + pr.spineCm.toFixed(2) + " cm");
  row("Cover wrap", "<b>" + cover.w.toFixed(3) + " × " + cover.h.toFixed(3) + " in</b> <span class='dim'>— for Canva</span>");
  for (const cur of ["USD", "GBP"]) {
    const c = pr.currencies[cur];
    row(cur + " print cost", "<b>" + money(c.print, cur) + "</b> " + (c.flatFee ? "flat" : "per-page") +
      (c.verified ? "" : " <span class='warnInline'>(UNVERIFIED)</span>"));
    row(cur + " min list", money(c.minListFlat60, cur) + " at 60% · " + money(c.minListTiered, cur) + " at 50%");
  }
  h += "</table>";
  h += "<p class='dim small' style='margin:12px 0 4px'><b>Royalty per copy</b> — two models. <i>Flat 60%</i> is " +
    "what I believe KDP pays for paperback; <i>tiered</i> is the 60/50 split, which is the Kindle rule. " +
    "Check in KDP before pricing.</p>";
  h += "<table class='kv royalty'><tr><th>List</th><th class='r'>Flat 60%</th><th class='r'>Tiered</th></tr>";
  for (const cur of ["GBP", "USD"]) {
    for (const pt of pr.currencies[cur].points) {
      h += "<tr><td>" + money(pt.list, cur) + "</td><td class='r" + (pt.flat60 <= 0 ? " bad" : "") + "'>" +
        money(pt.flat60, cur) + "</td><td class='r dim'>" + money(pt.tiered, cur) +
        " <span class='small'>@" + Math.round(pt.tierRate * 100) + "%</span></td></tr>";
    }
  }
  h += "</table>";
  h += "<p class='trade'>The <b>Brick</b> earns more per copy at a higher price point but is a harder sell and " +
    "slower to produce. The <b>Compact</b> earns roughly £3 a copy at an impulse price. You are deliberately " +
    "running both — this is the trade, every time you export.</p>";
  h += "<p class='dim small'>Rates last verified " + KDP_RATES.LAST_VERIFIED + " — edit KDP_RATES in core.js when Amazon revises them.</p>";
  return h;
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
    if (!self.crypto || !self.crypto.subtle)
      return { src: src, lock: lock, sha: null, unverified: true };
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
  'postMessage({num:d.num,diff:d.diff,kind:d.kind,sol:Array.from(p.sol),' +
  'cages:p.cages,cageOf:Array.from(p.cageOf),given:Array.from(p.given)});};';

function dealSync(kind, diff, num) {
  if (kind === "classic") return dealClassic(num, diff);
  if (kind === "x") return dealX(num, diff);
  if (kind === "hyper") return dealHyper(num, diff);
  return Object.assign(dealPuzzle(num, diff), { kind: "killer" });
}

function dealPool(engineSrc, kind, diff, seedStart, count, onProgress) {
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
        settle(idx, dealSync(kind, diff, seedStart + idx));
        setTimeout(tick, 0);
      };
      return tick();
    }
    const feed = function (w) {
      if (next >= count) return false;
      w._idx = next++;
      w.postMessage({ num: seedStart + w._idx, diff: diff, kind: kind });
      return true;
    };
    workers.forEach(function (w) {
      w.onmessage = function (e) { const i = w._idx; settle(i, hydrate(e.data)); feed(w); };
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
  let plan, engineSrc;

  setStatus(prog, "Checking the puzzle engine…");
  getEngine().then(function (eng) {
    engineSrc = eng.src;
    const chk = kdpLedgerCheck(LIB, id);      /* throws on an overlapping range */
    plan = kdpPlan(book.preset, book.puzzleCount);
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
    return dealPool(engineSrc, book.mode, book.difficulty, book.seedStart, need, function (d, t) {
      if (d % 4 === 0 || d === t) setStatus(prog, "Dealing " + d + " of " + t + "…");
    }).then(function (deck) { return { deck: deck, limit: limit }; });
  }).then(function (bundle) {
    const label = DIFF_LABEL[book.difficulty] || book.difficulty;
    const puzzles = bundle.deck.map(function (P, i) {
      return { P: P, n: i + 1, label: "Puzzle " + (i + 1), solLabel: String(i + 1), diffLabel: label };
    });
    const front = kdpDefaultFront(book.mode, book.difficulty, {
      title: $("#xTitle").value.trim() || book.title,
      subtitle: $("#xSub").value.trim(),
      author: $("#xAuthor").value.trim() || undefined,
      isbn: $("#xIsbn").value.trim(),
      puzzleCount: book.puzzleCount,
      year: new Date().getUTCFullYear()
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
      bookId: id, mode: book.mode, diff: book.difficulty,
      seedStart: book.seedStart, seedEnd: book.seedEnd, puzzleCount: book.puzzleCount,
      puzzles: puzzles, front: front,
      runningHead: (KDP_MODE_NAME[book.mode] || book.mode) + " · " + label,
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
              const name = "zaney-" + id + "-preset" + plan.presetId +
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
      "Stripped " + r.out.report.stripped.length + " unembedded base-14 fonts, normalised " +
      r.out.report.mediaBoxes + " MediaBoxes, pinned /ID to <code>" + r.out.report.id + "</code>." +
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
  setStatus($("#libMsg"), "Downloaded. Drop it into the repo root and commit it to keep the library.", "ok");
}

function boot() {
  if (location.protocol === "file:") {
    setStatus($("#engineStatus"),
      "Open this over http, not file:// — the browser blocks the fetches it needs.", "bad");
    return;
  }

  getEngine().then(function (eng) {
    if (eng.unverified) {
      setStatus($("#engineStatus"), "engine not verified (needs https or localhost)", "warn");
    } else {
      setStatus($("#engineStatus"), "engine verified · <code>" + eng.sha.slice(0, 12) + "…</code>", "ok");
    }
  }).catch(function (e) {
    setStatus($("#engineStatus"), esc(e.message), "bad");
  });

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
$("#fMode").addEventListener("change", syncDiffs);
$("#fAlt").addEventListener("change", applyAltLock);
$("#fPreset").addEventListener("change", function () {
  if (!EDITING && !$("#fAlt").value) $("#fCount").value = KDP_PRESETS[$("#fPreset").value].defaultPuzzles;
});
$("#xProof").addEventListener("change", function () {
  $("#xProofRow").classList.toggle("hide", !$("#xProof").checked);
});
$("#btnExport").addEventListener("click", doExport);

boot();
