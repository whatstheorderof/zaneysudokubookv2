/* Node-side generator for the KDP interior validation suite.
 *
 * This holds no copy of the exporter. It loads engine.js and
 * core.js — the same two files index.html loads — into one scope, so the
 * browser and the tests run identical bytes. It also verifies the vendored
 * engine against its lock file first: a hand-edited engine would silently
 * change every puzzle in every book already printed.
 *
 *   node dev/kdp-harness.js <bookId> <outDir> [proofPages]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { jsPDF } = require("jspdf");

const ROOT = path.dirname(__dirname);

const enginePath = path.join(ROOT, "engine.js");
const engine = fs.readFileSync(enginePath, "utf8");
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.lock.json"), "utf8"));
const engineSha = crypto.createHash("sha256").update(engine, "utf8").digest("hex");
if (engineSha !== lock.sha256File) {
  throw new Error(
    "ENGINE INTEGRITY FAILURE. engine.js does not match engine.lock.json.\n" +
    "  expected " + lock.sha256File + "\n  found    " + engineSha + "\n" +
    "That file is vendored from the site and must not be hand-edited. Restore it with " +
    "dev/sync-engine.py.");
}
const core = fs.readFileSync(path.join(ROOT, "core.js"), "utf8");

const EXPORTS = [
  "DIFFS","DIFF_CFG","DIFF_LABEL","CLASSIC_DIFFS","CLASSIC_CLUES","X_DIFFS","X_CLUES","H_DIFFS","H_CLUES","PAR",
  "hyperWin","dealPuzzle","dealClassic","dealX","dealHyper","countSolutions","countClassic",
  "KDP_PRESETS","KDP_RATES","KDP_LAYOUT","KDP_MODE_NAME","KDP_MARGIN_IN","KDP_IN",
  "kdpPlan","kdpPricing","kdpWarnings","kdpLiveArea","kdpTrimPt","kdpTrimCategory","kdpGutterIn",
  "kdpAssembler","kdpDefaultFront","kdpLedgerCheck","kdpSeriesList","kdpFixup","kdpFitGrid",
  "kdpUnsupportedChars","kdpCollectText","kdpBands","kdpBandSequence","kdpBandRanges","kdpBandTotal",
  "kdpResolvePreset","KDP_TRIMS","KDP_LAYOUTS","kdpValidDifficulties"
];

const mod = new Function(
  "jsPDF",
  engine + "\n" + core + "\nreturn {" + EXPORTS.join(",") + "};"
)(jsPDF);

/* fonts/kdp-fonts.js assigns to window */
const fontSrc = fs.readFileSync(path.join(ROOT, "fonts.js"), "utf8");
const win = {};
new Function("window", fontSrc)(win);
const FONTS = win.KDP_FONTS;
if (!FONTS || !FONTS.regular) throw new Error("fonts.js did not produce KDP_FONTS");

const books = JSON.parse(fs.readFileSync(path.join(ROOT, "books.json"), "utf8"));

function dealOne(mode, diff, seed) {
  if (mode === "killer") return Object.assign(mod.dealPuzzle(seed, diff), { kind: "killer" });
  if (mode === "classic") return mod.dealClassic(seed, diff);
  if (mode === "x") return mod.dealX(seed, diff);
  if (mode === "hyper") return mod.dealHyper(seed, diff);
  throw new Error("unknown mode " + mode);
}

function build(bookId, opts) {
  opts = opts || {};
  const book = books[bookId];
  if (!book) throw new Error("no such book " + bookId);
  const ledger = mod.kdpLedgerCheck(books, bookId);
  const plan = mod.kdpPlan(book.preset, book.puzzleCount);

  const seq = mod.kdpBandSequence(mod.kdpBands(book));   /* difficulty per puzzle */
  const t0 = Date.now();
  let deck = opts.deck || null;
  /* Test-harness convenience only: 336 killer grids take minutes to deal, and
     the suite wants the same deck several times over. The cache is keyed by the
     exact seed range; the determinism check re-deals a sample from scratch so a
     stale cache cannot hide a change in the generator. */
  if (!deck && opts.deckFile && fs.existsSync(opts.deckFile)) {
    const raw = JSON.parse(fs.readFileSync(opts.deckFile, "utf8"));
    if (raw.mode === book.mode && raw.difficulty === book.difficulty &&
        raw.seedStart === book.seedStart && raw.deck.length === book.puzzleCount &&
        raw.bandKey === seq.join(",")) {
      deck = raw.deck.map(function (d) {
        return { num: d.num, diff: d.diff, kind: d.kind,
                 sol: Uint8Array.from(d.sol), cages: d.cages,
                 cageOf: Int16Array.from(d.cageOf), given: Uint8Array.from(d.given) };
      });
    }
  }
  if (!deck) {
    deck = [];
    for (let i = 0; i < book.puzzleCount; i++) {
      deck.push(dealOne(book.mode, seq[i], book.seedStart + i));
      if (opts.onProgress && (i % 25 === 0 || i === book.puzzleCount - 1))
        opts.onProgress(i + 1, book.puzzleCount);
    }
    if (opts.deckFile) {
      fs.writeFileSync(opts.deckFile, JSON.stringify({
        mode: book.mode, difficulty: book.difficulty, seedStart: book.seedStart,
        bandKey: seq.join(","),
        deck: deck.map(function (d) {
          return { num: d.num, diff: d.diff, kind: d.kind, sol: Array.from(d.sol),
                   cages: d.cages, cageOf: Array.from(d.cageOf), given: Array.from(d.given) };
        })
      }));
    }
  }
  const dealMs = Date.now() - t0;

  const modeName = mod.KDP_MODE_NAME[book.mode] || book.mode;
  const puzzles = deck.map(function (P, i) {
    const d = seq[i], label = mod.DIFF_LABEL[d] || d;
    return { P: P, n: i + 1, label: "Puzzle " + (i + 1), solLabel: String(i + 1),
             diffLabel: label, runHead: modeName + " · " + label };
  });

  const front = mod.kdpDefaultFront(book.mode, book.difficulty, {
    title: book.title, puzzleCount: book.puzzleCount, year: 2026,
    bands: mod.kdpBands(book)
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
    bookId: bookId, mode: book.mode, diff: book.difficulty,
    seedStart: book.seedStart, seedEnd: book.seedEnd, puzzleCount: book.puzzleCount,
    puzzles: puzzles, front: front,
    runningHead: modeName + " · " + (mod.DIFF_LABEL[book.difficulty] || book.difficulty),
    seriesList: mod.kdpSeriesList(books, bookId),
    trace: true
  };

  const asm = mod.kdpAssembler(jsPDF, FONTS, plan, cfg, opts.pageLimit || null);
  asm.step(asm.total);
  const out = asm.finish();

  return { book: book, ledger: ledger, plan: plan, cfg: cfg, deck: deck,
           bytes: out.bytes, report: out.report, marks: asm.ctx.marks, dealMs: dealMs, mod: mod };
}

module.exports = { mod: mod, books: books, build: build, dealOne: dealOne, FONTS: FONTS,
                   ROOT: ROOT, engineSha: engineSha, engineSrc: engine };

if (require.main === module) {
  const bookId = process.argv[2];
  const outDir = process.argv[3] || path.join(ROOT, "out");
  const proof = process.argv[4] ? parseInt(process.argv[4], 10) : null;   /* proof-mode page limit */
  const stem = bookId + (proof ? "-proof" : "");
  fs.mkdirSync(outDir, { recursive: true });
  process.stdout.write("dealing " + bookId + " …\n");
  const r = build(bookId, {
    pageLimit: proof,
    deckFile: path.join(outDir, bookId + ".deck.json"),
    onProgress: function (i, n) { process.stdout.write("\r  " + i + "/" + n + "   "); }
  });
  process.stdout.write("\n  dealt in " + (r.dealMs / 1000).toFixed(1) + "s\n");
  const pdf = path.join(outDir, stem + ".pdf");
  fs.writeFileSync(pdf, Buffer.from(r.bytes));
  fs.writeFileSync(path.join(outDir, stem + ".marks.json"), JSON.stringify({
    proof: proof || null,
    plan: {
      total: proof ? Math.min(proof, r.plan.total) : r.plan.total,
      fullTotal: r.plan.total, presetId: r.plan.presetId, gutterIn: r.plan.gutterIn,
      dividerPage: r.plan.dividerPage, solutionStart: r.plan.solutionStart,
      puzzlePages: r.plan.puzzlePages, solutionPages: r.plan.solutionPages,
      trimPt: r.mod.kdpTrimPt(r.plan.preset), category: r.plan.category,
      kinds: r.plan.pages.slice(0, proof || r.plan.pages.length).map(function (p) { return p.kind; }),
      folios: r.plan.pages.slice(0, proof || r.plan.pages.length).map(function (p) { return !!p.folio; })
    },
    marginIn: r.mod.KDP_MARGIN_IN,
    ledger: r.ledger,
    report: r.report,
    marks: r.marks
  }));
  console.log("  wrote " + pdf + " (" + (r.bytes.length / 1024 / 1024).toFixed(2) + " MB, " +
    (proof ? proof + " of " + r.plan.total : r.plan.total) + " pages)");
}
