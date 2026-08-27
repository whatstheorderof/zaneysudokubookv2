/* Negative tests: the refusals are the point, so prove they fire.
 *
 *   node tools/kdp-check-guards.js
 *
 * Everything here is expected to THROW. A guard that quietly passes is worse
 * than no guard, because it reads as a check that ran.
 */
const H = require("./kdp-harness.js");
const mod = H.mod;

let pass = 0, fail = 0;
function refuses(name, fn, expectFragment) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) {
    fail++; console.log("  FAIL  " + name + "  - did NOT throw");
    return;
  }
  if (expectFragment && threw.message.indexOf(expectFragment) < 0) {
    fail++; console.log("  FAIL  " + name + "  - threw, but message lacked " +
      JSON.stringify(expectFragment) + ": " + threw.message.slice(0, 120));
    return;
  }
  pass++; console.log("  PASS  " + name + "  - " + threw.message.split("\n")[0].slice(0, 96));
}
function allows(name, fn) {
  try { const r = fn(); pass++; console.log("  PASS  " + name + (r ? "  - " + r : "")); }
  catch (e) { fail++; console.log("  FAIL  " + name + "  - threw: " + e.message.slice(0, 120)); }
}

const base = {
  "ZS-A": { title: "A", mode: "killer", difficulty: "hard", preset: "A",
            seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
};
function withBooks(extra) { return Object.assign({}, base, extra); }

console.log("\n=== seed ledger ===");

refuses("overlapping seed ranges are refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "B", mode: "killer", difficulty: "expert", preset: "A",
              seedStart: 20300, seedEnd: 20635, puzzleCount: 336 }
  }), "ZS-B");
}, "REFUSING TO EXPORT");

refuses("a range touching by a single seed is refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "B", mode: "killer", difficulty: "expert", preset: "A",
              seedStart: 20335, seedEnd: 20670, puzzleCount: 336 }
  }), "ZS-B");
}, "REFUSING TO EXPORT");

allows("a range one seed clear is allowed", function () {
  return mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "B", mode: "killer", difficulty: "expert", preset: "A",
              seedStart: 20336, seedEnd: 20671, puzzleCount: 336 }
  }), "ZS-B").path;
});

allows("altEditionOf reusing the exact range under another preset is allowed", function () {
  return mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-B").path;
});

allows("the BASE edition still exports once an alt edition of it exists", function () {
  return mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-A").path;
});

refuses("altEditionOf under the SAME preset is refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A again", mode: "killer", difficulty: "hard", preset: "A",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-B");
}, "SAME preset");

allows("two alt editions of the same book are allowed in different formats", function () {
  return mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 },
    "ZS-C": { title: "A compact", mode: "killer", difficulty: "hard", preset: "B",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-C").path;
});

refuses("two alt editions of the same book in the SAME format are refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 },
    "ZS-C": { title: "A large print again", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-C");
}, "SAME preset");

refuses("altEditionOf with a different seed range is refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20200, puzzleCount: 201 }
  }), "ZS-B");
}, "exact seed range");

refuses("altEditionOf that changes difficulty is refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "A large print", mode: "killer", difficulty: "expert", preset: "C",
              altEditionOf: "ZS-A", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-B");
}, "different book");

refuses("altEditionOf pointing at a missing entry is refused", function () {
  mod.kdpLedgerCheck(withBooks({
    "ZS-B": { title: "orphan", mode: "killer", difficulty: "hard", preset: "C",
              altEditionOf: "ZS-NOPE", seedStart: 20000, seedEnd: 20335, puzzleCount: 336 }
  }), "ZS-B");
}, "not in books.json");

refuses("a puzzleCount that disagrees with the seed range is refused", function () {
  mod.kdpLedgerCheck({ "ZS-X": { title: "X", mode: "killer", difficulty: "hard", preset: "A",
                                 seedStart: 30000, seedEnd: 30099, puzzleCount: 336 } }, "ZS-X");
}, "holds 100 seeds");

console.log("\n=== difficulty bands ===");

refuses("bands that do not add up to the puzzle count are refused", function () {
  mod.kdpLedgerCheck({ "ZS-X": { title: "X", mode: "killer", difficulty: "easy", preset: "5.06x7.81/1up",
    seedStart: 30000, seedEnd: 30099, puzzleCount: 100,
    bands: [{ difficulty: "easy", count: 40 }, { difficulty: "hard", count: 40 }] } }, "ZS-X");
}, "have to agree");

refuses("a band at a level the mode does not have is refused", function () {
  mod.kdpLedgerCheck({ "ZS-X": { title: "X", mode: "classic", difficulty: "easy", preset: "5.06x7.81/1up",
    seedStart: 30000, seedEnd: 30099, puzzleCount: 100,
    bands: [{ difficulty: "easy", count: 50 }, { difficulty: "nightmare", count: 50 }] } }, "ZS-X");
}, "does not have");

refuses("an empty band is refused", function () {
  mod.kdpLedgerCheck({ "ZS-X": { title: "X", mode: "killer", difficulty: "easy", preset: "5.06x7.81/1up",
    seedStart: 30000, seedEnd: 30099, puzzleCount: 100,
    bands: [{ difficulty: "easy", count: 100 }, { difficulty: "hard", count: 0 }] } }, "ZS-X");
}, "no puzzles in it");

allows("a climbing book is accepted and expands in order", function () {
  const b = { title: "X", mode: "killer", difficulty: "easy", preset: "5.06x7.81/1up",
    seedStart: 30000, seedEnd: 30099, puzzleCount: 100,
    bands: [{ difficulty: "easy", count: 30 }, { difficulty: "medium", count: 40 }, { difficulty: "hard", count: 30 }] };
  mod.kdpLedgerCheck({ "ZS-X": b }, "ZS-X");
  const seq = mod.kdpBandSequence(b.bands, b.mode);
  if (seq.length !== 100) throw new Error("sequence length " + seq.length);
  if (seq[29].difficulty !== "easy" || seq[30].difficulty !== "medium" ||
      seq[69].difficulty !== "medium" || seq[70].difficulty !== "hard")
    throw new Error("bands do not change where they should");
  if (seq.some(function (q) { return q.mode !== "killer"; }))
    throw new Error("a band with no type of its own should inherit the book's");
  const r = mod.kdpBandRanges(b.bands);
  return r.map(function (x) { return x.difficulty + " " + x.from + "-" + x.to; }).join(", ");
});

allows("a book with no bands behaves as one band of its difficulty", function () {
  const seq = mod.kdpBandSequence(mod.kdpBands({ mode: "killer", difficulty: "hard", puzzleCount: 5 }), "killer");
  if (seq.map(function (q) { return q.difficulty; }).join(",") !== "hard,hard,hard,hard,hard")
    throw new Error(JSON.stringify(seq));
  return "5 puzzles, all hard";
});

console.log("\n=== target length ===");

allows("a target page count works back to a puzzle count that fits", function () {
  /* Page counts moved when the front matter grew to eight pages: three
     how-to-play pages plus the QR page. These are the counts the shipped
     front matter actually produces. */
  const cases = [["5.06x7.81/1up", 404, 336], ["8.5x11/2up", 112, 160], ["8.5x11/1up", 110, 84]];
  const out = [];
  for (const c of cases) {
    const r = mod.kdpPuzzlesForPages(c[0], c[1]);
    if (r.puzzleCount !== c[2])
      throw new Error(c[0] + " @ " + c[1] + "pp gave " + r.puzzleCount + ", expected " + c[2]);
    if (r.pages > c[1]) throw new Error(c[0] + " overshot the target");
    out.push(c[1] + "pp -> " + r.puzzleCount + " puzzles");
  }
  return out.join(", ");
});

allows("it never overshoots, across every format and a range of targets", function () {
  let n = 0;
  for (const id of Object.keys(mod.KDP_PRESETS)) {
    for (let target = 30; target <= 500; target += 7) {
      const r = mod.kdpPuzzlesForPages(id, target);
      const plan = mod.kdpPlan(id, r.puzzleCount);
      if (plan.total !== r.pages) throw new Error(id + " reported the wrong page count");
      if (!r.short && plan.total > target)
        throw new Error(id + " @ " + target + " overshot: " + plan.total);
      /* and one more puzzle really would not fit */
      if (!r.short) {
        const bigger = mod.kdpPlan(id, r.puzzleCount + 1);
        if (bigger.total <= target)
          throw new Error(id + " @ " + target + " left room for another puzzle");
      }
      n++;
    }
  }
  return n + " targets checked across " + Object.keys(mod.KDP_PRESETS).length + " formats";
});

allows("a target below KDP's minimum returns the shortest legal book", function () {
  const r = mod.kdpPuzzlesForPages("5.06x7.81/1up", 10);
  if (!r.short) throw new Error("should have been flagged short");
  if (r.pages < 24) throw new Error("returned an illegal " + r.pages + " pages");
  return r.puzzleCount + " puzzles = " + r.pages + " pages";
});

allows("splitting a total across levels always adds back up", function () {
  for (let total = 1; total <= 400; total++) {
    for (let k = 1; k <= 5; k++) {
      const ds = ["easy", "medium", "hard", "expert", "nightmare"].slice(0, k);
      const bands = mod.kdpSplitBands(total, ds);
      if (mod.kdpBandTotal(bands) !== total) throw new Error(total + "/" + k + " lost puzzles");
      const counts = bands.map(function (b) { return b.count; });
      if (Math.max.apply(null, counts) - Math.min.apply(null, counts) > 1)
        throw new Error(total + "/" + k + " split unevenly: " + counts.join(","));
    }
  }
  return "2000 splits, every one exact and even to within one puzzle";
});

console.log("\n=== repeats ===");

allows("the audit reads the whole library, not one book", function () {
  const clash = {
    "ZS-A": { title: "A", mode: "killer", difficulty: "hard", preset: "5.06x7.81/1up",
              seedStart: 20000, seedEnd: 20099, puzzleCount: 100 },
    "ZS-B": { title: "B", mode: "killer", difficulty: "easy", preset: "6x9/1up",
              seedStart: 20050, seedEnd: 20149, puzzleCount: 100 }
  };
  const problems = mod.kdpAuditLedger(clash);
  if (problems.length !== 2) throw new Error("expected both books flagged, got " + problems.length);
  if (mod.kdpAuditLedger({ "ZS-A": clash["ZS-A"] }).length !== 0) throw new Error("false positive on a clean library");
  return "both sides of a clash reported";
});

allows("identical puzzles are detected by fingerprint", function () {
  const mk = function (d) { return { sol: new Array(81).fill(d), given: new Array(81).fill(0), cages: [] }; };
  if (mod.kdpFindDuplicates([mk(1), mk(2), mk(3)]).length !== 0) throw new Error("false positive");
  const d = mod.kdpFindDuplicates([mk(1), mk(2), mk(1)]);
  if (d.length !== 1 || d[0].first !== 1 || d[0].repeat !== 3) throw new Error(JSON.stringify(d));
  return "clean decks pass, repeats are located by puzzle number";
});

allows("the same seed at a different level is a different puzzle", function () {
  const a = H.dealOne("killer", "easy", 55000);
  const b = H.dealOne("killer", "hard", 55000);
  if (mod.kdpFingerprint(a) === mod.kdpFingerprint(b))
    throw new Error("seed 55000 gave the same puzzle at easy and hard");
  return "seed 55000: easy and hard are unrelated grids";
});

allows("a real 200-puzzle deal contains no repeats", function () {
  const deck = [];
  for (let i = 0; i < 200; i++) deck.push(H.dealOne("classic", "medium", 60000 + i));
  const d = mod.kdpFindDuplicates(deck);
  if (d.length) throw new Error("puzzle " + d[0].repeat + " repeats " + d[0].first);
  return "200 consecutive seeds, all distinct";
});

console.log("\n=== cover ===");

allows("the cover spec follows KDP's formulas", function () {
  const plan = mod.kdpPlan("5.06x7.81/1up", 336);
  const c = mod.kdpCoverSpec(plan, "white");
  const spine = plan.total * 0.002252;
  const wantW = 2 * 5.06 + spine + 0.25, wantH = 7.81 + 0.25;
  if (Math.abs(c.fullIn[0] - wantW) > 1e-9) throw new Error("width " + c.fullIn[0] + " want " + wantW);
  if (Math.abs(c.fullIn[1] - wantH) > 1e-9) throw new Error("height " + c.fullIn[1] + " want " + wantH);
  if (Math.abs(c.spineIn - spine) > 1e-9) throw new Error("spine " + c.spineIn);
  if (Math.abs(c.frontFromLeftIn - (0.125 + 5.06 + spine)) > 1e-9) throw new Error("front panel misplaced");
  return c.fullIn[0].toFixed(3) + " x " + c.fullIn[1].toFixed(3) + " in, spine " + c.spineIn.toFixed(4) + " in";
});

allows("cream paper gives a thicker spine and a wider cover", function () {
  const plan = mod.kdpPlan("5.06x7.81/1up", 336);
  const w = mod.kdpCoverSpec(plan, "white"), c = mod.kdpCoverSpec(plan, "cream");
  if (!(c.spineIn > w.spineIn)) throw new Error("cream is not thicker");
  if (Math.abs((c.fullIn[0] - w.fullIn[0]) - (c.spineIn - w.spineIn)) > 1e-9)
    throw new Error("the extra spine did not reach the cover width");
  return "white " + w.spineIn.toFixed(4) + " in vs cream " + c.spineIn.toFixed(4) + " in";
});

allows("a short book is told it cannot have spine text", function () {
  const thin = mod.kdpCoverSpec(mod.kdpPlan("8.5x11/1up", 20), "white");
  const thick = mod.kdpCoverSpec(mod.kdpPlan("5.06x7.81/1up", 336), "white");
  if (thin.spineTextAllowed) throw new Error("a " + thin.pages + "-page book should not allow spine text");
  if (!thick.spineTextAllowed) throw new Error("a " + thick.pages + "-page book should");
  return thin.pages + "pp no, " + thick.pages + "pp yes";
});

console.log("\n=== trim sizes ===");

allows("every trim x layout combination plans and prices", function () {
  const lines = [];
  for (const id of Object.keys(mod.KDP_PRESETS)) {
    const P = mod.KDP_PRESETS[id];
    const plan = mod.kdpPlan(id, P.defaultPuzzles);
    const pr = mod.kdpPricing(plan);
    if (!(pr.currencies.GBP.print > 0)) throw new Error(id + " has no print cost");
    if (plan.total % 2 !== 0) throw new Error(id + " gives an odd page count");
    lines.push(id + " " + plan.total + "pp");
  }
  return lines.join(", ");
});

allows("the old A/B/C preset names still resolve", function () {
  return ["A", "B", "C"].map(function (a) { return a + "->" + mod.kdpResolvePreset(a); }).join(" ");
});

console.log("\n=== pagination and geometry ===");

refuses("a page count outside every gutter tier is refused", function () {
  mod.kdpPlan("A", 1000);
}, "gutter tier");

refuses("a book under KDP's 24-page minimum is refused", function () {
  mod.kdpPlan("A", 2);
}, "under 24 pages");

allows("the divider is forced onto a recto by inserting a filler", function () {
  /* Find a puzzle count whose puzzle section would end on an odd page, so the
     divider would otherwise land on a verso. */
  for (let n = 1; n < 120; n++) {
    let p;
    try { p = mod.kdpPlan("A", n); } catch (e) { continue; }   /* too short for KDP */
    if (p.recotFiller) {
      if (p.dividerPage % 2 !== 1) throw new Error("filler inserted but divider still on a verso");
      return n + " puzzles needs a filler; divider lands on page " + p.dividerPage;
    }
  }
  throw new Error("no puzzle count in 1..119 exercised the filler path");
});

allows("every viable puzzle count gives an even total with a recto divider", function () {
  let checked = 0, tooShort = 0;
  for (const id of ["5.06x7.81/1up", "8.5x11/2up", "8.5x11/1up"]) {
    for (let n = 1; n <= 400; n++) {
      let p;
      try {
        p = mod.kdpPlan(id, n);
      } catch (e) {
        if (e.message.indexOf("under 24 pages") < 0) throw e;
        tooShort++; continue;
      }
      checked++;
      if (p.total % 2 !== 0) throw new Error(id + " @ " + n + " gives odd total " + p.total);
      if (p.dividerPage % 2 !== 1) throw new Error(id + " @ " + n + " puts the divider on a verso");
      if (p.pages.length !== p.total) throw new Error(id + " @ " + n + " page list length mismatch");
      if (p.pages[p.dividerPage - 1].kind !== "divider") throw new Error(id + " @ " + n + " divider index wrong");
      if (p.pages[p.dividerPage].kind !== "blank") throw new Error(id + " @ " + n + " divider verso not blank");
      if (p.pages[p.total - 2].kind !== "series") throw new Error(id + " @ " + n + " series page not at last-1");
      if (p.pages[p.total - 1].kind !== "backpage") throw new Error(id + " @ " + n + " last page is not the back page");
      const sol = [].concat.apply([], p.pages.filter(function (q) { return q.kind === "solutions"; })
        .map(function (q) { return q.items; }));
      if (sol.length !== n) throw new Error(id + " @ " + n + " has " + sol.length + " solution slots");
      for (let i = 0; i < n; i++) if (sol[i] !== i) throw new Error(id + " @ " + n + " solutions out of order");
      const puz = [].concat.apply([], p.pages.filter(function (q) { return q.kind === "puzzles"; })
        .map(function (q) { return q.items; }));
      if (puz.length !== n) throw new Error(id + " @ " + n + " has " + puz.length + " puzzle slots");
    }
  }
  return checked + " plans checked across three formats (" + tooShort + " rejected as under 24 pages)";
});

allows("the mirrored live area really does swap sides", function () {
  const p = mod.kdpPlan("A", 336);
  const recto = mod.kdpLiveArea(p.preset, 7, p.gutterIn);
  const verso = mod.kdpLiveArea(p.preset, 8, p.gutterIn);
  const trimW = mod.kdpTrimPt(p.preset)[0];
  if (recto.x <= verso.x) throw new Error("recto is not inset further from the left");
  if (Math.abs((trimW - (verso.x + verso.w)) - (recto.x - 0)) > 1e-9)
    throw new Error("the two pages are not mirror images");
  if (Math.abs(recto.w - verso.w) > 1e-9) throw new Error("live widths differ");
  return "recto x=" + recto.x.toFixed(2) + ", verso x=" + verso.x.toFixed(2) + ", both " + recto.w.toFixed(2) + "pt wide";
});

console.log("\n=== legibility floor ===");

refuses("an impossible preset/mode combination aborts instead of shipping", function () {
  /* A deliberately absurd preset: a postcard trim asked to carry 24 solutions
     a page. Type would land far under 5pt. */
  mod.KDP_PRESETS.TEST_TINY = {
    id: "TEST_TINY", name: "Impossible", blurb: "test fixture",
    trimIn: [4, 6], puzzlesPerPage: 1, puzzleCols: 1, puzzleRows: 1,
    solsPerPage: 24, solCols: 4, solRows: 6, defaultPuzzles: 24,
    flatFeeTarget: true, pricePoints: { GBP: [4.99], USD: [5.99] }
  };
  try {
    const plan = mod.kdpPlan("TEST_TINY", 24);
    const book = { mode: "killer", difficulty: "hard", seedStart: 90000, seedEnd: 90023, puzzleCount: 24 };
    const deck = [];
    for (let i = 0; i < 24; i++) deck.push(H.dealOne("killer", "hard", 90000 + i));
    const cfg = {
      bookId: "TEST", mode: "killer", diff: "hard", seedStart: 90000, seedEnd: 90023,
      puzzleCount: 24, front: mod.kdpDefaultFront("killer", "hard", { title: "T" }),
      runningHead: "T", seriesList: [], trace: false,
      puzzles: deck.map(function (P, i) {
        return { P: P, n: i + 1, label: "Puzzle " + (i + 1), solLabel: String(i + 1), diffLabel: "Hard" };
      })
    };
    cfg.front.howto = cfg.front.howto.map(function (pg) {
      return pg.map(function (b) {
        const c = Object.assign({}, b);
        if (c.s) c.s = String(c.s).split("{{SOLUTIONS_PAGE}}").join("1");
        return c;
      });
    });
    const asm = mod.kdpAssembler(require("jspdf").jsPDF, H.FONTS, plan, cfg, null);
    asm.step(asm.total);
  } finally {
    delete mod.KDP_PRESETS.TEST_TINY;
  }
}, "EXPORT ABORTED");

allows("every offered size and layout clears the 5pt floor", function () {
  const L = mod.KDP_LAYOUT, IN = mod.KDP_IN;
  const lines = [];
  for (const id of Object.keys(mod.KDP_PRESETS)) {
    const P = mod.KDP_PRESETS[id];
    const plan = mod.kdpPlan(id, P.defaultPuzzles);
    const box = mod.kdpLiveArea(P, 7, plan.gutterIn);
    const contentTop = box.y + L.runHeadPt + 6, contentBot = box.y + box.h - L.footBlockPt;
    const slotH = (contentBot - contentTop) / P.puzzleRows;
    const fit = mod.kdpFitGrid(box.w, slotH - (L.titlePt + 8), L.noteStripIn * IN,
      { given: true, cages: true });
    if (!fit.ok) throw new Error(id + " fails the floor at " + fit.smallest.toFixed(2) + "pt");
    const sw = (box.w - L.solColGapPt * (P.solCols - 1)) / P.solCols;
    const sh = ((contentBot - box.y) - L.solRowGapPt * (P.solRows - 1)) / P.solRows;
    const sfit = mod.kdpFitGrid(sw, sh - (L.solLabelPt + 5), 0, { given: true, sol: true });
    if (!sfit.ok) throw new Error(id + " solutions fail the floor at " + sfit.smallest.toFixed(2) + "pt");
    lines.push("\n      " + id.padEnd(15) + " cage sums " + (fit.cell * L.cageRatio).toFixed(2) +
      "pt · givens " + (fit.cell * L.givenRatio).toFixed(1) +
      "pt · solutions " + (sfit.cell * L.solRatio).toFixed(2) + "pt");
  }
  return lines.join("");
});

console.log("\n=== embedded font coverage ===");

refuses("a character the embedded subset lacks aborts the export", function () {
  const plan = mod.kdpPlan("B", 40);
  const cfg = {
    bookId: "TEST", mode: "classic", diff: "medium", seedStart: 1, seedEnd: 40, puzzleCount: 40,
    front: mod.kdpDefaultFront("classic", "medium", { title: "Bullet • test" }),
    runningHead: "T", seriesList: [], trace: false, puzzles: []
  };
  mod.kdpAssembler(require("jspdf").jsPDF, H.FONTS, plan, cfg, null);
}, "cannot render");

allows("the half title is three lines: company, book, volume", function () {
  const f = mod.kdpDefaultFront("killer", "easy", {});
  if (f.imprint !== "Zaney Sudoku") throw new Error("imprint is " + f.imprint);
  if (f.bookName !== "Killer Sudoku") throw new Error("bookName is " + f.bookName);
  if (f.volume !== "Vol 1") throw new Error("volume defaults to " + JSON.stringify(f.volume));
  /* The imprint is the publisher, so it belongs on the page but not in the
     title the copyright page and the PDF metadata carry. */
  if (f.title !== "Killer Sudoku Vol 1") throw new Error("title is " + f.title);
  if (f.title.indexOf(f.imprint) >= 0) throw new Error("the imprint leaked into the title");
  const named = mod.kdpDefaultFront("classic", "medium",
    { bookName: "Coffee Break Sudoku", volume: "Vol 4" });
  if (named.title !== "Coffee Break Sudoku Vol 4") throw new Error("override: " + named.title);
  /* A volume can still be cleared deliberately; only "undefined" means default. */
  if (mod.kdpDefaultFront("x", "easy", { volume: "" }).volume !== "") throw new Error("volume not clearable");
  return [f.imprint, f.bookName, f.volume].join(" / ");
});

allows("nothing printed in a book mentions seeds or generating puzzles", function () {
  /* The books are sold as puzzles that were made and checked, not output. This
     walks every string that can reach the page — front matter, how-to copy,
     the difficulty notes, the QR pages, the series list — and refuses the
     production vocabulary outright, so it cannot creep back in via new copy. */
  const BANNED = /\b(seeds?|generat\w*|engine|dealt|deals|deal|dealing|algorithm\w*)\b/i;
  const plan = mod.kdpPlan("5.06x7.81/1up", 336);
  const found = [];
  for (const m of [["killer", "easy"], ["classic", "medium"], ["classic", "cowards"],
                   ["x", "expert"], ["hyper", "easy"]]) {
    const front = mod.kdpDefaultFront(m[0], m[1], { puzzleCount: 336 });
    const cfg = {
      bookId: "ZS-999", mode: m[0], diff: m[1], seedStart: 1, seedEnd: 336,
      front: front, runningHead: "X", seriesList: ["Another Volume · 160 puzzles"],
      puzzles: [{ label: "Puzzle 1", solLabel: "1", diffLabel: "Easy" }]
    };
    for (const t of mod.kdpCollectText(cfg)) {
      const hit = BANNED.exec(String(t));
      if (hit) found.push(m.join("/") + ": \"" + hit[0] + "\" in \u201c" + String(t).slice(0, 60) + "\u2026\u201d");
    }
    /* And the two lines the copyright page builds for itself. */
    if (front.copyright.join(" ").match(BANNED)) found.push(m.join("/") + ": copyright page");
  }
  if (found.length) throw new Error(found.slice(0, 4).join("  |  "));
  if (plan.pages.some(function (p) { return p.kind === "howto" && p.part > 2; }))
    throw new Error("the removed how-to page is still in the plan");
  return "5 mode/difficulty combinations, every printed string clean";
});

allows("the contents is built from the book, not typed in", function () {
  const plan = mod.kdpPlan("5.06x7.81/1up", 336);
  if (!plan.pages.some(function (p) { return p.kind === "contents"; }))
    throw new Error("no contents page in the front matter");
  const bands = [["Easy", 112], ["Medium", 112], ["Hard", 112]];
  const cfg = { bands: bands.map(function (b) { return { difficulty: b[0].toLowerCase(), count: b[1] }; }) };
  const rows = mod.kdpContents(plan, cfg);
  if (rows.length !== 4) throw new Error(rows.length + " rows, expected 3 bands + solutions");
  /* Every row has to point at the page the book actually puts it on. */
  const per = plan.preset.puzzlesPerPage;
  let seen = 0;
  for (let i = 0; i < bands.length; i++) {
    const want = plan.puzzleStart + Math.floor(seen / per);
    if (rows[i].page !== want)
      throw new Error(rows[i].label + " points at " + rows[i].page + ", the book starts it on " + want);
    if (rows[i].label.indexOf(bands[i][0] + " — puzzles " + (seen + 1) + "–" + (seen + bands[i][1])) !== 0)
      throw new Error("wrong range: " + rows[i].label);
    seen += bands[i][1];
  }
  if (rows[3].label !== "Solutions" || rows[3].page !== plan.solutionStart)
    throw new Error("solutions row is " + JSON.stringify(rows[3]));
  /* Every listed page must be one that actually carries a printed number. */
  for (const r of rows)
    if (!plan.pages[r.page - 1].folio)
      throw new Error("contents points at page " + r.page + ", which carries no folio");
  /* A single-level book collapses to one row plus solutions. */
  const one = mod.kdpContents(plan, { diff: "hard", bands: [{ difficulty: "hard", count: 336 }] });
  if (one.length !== 2) throw new Error("single-level book gave " + one.length + " rows");
  /* And a proof, which deals only the puzzles its page limit needs, must still
     print the contents of the finished book. */
  const proof = mod.kdpContents(plan, Object.assign({ puzzles: [{ diffLabel: "Easy" }] }, cfg));
  if (JSON.stringify(proof) !== JSON.stringify(rows))
    throw new Error("a proof export prints a different contents to the book");
  return rows.map(function (r) { return r.label.replace(/ — .*/, "") + " " + r.page; }).join(" · ");
});

allows("only killer books carry the cage-combinations sheet, and it follows the solutions", function () {
  const killer = mod.kdpPlan("5.06x7.81/1up", 336, { modes: ["killer"] });
  const classic = mod.kdpPlan("5.06x7.81/1up", 336, { modes: ["classic"] });
  const kinds = killer.pages.map(function (p) { return p.kind; });
  const combos = kinds.filter(function (k) { return k === "combos"; }).length;
  if (!combos) throw new Error("a killer book has no combinations sheet");
  if (classic.pages.some(function (p) { return p.kind === "combos"; }))
    throw new Error("a classic book carries a killer cheat sheet");
  if (classic.total >= killer.total)
    throw new Error("the sheet should cost pages: killer " + killer.total + " vs classic " + classic.total);

  /* After the solutions, before the series page — a reference, not an appendix
     nobody finds. */
  const lastSol = kinds.lastIndexOf("solutions");
  const firstCombo = kinds.indexOf("combos");
  const series = kinds.indexOf("series");
  if (!(lastSol < firstCombo && firstCombo < series))
    throw new Error("order is solutions@" + lastSol + " combos@" + firstCombo + " series@" + series);
  if (killer.comboStart !== firstCombo + 1 || killer.comboPages !== combos)
    throw new Error("the plan reports combos at " + killer.comboStart + " x" + killer.comboPages);
  /* Numbered, so the contents can send a reader to it. */
  for (let i = firstCombo; i < firstCombo + combos; i++)
    if (!killer.pages[i].folio) throw new Error("combinations page " + (i + 1) + " carries no folio");
  const rows = mod.kdpContents(killer, { mode: "killer", bands: [{ mode: "killer", difficulty: "easy", count: 336 }] });
  const row = rows.filter(function (r) { return r.label === "Cage combinations"; })[0];
  if (!row || row.page !== killer.comboStart)
    throw new Error("the contents does not point at the sheet");

  /* A variety book with killer in it gets the sheet too. */
  const mixed = mod.kdpPlan("8.5x11/2up", 120, { modes: ["classic", "killer"] });
  if (!mixed.comboPages) throw new Error("a variety book with killer in it has no sheet");
  return combos + " pages at 5.06x7.81, " + killer.total + "pp vs " + classic.total + "pp without it";
});

allows("the combination tables are complete and in the site's order", function () {
  /* Independently derived here: every set of distinct digits that sums to the
     total, smallest-first. If the exporter and this ever disagree, one of them
     is wrong and the printed cheat sheet is the one people would trust. */
  const want = function (n) {
    const out = {}, cur = [];
    (function walk(start, left, sum) {
      if (!left) { (out[sum] = out[sum] || []).push(cur.join("+")); return; }
      for (let d = start; d <= 9; d++) { cur.push(d); walk(d + 1, left - 1, sum + d); cur.pop(); }
    })(1, n, 0);
    return out;
  };
  let totals = 0, combos = 0;
  for (const n of mod.KDP_COMBO_SIZES) {
    const w = want(n), got = mod.kdpComboTable(n);
    const sums = Object.keys(w).map(Number).sort(function (a, b) { return a - b; });
    if (got.length !== sums.length) throw new Error(n + "-cell: " + got.length + " totals, expected " + sums.length);
    for (let i = 0; i < sums.length; i++) {
      if (got[i].sum !== sums[i]) throw new Error(n + "-cell: total " + got[i].sum + " where " + sums[i] + " expected");
      if (got[i].ways !== w[sums[i]].length || got[i].list.join(" ") !== w[sums[i]].join(" "))
        throw new Error(n + "-cell total " + sums[i] + ": " + got[i].list.join(" "));
      totals++; combos += got[i].ways;
    }
  }
  /* The forced ones are the whole point of the sheet. */
  const forced = mod.kdpComboForced();
  if (forced.length !== 16) throw new Error(forced.length + " forced combinations, expected 16");
  const two = forced.filter(function (f) { return f.cells === 2; }).map(function (f) { return f.sum + "=" + f.only; });
  if (two.join(" ") !== "3=1+2 4=1+3 16=7+9 17=8+9") throw new Error(two.join(" "));
  return totals + " totals, " + combos + " combinations, " + forced.length + " of them forced";
});

allows("the sheet cannot be paginated without real font metrics", function () {
  /* Guessing the widths would make the plan and the printed page disagree, so
     the exporter refuses rather than approximating. */
  mod.kdpSetMeasure(null);
  let threw = null;
  try { mod.kdpPlan("5.06x7.81/1up", 336, { modes: ["killer"] }); }
  catch (e) { threw = e.message; }
  mod.kdpInstallMeasure(require("jspdf").jsPDF, H.FONTS);
  if (!threw || threw.indexOf("measurer") < 0)
    throw new Error("planned anyway: " + threw);
  return threw.split("—")[1].trim().slice(0, 60) + "…";
});

allows("a book carries the rules for every kind of sudoku in it", function () {
  /* The reason this matters: a reader who opens a variety book at the killer
     section and finds only the classic rules cannot play it. */
  const bands = [{mode: "classic", difficulty: "medium", count: 30},
                 {mode: "killer",  difficulty: "easy",   count: 30},
                 {mode: "x",       difficulty: "medium", count: 30},
                 {mode: "hyper",   difficulty: "medium", count: 30}];
  const modes = mod.kdpBookModes(bands, "classic");
  if (modes.join(",") !== "classic,killer,x,hyper")
    throw new Error("kinds came out as " + modes.join(","));

  const plan = mod.kdpPlan("8.5x11/2up", 120, { modes: modes });
  const reserved = plan.pages.filter(function (p) { return p.kind === "howto"; }).length;
  if (reserved !== modes.length * 2)
    throw new Error(reserved + " rules pages reserved for " + modes.length + " kinds");

  const front = mod.kdpDefaultFront("classic", "medium", { bands: bands, modes: modes });
  if (front.howto.length !== reserved)
    throw new Error("front matter has " + front.howto.length + " rules pages, the plan reserved " + reserved);

  /* Each kind's rules must actually be present, and in the order the puzzles
     appear, so the sections line up with the book. */
  const heads = front.howto.map(function (pg) {
    const h = pg.filter(function (b) { return b.t === "h1"; })[0];
    return h ? h.s : null;
  }).filter(Boolean);
  const want = ["How to play classic sudoku", "How to play killer sudoku",
                "How to play Sudoku X", "How to play Hyper Sudoku"];
  if (heads.join(" | ") !== want.join(" | "))
    throw new Error("rules sections are: " + heads.join(" | "));

  /* And a single-kind book is untouched by any of this. */
  const one = mod.kdpDefaultFront("killer", "hard", {});
  if (one.howto.length !== 2) throw new Error("a one-kind book got " + one.howto.length + " rules pages");
  const onePlan = mod.kdpPlan("8.5x11/2up", 120);
  if (onePlan.pages.filter(function (p) { return p.kind === "howto"; }).length !== 2)
    throw new Error("a plan with no kinds named should reserve two rules pages");
  if (!(plan.total > onePlan.total))
    throw new Error("four kinds of rules should make a longer book than one");

  /* The target-length maths has to know about the extra rules pages too, or a
     variety book quietly overshoots the page count it was fitted to. */
  const fit = mod.kdpPuzzlesForPages("8.5x11/2up", 110, { modes: modes });
  const fitted = mod.kdpPlan("8.5x11/2up", fit.puzzleCount, { modes: modes });
  if (fitted.total > 110) throw new Error("fitted to 110pp but plans " + fitted.total);
  if (fit.puzzleCount >= mod.kdpPuzzlesForPages("8.5x11/2up", 110).puzzleCount)
    throw new Error("four rules sections should cost puzzles, not be free");

  return modes.length + " kinds, " + reserved + " rules pages, " + plan.total +
         "pp vs " + onePlan.total + "pp for one kind";
});

allows("a variety book labels every puzzle with its kind", function () {
  const bands = [{mode: "classic", difficulty: "medium", count: 20},
                 {mode: "killer",  difficulty: "easy",   count: 20}];
  const seq = mod.kdpBandSequence(bands, "classic");
  if (seq.length !== 40 || seq[0].mode !== "classic" || seq[19].mode !== "classic" ||
      seq[20].mode !== "killer" || seq[39].mode !== "killer")
    throw new Error(JSON.stringify(seq.slice(0, 3)));
  const plan = mod.kdpPlan("8.5x11/2up", 40, { modes: ["classic", "killer"] });
  const rows = mod.kdpContents(plan, { mode: "classic", bands: bands });
  if (rows[0].label.indexOf("Classic Sudoku") !== 0 || rows[1].label.indexOf("Killer Sudoku") !== 0)
    throw new Error("contents rows: " + rows.map(function (r) { return r.label; }).join(" | "));
  /* A single-kind book must NOT gain the kind prefix — it would be noise. */
  const plain = mod.kdpContents(mod.kdpPlan("8.5x11/2up", 40),
    { mode: "killer", bands: [{ mode: "killer", difficulty: "easy", count: 40 }] });
  if (plain[0].label.indexOf("Easy — puzzles") !== 0)
    throw new Error("one-kind contents row: " + plain[0].label);
  return rows.map(function (r) { return r.label; }).join(" | ");
});

allows("every mode has as many how-to-play pages as the plan reserves", function () {
  const plan = mod.kdpPlan("5.06x7.81/1up", 336);
  const reserved = plan.pages.filter(function (p) { return p.kind === "howto"; }).length;
  const out = [];
  for (const m of ["killer", "classic", "x", "hyper"]) {
    const f = mod.kdpDefaultFront(m, m === "classic" ? "medium" : "easy", {});
    if (f.howto.length !== reserved)
      throw new Error(m + " has " + f.howto.length + " how-to page(s), the plan reserves " + reserved);
    out.push(m + ":" + f.howto.length);
  }
  /* And the QR pages the plan promises are actually in it. */
  if (!plan.pages.some(function (p) { return p.kind === "playmore"; }))
    throw new Error("no QR page in the front matter");
  if (plan.pages[plan.total - 1].kind !== "backpage")
    throw new Error("the last leaf is not the back page");
  return out.join(" ") + ", plus the QR page front and back";
});

allows("the shipped front-matter defaults are fully covered by the subset", function () {
  const modes = [["killer", "hard"], ["classic", "medium"], ["classic", "cowards"],
                 ["x", "expert"], ["hyper", "easy"]];
  const problems = [];
  for (const m of modes) {
    const cfg = {
      front: mod.kdpDefaultFront(m[0], m[1], { title: "Test Title", puzzleCount: 100 }),
      runningHead: "X", seriesList: ["Another Volume - large print edition - 160 puzzles"],
      puzzles: [{ label: "Puzzle 1", solLabel: "1", diffLabel: "Hard" },
                { label: "Puzzle 336", solLabel: "336", diffLabel: "Hard" }]
    };
    const miss = mod.kdpUnsupportedChars(cfg, H.FONTS.charset);
    if (miss.length) problems.push(m.join("/") + ": " + miss.map(function (x) { return x.code; }).join(","));
  }
  if (problems.length) throw new Error(problems.join("; "));
  return modes.length + " mode/difficulty combinations, all glyphs present";
});

console.log("\n" + (pass + fail) + " checks, " + fail + " failed");
process.exit(fail ? 1 : 0);
