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
  const seq = mod.kdpBandSequence(b.bands);
  if (seq.length !== 100) throw new Error("sequence length " + seq.length);
  if (seq[29] !== "easy" || seq[30] !== "medium" || seq[69] !== "medium" || seq[70] !== "hard")
    throw new Error("bands do not change where they should");
  const r = mod.kdpBandRanges(b.bands);
  return r.map(function (x) { return x.difficulty + " " + x.from + "-" + x.to; }).join(", ");
});

allows("a book with no bands behaves as one band of its difficulty", function () {
  const seq = mod.kdpBandSequence(mod.kdpBands({ difficulty: "hard", puzzleCount: 5 }));
  if (seq.join(",") !== "hard,hard,hard,hard,hard") throw new Error(seq.join(","));
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
