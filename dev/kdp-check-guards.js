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
  for (const id of ["A", "B", "C"]) {
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
      if (p.pages[p.total - 1].kind !== "blank") throw new Error(id + " @ " + n + " last page not blank");
      const sol = [].concat.apply([], p.pages.filter(function (q) { return q.kind === "solutions"; })
        .map(function (q) { return q.items; }));
      if (sol.length !== n) throw new Error(id + " @ " + n + " has " + sol.length + " solution slots");
      for (let i = 0; i < n; i++) if (sol[i] !== i) throw new Error(id + " @ " + n + " solutions out of order");
      const puz = [].concat.apply([], p.pages.filter(function (q) { return q.kind === "puzzles"; })
        .map(function (q) { return q.items; }));
      if (puz.length !== n) throw new Error(id + " @ " + n + " has " + puz.length + " puzzle slots");
    }
  }
  return checked + " plans checked across presets A, B and C (" + tooShort + " rejected as under 24 pages)";
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

allows("the three real presets all clear the 5pt floor", function () {
  const L = mod.KDP_LAYOUT, IN = mod.KDP_IN, M = mod.KDP_MARGIN_IN * IN;
  const lines = [];
  for (const id of ["A", "B", "C"]) {
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
    lines.push(id + ": killer cage sums " + (fit.cell * L.cageRatio).toFixed(2) +
      "pt, givens " + (fit.cell * L.givenRatio).toFixed(1) +
      "pt, solution digits " + (sfit.cell * L.solRatio).toFixed(2) + "pt");
  }
  return lines.join(" | ");
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
