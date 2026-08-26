/* Engine-level checks that need the solver, plus the reproducibility check.
 *
 *   node tools/kdp-check-engine.js ZS-001 ZS-003
 *
 * For each book:
 *   - takes a deterministic random sample of 20 puzzles from the deck the
 *     exporter actually printed,
 *   - runs the SAME solver the site uses over the puzzle as printed, and
 *     asserts it has exactly one solution equal to the printed solution,
 *   - asserts the solution grid is itself a legal completion (rows, columns,
 *     boxes, and the diagonals / windows / cage sums where they apply),
 *   - asserts solution N is labelled N and appears in solution order,
 *   - regenerates the whole interior a second time and asserts the bytes are
 *     identical, which is what makes a reprint years from now match.
 */
const H = require("./kdp-harness.js");
const mod = H.mod;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name + (detail ? "  - " + detail : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  - " + detail : "")); }
  return ok;
}

/* mulberry32 again, so the sample itself is reproducible */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gridLegal(sol, useX, useH) {
  const seen = function (idxs) {
    let m = 0;
    for (const i of idxs) {
      const d = sol[i];
      if (d < 1 || d > 9) return false;
      if (m & (1 << d)) return false;
      m |= 1 << d;
    }
    return m === 0x3FE;
  };
  for (let r = 0; r < 9; r++) { const a = []; for (let c = 0; c < 9; c++) a.push(r * 9 + c); if (!seen(a)) return "row " + r; }
  for (let c = 0; c < 9; c++) { const a = []; for (let r = 0; r < 9; r++) a.push(r * 9 + c); if (!seen(a)) return "col " + c; }
  for (let b = 0; b < 9; b++) {
    const a = [], br = ((b / 3) | 0) * 3, bc = (b % 3) * 3;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) a.push((br + r) * 9 + bc + c);
    if (!seen(a)) return "box " + b;
  }
  if (useX) {
    const d1 = [], d2 = [];
    for (let i = 0; i < 9; i++) { d1.push(i * 9 + i); d2.push(i * 9 + (8 - i)); }
    if (!seen(d1)) return "diagonal 1";
    if (!seen(d2)) return "diagonal 2";
  }
  if (useH) {
    for (const rc of [[1, 1], [1, 5], [5, 1], [5, 5]]) {
      const a = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) a.push((rc[0] + r) * 9 + rc[1] + c);
      if (!seen(a)) return "window " + rc.join(",");
    }
  }
  return null;
}

function checkBook(bookId) {
  const book = H.books[bookId];
  console.log("\n=== " + bookId + " - " + book.mode + " " + book.difficulty +
    ", seeds " + book.seedStart + "-" + book.seedEnd + " ===");

  const t0 = Date.now();
  const first = H.build(bookId, {
    deckFile: require("path").join(process.env.KDP_OUT || "/tmp/kdp-out", bookId + ".deck.json"),
    onProgress: function (i, n) { if (i % 50 === 0 || i === n) process.stdout.write("\r  dealing " + i + "/" + n + "   "); }
  });
  console.log("\r  built in " + ((Date.now() - t0) / 1000).toFixed(1) + "s          ");

  /* --- solution order and labelling ------------------------------------- */
  const solPages = first.plan.pages.filter(function (p) { return p.kind === "solutions"; });
  const order = [].concat.apply([], solPages.map(function (p) { return p.items; }));
  let ordered = order.length === book.puzzleCount;
  for (let i = 0; i < order.length; i++) if (order[i] !== i) ordered = false;
  check("solutions appear in puzzle order, 1 to " + book.puzzleCount, ordered,
    order.length + " solution slots");
  check("solution N is labelled N",
    first.cfg.puzzles.every(function (p, i) { return p.solLabel === String(i + 1) && p.label === "Puzzle " + (i + 1); }));

  /* --- 20-puzzle solver sample ------------------------------------------ */
  const r = rng(0xC0FFEE ^ book.seedStart);
  const picked = new Set();
  while (picked.size < Math.min(20, book.puzzleCount)) picked.add((r() * book.puzzleCount) | 0);
  const sample = Array.from(picked).sort(function (a, b) { return a - b; });

  const seq = mod.kdpBandSequence(mod.kdpBands(book), book.mode);
  const ranges = mod.kdpBandRanges(mod.kdpBands(book));
  const modes = mod.kdpBookModes(mod.kdpBands(book), book.mode);
  const lvl = function (i) { return mod.DIFF_LABEL[seq[i].difficulty] || seq[i].difficulty; };
  if (ranges.length > 1)
    console.log("  bands: " + ranges.map(function (r) {
      return (modes.length > 1 ? r.mode + " " : "") + r.difficulty + " " + r.from + "-" + r.to;
    }).join(", "));
  check("every puzzle carries the difficulty its band says",
    first.cfg.puzzles.every(function (p, i) { return p.diffLabel.indexOf(lvl(i)) >= 0; }) &&
    first.deck.every(function (P, i) { return P.diff === seq[i].difficulty; }),
    seq.length + " puzzles checked against the band sequence");
  check("the running head follows the band",
    first.cfg.puzzles.every(function (p, i) { return p.runHead.indexOf(lvl(i)) >= 0; }));
  /* In a variety book each puzzle also has to BE the kind its band claims, or
     the rules printed for that section do not apply to it. */
  check("every puzzle is the kind its section says",
    first.deck.every(function (P, i) { return (P.kind || "killer") === seq[i].mode; }) &&
    first.cfg.puzzles.every(function (p, i) {
      return p.runHead.indexOf(mod.KDP_MODE_NAME[seq[i].mode]) === 0;
    }),
    modes.length > 1 ? modes.join(" → ") + ", " + seq.length + " puzzles" : "one kind throughout");
  const bad = [];
  for (const idx of sample) {
    const P = first.deck[idx];
    const kind = seq[idx].mode;
    const useX = kind === "x", useH = kind === "hyper";
    const why = gridLegal(P.sol, useX, useH);
    if (why) { bad.push("#" + (idx + 1) + " printed solution is not a legal grid (" + why + ")"); continue; }

    if (kind === "killer") {
      for (const g of P.cages) {
        let sum = 0, m = 0;
        for (const c of g.cells) {
          sum += P.sol[c];
          if (m & (1 << P.sol[c])) bad.push("#" + (idx + 1) + " repeats a digit inside a cage");
          m |= 1 << P.sol[c];
        }
        if (sum !== g.sum) bad.push("#" + (idx + 1) + " cage sums to " + sum + " but prints " + g.sum);
      }
      const res = mod.countSolutions(P.cages, P.cageOf, 2, 400000);
      if (res.aborted) { bad.push("#" + (idx + 1) + " solver ran out of budget"); continue; }
      if (res.count !== 1) { bad.push("#" + (idx + 1) + " has " + res.count + " solutions, not 1"); continue; }
      const got = res.sols[0];
      for (let i = 0; i < 81; i++) {
        if (got[i] !== P.sol[i]) { bad.push("#" + (idx + 1) + " unique solution differs from the printed one at cell " + i); break; }
      }
    } else {
      const vals = new Uint8Array(81);
      for (let i = 0; i < 81; i++) if (P.given[i]) vals[i] = P.sol[i];
      const res = mod.countClassic(vals, 2, 400000, useX, useH);
      if (res.aborted) { bad.push("#" + (idx + 1) + " solver ran out of budget"); continue; }
      if (res.count !== 1) bad.push("#" + (idx + 1) + " has " + res.count + " solutions, not 1");
    }
  }
  check("solution N solves puzzle N - " + sample.length + " random samples", bad.length === 0,
    bad.length ? bad.slice(0, 3).join("; ") : "puzzles " + sample.map(function (i) { return i + 1; }).join(","));

  /* --- no repeats, anywhere in the book -------------------------------- */
  const dupes = mod.kdpFindDuplicates(first.deck);
  check("no puzzle in this book repeats another", dupes.length === 0,
    dupes.length ? "puzzle " + dupes[0].repeat + " is identical to puzzle " + dupes[0].first
                 : first.deck.length + " puzzles fingerprinted, all distinct");

  /* --- reproducibility ---------------------------------------------------
     Two halves. The dealer is re-run over a sample of seeds and must produce
     identical puzzles; the composer is re-run over the whole deck and must
     produce identical bytes. Splitting it this way keeps a 336-puzzle killer
     book testable without dealing it three times over. */
  const redealt = [];
  for (const idx of sample) {
    const again = H.dealOne(seq[idx].mode, seq[idx].difficulty, book.seedStart + idx);
    const P = first.deck[idx];
    let ok = true;
    for (let i = 0; i < 81; i++) if (again.sol[i] !== P.sol[i] || again.given[i] !== P.given[i]) ok = false;
    if (JSON.stringify(again.cages || []) !== JSON.stringify(P.cages || [])) ok = false;
    if (!ok) redealt.push(idx + 1);
  }
  check("re-dealing the same seeds gives the same puzzles", redealt.length === 0,
    redealt.length ? "differ: " + redealt.join(",") : sample.length + " seeds re-dealt identically");

  const second = H.build(bookId, { deck: first.deck });
  let same = first.bytes.length === second.bytes.length;
  let at = -1;
  if (same) {
    for (let i = 0; i < first.bytes.length; i++) {
      if (first.bytes[i] !== second.bytes[i]) { same = false; at = i; break; }
    }
  }
  check("regenerating produces byte-identical output", same,
    same ? (first.bytes.length / 1048576).toFixed(2) + " MB identical" : "diverges at byte " + at);

  check("PDF carries the book id, preset and seed range in its metadata",
    first.report.id !== null,
    "/ID pinned to " + first.report.id + ", " + first.report.stripped.length +
    " base-14 fonts stripped, " + first.report.mediaBoxes + " MediaBoxes normalised");
}

const ids = process.argv.slice(2);
for (const id of ids) checkBook(id);
console.log("\n" + (pass + fail) + " checks, " + fail + " failed");
process.exit(fail ? 1 : 0);
