/* ==========================================================================
   KDP print-interior exporter — pure logic.

   No DOM access anywhere in this file, deliberately. It is loaded as a plain
   script by index.html and concatenated with engine.js by the Node test
   harness, so the browser and the tests run the same bytes. There is no
   second copy of any of this.

   Everything geometric derives from KDP_PRESETS. Adding a fourth trim size is
   a new object in that table, not a code change.
   ========================================================================== */

const KDP_IN = 72;                       /* points per inch */

/* ---------------------------------------------------------------------------
   RATES — printing costs and royalty rules.

   LAST VERIFIED: 2026-08-24, against KDP's published paperback printing
   costs. AMAZON REVISES THESE. Re-check at title setup and edit here; nothing
   else in the file hardcodes a price.

   Trim category is derived, not declared: REGULAR is width <= 6.12in AND
   height <= 9in, everything else is LARGE.

   UK figures are approximate conversions. The UK LARGE per-page rate in
   particular is UNVERIFIED and is flagged as such in the UI — confirm it in
   KDP's own calculator before pricing a large-trim title for the UK store.

   Royalty: two models are reported side by side, because they disagree.
     flat60  — 60% of list minus print cost at every price. This is what I
               believe KDP actually pays for paperback on Amazon marketplaces.
     tiered  — 60% at/above the threshold, 50% below. This is the rule as
               originally specced; it is the Kindle ebook tier structure and
               probably does not apply to paperback. Kept so the readout shows
               the gap rather than silently picking one.
   Expanded Distribution (40%) is deliberately not modelled — it is off.
--------------------------------------------------------------------------- */
const KDP_RATES = {
  LAST_VERIFIED: "2026-08-24",
  print: {
    REGULAR: {
      USD: { flatMax: 110, flat: 2.30, base: 1.00, perPage: 0.012, verified: true  },
      GBP: { flatMax: 110, flat: 1.93, base: 0.85, perPage: 0.010, verified: true  }
    },
    LARGE: {
      USD: { flatMax: 110, flat: 2.84, base: 1.00, perPage: 0.017, verified: true  },
      GBP: { flatMax: 110, flat: 2.40, base: 0.85, perPage: 0.014, verified: false }
    }
  },
  royalty: {
    flat: 0.60,
    tierRate: { above: 0.60, below: 0.50 },
    tierThreshold: { USD: 9.99, GBP: 7.99 }   /* GBP "equivalent" is a guess */
  },
  /* Spine thickness per page, by stock. A black-ink interior is white or
     cream; the choice changes the spine, and therefore the whole cover. */
  spinePerPageIn: 0.002252,                   /* white — default for callers that predate the paper option */
  paper: { white: 0.002252, cream: 0.0025 },
  coverBleedEachIn: 0.125,                    /* KDP wants 0.125in of bleed on all four outer edges */
  spineTextMinPages: 79,                      /* below this KDP will not print spine text */
  barcodeIn: { w: 2.0, h: 1.2, marginIn: 0.25 },
  coverBleedIn: 0.25,
  minInteriorPages: 24,
  maxInteriorPages: 828
};

/* ---------------------------------------------------------------------------
   TRIM SIZES.

   KDP's smallest paperback trim is 5 x 8 in, so the 4 x 6 "pocket" size you see
   on other publishers' books is not available there — the nearest thing is A5.

   Category is derived, never declared: REGULAR is width <= 6.12in AND height
   <= 9in, everything else is LARGE, and that single fact drives printing cost.
--------------------------------------------------------------------------- */
const KDP_TRIMS = [
  { id: "5.06x7.81", name: "Brick",     wIn: 5.06, hIn: 7.81, note: "matches the UK Su Doku title you are benchmarking" },
  { id: "5.83x8.27", name: "A5 Travel", wIn: 5.83, hIn: 8.27, note: "commuter size" },
  { id: "6x9",       name: "Portable",  wIn: 6,    hIn: 9,    note: "the middle ground; still REGULAR trim, only just" },
  { id: "8.5x11",    name: "Standard",  wIn: 8.5,  hIn: 11,   note: "the usual puzzle-book size, and what large print wants" }
];

/* How many puzzles go on a page, and how the solutions pack at the back. */
const KDP_LAYOUTS = [
  { id: "1up", name: "1 per page",  puzzlesPerPage: 1, puzzleCols: 1, puzzleRows: 1, solsPerPage: 6, solCols: 2, solRows: 3 },
  { id: "2up", name: "2 per page",  puzzlesPerPage: 2, puzzleCols: 1, puzzleRows: 2, solsPerPage: 8, solCols: 2, solRows: 4 }
];

/* Every trim x layout combination is a preset. Adding a trim size or a layout
   adds a row to one of the tables above; nothing else changes. */
const KDP_PRESETS = (function () {
  const out = {};
  for (const t of KDP_TRIMS) {
    for (const L of KDP_LAYOUTS) {
      const id = t.id + "/" + L.id;
      out[id] = {
        id: id,
        trimId: t.id, layoutId: L.id,
        name: t.name + ", " + L.name,
        blurb: t.note,
        trimIn: [t.wIn, t.hIn],
        puzzlesPerPage: L.puzzlesPerPage, puzzleCols: L.puzzleCols, puzzleRows: L.puzzleRows,
        solsPerPage: L.solsPerPage, solCols: L.solCols, solRows: L.solRows,
        defaultPuzzles: L.puzzlesPerPage === 2 ? 160 : (t.id === "8.5x11" ? 84 : 336)
      };
    }
  }
  return out;
})();

/* The three formats this started with, so an older books.json still loads. */
const KDP_PRESET_ALIASES = { A: "5.06x7.81/1up", B: "8.5x11/2up", C: "8.5x11/1up" };
function kdpResolvePreset(id) {
  return KDP_PRESETS[id] ? id : (KDP_PRESET_ALIASES[id] || id);
}

/* Gutter widens with the block; the tier depends on the FINAL page count, so
   pagination has to be settled before any layout happens. */
const KDP_GUTTER_TIERS = [
  { min:  24, max: 150, gutterIn: 0.375 },
  { min: 151, max: 300, gutterIn: 0.5   },
  { min: 301, max: 500, gutterIn: 0.625 },
  { min: 501, max: 700, gutterIn: 0.75  }
];

/* The shape of the front and back matter. Page counts live here rather than
   being implied by the code, so a mode that needs a fourth how-to page is a
   data change — the plan pads around whatever this says. */
const KDP_FRONT = {
  contents: true,  /* the contents page, built from the plan itself     */
  howtoPagesPerMode: 2,   /* must equal KDP_HOWTO[mode].length for every mode */
  playMore: true,  /* the QR page in the front matter                   */
  backPage: true   /* the QR page as the final leaf, instead of a blank  */
};

const KDP_MARGIN_IN = 0.4;    /* top / bottom / outside. KDP minimum is 0.25 */
/* Floor under the gutter. Set to 0 to use KDP's tier values verbatim, which
   at 24–150pp would make the binding margin (0.375) NARROWER than the outer
   margin (0.4) — legal, but backwards for a bound book. */
const KDP_GUTTER_FLOOR_IN = KDP_MARGIN_IN;

const KDP_LAYOUT = {
  runHeadPt: 7, runHeadTrack: 0.7,
  titlePt: 11, folioPt: 8,
  noteStripIn: 0.3,
  headBlockPt: 34,            /* running head + puzzle title above the grid  */
  footBlockPt: 12,            /* folio band at the foot of the live area     */
  solLabelPt: 8, solColGapPt: 16, solRowGapPt: 8,
  minTypePt: 5,               /* legibility floor — hard abort below this    */
  boxLineW: 1.1, cellLineW: 0.35, cageLineW: 0.5,
  givenRatio: 0.60, solRatio: 0.56, cageRatio: 0.24,
  /* A killer cell can hold both a cage sum and a given digit. The sum owns the
     top-left corner, so in a caged grid the digits are a shade smaller and sit
     a little below centre — far enough to clear the sum's ink, and no further. */
  givenRatioCaged: 0.56, solRatioCaged: 0.54,
  /* Measured off the embedded Inter at both weights. With jsPDF's "middle"
     baseline the ink of a digit runs from 0.388em above the requested y to
     0.356em below it. Clearance is worked out from that, not from the em box:
     the em box is a third taller than the digit, and reserving all of it is
     what used to shove every given onto the floor of its cell. */
  digitInkUp: 0.388, digitInkDown: 0.356,
  digitClearIn: 0.04,   /* printed gap between a cage sum and the digit, in cells */
  tint: 236                   /* light region tint for Sudoku X / Hyper      */
};

/* ---------------------------------------------------------------------------
   Geometry
--------------------------------------------------------------------------- */
function kdpTrimPt(preset){ return [preset.trimIn[0]*KDP_IN, preset.trimIn[1]*KDP_IN]; }

function kdpTrimCategory(preset){
  const [w,h] = preset.trimIn;
  return (w <= 6.12 && h <= 9) ? "REGULAR" : "LARGE";
}

function kdpGutterIn(pageCount){
  for(const t of KDP_GUTTER_TIERS)
    if(pageCount >= t.min && pageCount <= t.max)
      return {min:t.min, max:t.max, tierIn:t.gutterIn,
              gutterIn: Math.max(t.gutterIn, KDP_GUTTER_FLOOR_IN)};
  if(pageCount < KDP_RATES.minInteriorPages)
    throw new Error("This book comes to "+pageCount+" pages. KDP will not accept an interior under "+
      KDP_RATES.minInteriorPages+" pages — add more puzzles, or use a preset with fewer per page.");
  throw new Error("No gutter tier covers "+pageCount+" pages (tiers run "+
                  KDP_GUTTER_TIERS[0].min+"–"+KDP_GUTTER_TIERS[KDP_GUTTER_TIERS.length-1].max+"). "+
                  "Reduce the puzzle count or add a tier to KDP_GUTTER_TIERS.");
}

/* THE mirroring primitive. Odd pages are rectos: the wide gutter margin is on
   the LEFT. Even pages are versos: it is on the RIGHT. Every single drawing
   call in the interior takes its box from here — nothing is ever centred on
   the physical page, only inside the live area this returns. */
function kdpLiveArea(preset, pageNo, gutterIn){
  const [W,H] = kdpTrimPt(preset);
  const m = KDP_MARGIN_IN*KDP_IN, g = gutterIn*KDP_IN;
  const recto = (pageNo % 2) === 1;
  return {
    x: recto ? g : m,
    y: m,
    w: W - m - g,
    h: H - 2*m,
    recto: recto,
    outerX: recto ? (W - m) : m,          /* outer edge, for folio + head */
    outerAlign: recto ? "right" : "left"
  };
}

/* ---------------------------------------------------------------------------
   Difficulty bands.

   A book can climb: the first stretch easy, then medium, then hard. bands is
   [{difficulty, count}, ...] summing to puzzleCount. A book with no bands is
   just one band of its single difficulty, so everything downstream can treat
   the two cases identically.

   Seeds stay a single contiguous run — puzzle i is always seed seedStart+i.
   The generator hashes difficulty into the seed, so the same seed at a
   different difficulty is a different puzzle, and a band split is therefore
   part of a book's identity as much as its range is.
--------------------------------------------------------------------------- */
/* A band is a run of consecutive puzzles at one level of one variation. Its
   type is optional and falls back to the book's, so every book written before
   variety books existed still reads correctly. */
function kdpBands(book){
  const fallback = book.mode;
  if(book.bands && book.bands.length)
    return book.bands.map(function(b){
      return {mode: b.mode || fallback, difficulty: b.difficulty, count: b.count};
    });
  return [{mode: fallback, difficulty: book.difficulty, count: book.puzzleCount}];
}

/* The distinct variations in a book, in the order they first appear. That
   order decides the order of the rules sections, so it is the reading order,
   not an alphabetical one. */
function kdpBookModes(bands, fallback){
  const out = [];
  for(const b of (bands||[])){
    const m = b.mode || fallback;
    if(m && out.indexOf(m) < 0) out.push(m);
  }
  if(!out.length && fallback) out.push(fallback);
  return out;
}

/* One set of rules per variation present, in reading order. A book with killer
   and Sudoku X in it prints both, because a reader who bought it for the
   variety needs both. */
function kdpHowtoFor(modes){
  const list = (modes && modes.length) ? modes : ["classic"];
  let out = [];
  for(const m of list) out = out.concat(KDP_HOWTO[m] || KDP_HOWTO.classic);
  return out;
}
function kdpHowtoPages(modes){
  const n = (modes && modes.length) ? modes.length : 1;
  return n * KDP_FRONT.howtoPagesPerMode;
}

function kdpBandTotal(bands){
  let n = 0;
  for(const b of bands) n += b.count;
  return n;
}

/* The difficulty of every puzzle in order, so dealing and labelling agree. */
/* One entry per puzzle: which variation to deal and at what level. */
function kdpBandSequence(bands, fallbackMode){
  const out = [];
  for(const b of bands)
    for(let i=0;i<b.count;i++)
      out.push({mode: b.mode || fallbackMode, difficulty: b.difficulty});
  return out;
}

/* 1-based puzzle number ranges, for the front matter. */
function kdpBandRanges(bands){
  const out = [];
  let n = 1;
  for(const b of bands){
    if(b.count <= 0) continue;
    out.push({mode: b.mode, difficulty: b.difficulty, from: n, to: n + b.count - 1, count: b.count});
    n += b.count;
  }
  return out;
}

function kdpValidDifficulties(mode){
  if(mode === "killer")  return DIFFS;
  if(mode === "classic") return CLASSIC_DIFFS;
  if(mode === "x")       return X_DIFFS;
  if(mode === "hyper")   return H_DIFFS;
  return [];
}

/* ---------------------------------------------------------------------------
   Pagination. Runs to completion before anything is laid out or dealt.
--------------------------------------------------------------------------- */
function kdpPlan(presetId, puzzleCount, opts){
  opts = opts || {};
  presetId = kdpResolvePreset(presetId);
  const P = KDP_PRESETS[presetId];
  if(!P) throw new Error("Unknown preset "+presetId);
  if(!(puzzleCount > 0)) throw new Error("Puzzle count must be positive");

  const pages = [];
  const push = (kind, extra) => { pages.push(Object.assign({kind, folio:false}, extra||{})); };

  push("halftitle"); push("copyright");
  if(KDP_FRONT.contents) push("contents");
  /* One rules section per variation in the book, so the page count follows the
     book rather than a constant. */
  const howtoPages = kdpHowtoPages(opts.modes);
  for(let i=1;i<=howtoPages;i++) push("howto", {part:i});
  push("about");
  if(KDP_FRONT.playMore) push("playmore");
  /* Puzzles open on a recto, so the front matter is padded to an even length
     whatever it contains. */
  while(pages.length % 2 !== 0) push("blank", {reason:"front-matter pad"});
  const puzzleStart = pages.length + 1;

  const puzPages = Math.ceil(puzzleCount / P.puzzlesPerPage);
  for(let i=0;i<puzPages;i++){
    const items = [];
    for(let k=0;k<P.puzzlesPerPage;k++){
      const idx = i*P.puzzlesPerPage + k;
      if(idx < puzzleCount) items.push(idx);
    }
    push("puzzles", {items, folio:true, slotCount:P.puzzlesPerPage});
  }

  /* The divider has to land on a recto. Its page number would be pages.length+1;
     if that is even, slip a blank in front of it. */
  let filler = 0;
  if(((pages.length + 1) % 2) === 0){ push("blank", {reason:"recto filler"}); filler = 1; }
  const dividerPage = pages.length + 1;
  push("divider");
  push("blank", {reason:"divider verso"});

  const solPages = Math.ceil(puzzleCount / P.solsPerPage);
  const solStart = pages.length + 1;
  for(let i=0;i<solPages;i++){
    const items = [];
    for(let k=0;k<P.solsPerPage;k++){
      const idx = i*P.solsPerPage + k;
      if(idx < puzzleCount) items.push(idx);
    }
    push("solutions", {items, folio:true, slotCount:P.solsPerPage});
  }

  /* The cage-combinations sheet, for books that hold killer puzzles. It goes
     after the solutions, where a reference belongs, and it is numbered so the
     contents can point at it. */
  const wantsCombos = !!(opts.modes && opts.modes.indexOf("killer") >= 0);
  const comboStart = wantsCombos ? pages.length + 1 : 0;
  let comboPages = 0;
  if(wantsCombos){
    comboPages = kdpComboPages(presetId).length;
    for(let i=1;i<=comboPages;i++) push("combos", {part:i, folio:true});
  }

  /* Back matter: series page at last-1, blank at last, total even. Padding goes
     BEFORE the series page so it keeps its position (and stays on a recto). */
  let pad = 0;
  if(pages.length % 2 === 1){ push("blank", {reason:"even-total pad"}); pad = 1; }
  push("series");
  push(KDP_FRONT.backPage ? "backpage" : "blank", {reason:"final leaf"});

  const total = pages.length;
  if(total % 2 !== 0) throw new Error("Pagination bug: odd total "+total);
  if(((dividerPage) % 2) !== 1) throw new Error("Pagination bug: divider on verso");
  if((puzzleStart % 2) !== 1) throw new Error("Pagination bug: puzzles start on a verso");

  const tier = kdpGutterIn(total);

  return {
    presetId, preset:P, puzzleCount, pages, total, howtoPages, modes: (opts.modes||null),
    comboStart: comboPages ? comboStart : 0, comboPages,
    puzzlePages: puzPages, solutionPages: solPages,
    puzzleStart, dividerPage, solutionStart: solStart,
    recotFiller: filler, evenPad: pad,
    gutterIn: tier.gutterIn, gutterTier: tier,
    category: kdpTrimCategory(P)
  };
}

/* ---------------------------------------------------------------------------
   Pricing readout
--------------------------------------------------------------------------- */
function kdpSpineIn(pages, paper){
  const per = (paper && KDP_RATES.paper[paper]) || KDP_RATES.spinePerPageIn;
  return pages * per;
}

function kdpCoverIn(preset, pages, paper){
  const [w,h] = preset.trimIn, s = kdpSpineIn(pages, paper), b = KDP_RATES.coverBleedIn;
  return { w: 2*w + s + b, h: h + b, spine: s };
}

/* ---------------------------------------------------------------------------
   Full cover spec — the same numbers KDP's cover calculator returns, worked out
   from the page count this exporter is actually going to produce:

     https://kdp.amazon.com/cover-calculator

   These follow KDP's published formulas, but their calculator is the thing KDP
   itself validates against, so check one against it at title setup.
--------------------------------------------------------------------------- */
function kdpCoverSpec(plan, paper){
  paper = (paper && KDP_RATES.paper[paper]) ? paper : "white";
  const tw = plan.preset.trimIn[0], th = plan.preset.trimIn[1];
  const bleed = KDP_RATES.coverBleedEachIn;
  const spine = kdpSpineIn(plan.total, paper);
  const W = 2*tw + spine + 2*bleed;
  const H = th + 2*bleed;
  const bc = KDP_RATES.barcodeIn;
  return {
    paper: paper,
    pages: plan.total,
    trimIn: [tw, th],
    bleedIn: bleed,
    spineIn: spine,
    spineCm: spine * 2.54,
    /* the canvas to set up in Canva */
    fullIn: [W, H],
    fullCm: [W*2.54, H*2.54],
    fullPx300: [Math.round(W*300), Math.round(H*300)],
    /* where the panels fall, measured from the left edge of that canvas */
    backFromLeftIn: bleed,
    spineFromLeftIn: bleed + tw,
    frontFromLeftIn: bleed + tw + spine,
    /* keep text this far inside every trimmed edge */
    safeMarginIn: 0.25,
    /* KDP prints the barcode over the lower right of the BACK cover */
    barcode: { wIn: bc.w, hIn: bc.h,
               fromLeftIn: bleed + tw - bc.w - bc.marginIn,
               fromBottomIn: bleed + bc.marginIn },
    spineTextAllowed: plan.total >= KDP_RATES.spineTextMinPages,
    spineTextMinPages: KDP_RATES.spineTextMinPages,
    /* KDP asks for 0.0625in of clearance either side of spine text */
    spineTextSafeIn: Math.max(0, spine - 0.125)
  };
}

function kdpPrintCost(category, pages, cur){
  const r = KDP_RATES.print[category][cur];
  const cost = (pages <= r.flatMax) ? r.flat : (r.base + r.perPage*pages);
  return { cost, flat: pages <= r.flatMax, verified: r.verified, rate: r };
}

function kdpRoyalty(list, cost, cur){
  const R = KDP_RATES.royalty;
  const tierRate = list >= R.tierThreshold[cur] ? R.tierRate.above : R.tierRate.below;
  return {
    list,
    flat60:  R.flat*list - cost,
    tiered:  tierRate*list - cost,
    tierRate
  };
}

/* Break-even at 60% rounded up to the next x.99, then two steps of one unit. */
function kdpPriceLadder(cost){
  const min = cost / KDP_RATES.royalty.flat;
  let base = Math.ceil(min) - 0.01;
  if(base < min) base += 1;
  return [base, base + 2, base + 4];
}

function kdpPricing(plan, paper){
  const P = plan.preset, pages = plan.total, cat = plan.category;
  const out = { pages, category: cat, paper: paper || "white", cover: kdpCoverIn(P, pages, paper), currencies: {} };
  out.spineIn = out.cover.spine;
  out.spineCm = out.spineIn * 2.54;
  for(const cur of ["USD","GBP"]){
    const pc = kdpPrintCost(cat, pages, cur);
    const R  = KDP_RATES.royalty;
    out.currencies[cur] = {
      print: pc.cost,
      flatFee: pc.flat,
      verified: pc.verified,
      minListFlat60: pc.cost / R.flat,
      minListTiered: pc.cost / R.tierRate.below,
      /* A starting ladder only. Retail price is a market decision, not a
         formula, so the UI lets you type your own and recomputes against these
         costs. */
      points: kdpPriceLadder(pc.cost, cur).map(p => kdpRoyalty(p, pc.cost, cur))
    };
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Working backwards from a target length.

   You normally know roughly how long the book should be — a 400-page brick, or
   something that squeaks under the 110-page flat printing fee — and the puzzle
   count falls out of that. Page count rises monotonically with puzzle count, so
   this walks to the largest count that still fits.
--------------------------------------------------------------------------- */
/* The plan for a book in the library. Everything that needs a page count goes
   through here so the rules sections a book carries are never forgotten. */
function kdpPlanFor(book, puzzleCount){
  const bands = kdpBands(book);
  return kdpPlan(book.preset, puzzleCount || book.puzzleCount,
                 {modes: kdpBookModes(bands, book.mode)});
}

function kdpPuzzlesForPages(presetId, targetPages, opts){
  presetId = kdpResolvePreset(presetId);
  const P = KDP_PRESETS[presetId];
  if(!P) throw new Error("Unknown preset "+presetId);

  const perPuzzle = 1/P.puzzlesPerPage + 1/P.solsPerPage;   /* pages each puzzle adds */
  let n = Math.max(1, Math.round((targetPages - 11) / perPuzzle));
  const planOf = function(k){ try { return kdpPlan(presetId, k, opts); } catch(e){ return null; } };

  /* walk up while we still fit, then back off to the last that did */
  let guard = 0;
  while(guard++ < 5000){
    const p = planOf(n + 1);
    if(!p || p.total > targetPages) break;
    n++;
  }
  guard = 0;
  while(n > 1 && guard++ < 5000){
    const p = planOf(n);
    if(p && p.total <= targetPages) break;
    n--;
  }
  const plan = planOf(n);
  if(!plan){
    /* target is below the shortest book KDP will accept — give the shortest legal one */
    for(let k = 1; k < 5000; k++){
      const p = planOf(k);
      if(p) return { puzzleCount: k, pages: p.total, short: true };
    }
    throw new Error("No valid book exists at this size.");
  }
  return { puzzleCount: n, pages: plan.total, short: false };
}

/* Spread a total across levels as evenly as it goes, remainder to the earlier
   bands so the book eases in rather than ending on an odd short stretch. */
/* Spread a total across a list of bands. Each entry is either a difficulty
   name or a {mode, difficulty} pair, so this splits a climb and a variety book
   the same way. */
function kdpSplitBands(total, specs){
  const k = specs.length;
  if(k === 0) return [];
  const base = Math.floor(total / k);
  let rem = total - base*k;
  return specs.map(function(d){
    const extra = rem > 0 ? 1 : 0;
    if(rem > 0) rem--;
    const spec = (typeof d === "string") ? {difficulty: d} : d;
    return { mode: spec.mode, difficulty: spec.difficulty, count: base + extra };
  });
}

/* ---------------------------------------------------------------------------
   Repeats.

   Overlapping seed ranges are the obvious way to ship the same puzzle twice,
   and kdpLedgerCheck refuses those. These cover the rest of it: an audit of the
   whole library rather than one book at a time, and a fingerprint check over a
   dealt deck so a repeat inside a single book cannot reach print either.
--------------------------------------------------------------------------- */
function kdpAuditLedger(books){
  const problems = [];
  for(const id in books){
    if(!Object.prototype.hasOwnProperty.call(books,id)) continue;
    try { kdpLedgerCheck(books, id); }
    catch(e){ problems.push({ id: id, message: e.message }); }
  }
  return problems;
}

/* A puzzle is fully described by its solution grid plus which cells are given
   plus its cages, so that is what identity means here. */
function kdpFingerprint(P){
  let f = "";
  for(let i=0;i<81;i++) f += P.sol[i];
  f += "|";
  for(let i=0;i<81;i++) f += P.given[i] ? "1" : "0";
  if(P.cages && P.cages.length){
    f += "|";
    for(const g of P.cages) f += g.sum + ":" + g.cells.join(".") + ";";
  }
  return f;
}

function kdpFindDuplicates(deck){
  const seen = {}, dupes = [];
  for(let i=0;i<deck.length;i++){
    const f = kdpFingerprint(deck[i]);
    if(seen[f] === undefined) seen[f] = i;
    else dupes.push({ first: seen[f] + 1, repeat: i + 1 });
  }
  return dupes;
}

/* Warnings the exporter surfaces before it will deal anything. */
function kdpWarnings(plan){
  const w = [];
  const cur = KDP_RATES.print[plan.category].USD;
  if(plan.total < KDP_RATES.minInteriorPages)
    w.push({level:"error", text:"KDP will not accept an interior under "+KDP_RATES.minInteriorPages+
      " pages. This one is "+plan.total+"."});
  if(plan.total > KDP_RATES.maxInteriorPages)
    w.push({level:"error", text:"Interior is "+plan.total+" pages; KDP's ceiling is "+KDP_RATES.maxInteriorPages+"."});

  /* The flat-fee cliff. Whether it is worth chasing depends on how far past it
     you are, not on a flag someone has to remember to set: just over, and
     dropping a few puzzles is a real fix; far over, and per-page printing is
     simply what a book this long costs. */
  const CHASEABLE = 40;
  if(plan.total <= cur.flatMax + CHASEABLE){
    if(plan.total > cur.flatMax){
      /* Pages saved per puzzle removed: one puzzle page slot plus one solution slot. */
      const perPuzzle = 1/plan.preset.puzzlesPerPage + 1/plan.preset.solsPerPage;
      const over = plan.total - cur.flatMax;
      const drop = Math.ceil(over / perPuzzle);
      w.push({level:"warn", loud:true, text:
        "OVER THE FLAT-FEE THRESHOLD. "+plan.total+" pages is "+over+" past "+cur.flatMax+
        ", so printing switches from a flat fee to per-page and every copy costs more. "+
        "Drop about "+drop+" puzzles — try "+Math.max(1, plan.puzzleCount-drop)+" — to get back under."});
    } else if(plan.total === cur.flatMax){
      w.push({level:"warn", text:
        "Sitting exactly on the "+cur.flatMax+"-page flat-fee ceiling with zero slack. "+
        "One more puzzle page, one extra line of front matter, or a second series page "+
        "tips this into per-page printing."});
    } else if(cur.flatMax - plan.total <= 4){
      w.push({level:"warn", text:
        "Only "+(cur.flatMax-plan.total)+" pages of headroom under the "+cur.flatMax+"-page flat-fee ceiling."});
    }
  } else {
    w.push({level:"note", text:
      "At "+plan.total+" pages this is well past the "+cur.flatMax+"-page flat-fee tier, so printing is "+
      "per-page. That is what a book this long costs — the threshold is not worth chasing here."});
  }
  if(!KDP_RATES.print[plan.category].GBP.verified)
    w.push({level:"note", text:
      "UK "+plan.category.toLowerCase()+"-trim printing rate is UNVERIFIED — confirm in KDP's own calculator at title setup."});
  return w;
}

/* ---------------------------------------------------------------------------
   Grid fitting and the legibility floor.

   Note on the fallback: shrinking a grid makes its type SMALLER, so "reduce
   the grid and re-fit" cannot rescue undersized digits. The only real lever is
   to give the grid MORE room, so this reclaims the reserved note strip a bit
   at a time before giving up. If the grid is already at the live-area limit
   and type is still under the floor, it returns ok:false and the caller aborts
   the export naming the preset/mode combination.
--------------------------------------------------------------------------- */
function kdpFitGrid(availW, availH, reserve, opts){
  opts = opts || {};
  /* The heaviest border is centred on the grid outline, so half of it falls
     outside the nominal box. Hold that back on every side. */
  const bleed = KDP_LAYOUT.boxLineW;
  availW = availW - bleed;
  availH = availH - bleed;
  let res = reserve;
  for(;;){
    const grid = Math.min(availW, availH - res);
    const cell = grid/9;
    const sizes = [];
    if(opts.given)  sizes.push(cell*KDP_LAYOUT.givenRatio);
    if(opts.sol)    sizes.push(cell*KDP_LAYOUT.solRatio);
    if(opts.cages)  sizes.push(cell*KDP_LAYOUT.cageRatio);
    const smallest = sizes.length ? Math.min.apply(null, sizes) : 99;
    if(grid > 0 && smallest >= KDP_LAYOUT.minTypePt)
      return { grid, cell, reserve: res, smallest, ok: true };
    if(res <= 0)
      return { grid, cell, reserve: 0, smallest, ok: false };
    res = Math.max(0, res - 2);
  }
}

/* ---------------------------------------------------------------------------
   Vector grid drawing, in points. This is the existing pdfGrid, moved off mm
   and off A4 onto preset-driven geometry, with print line weights.
--------------------------------------------------------------------------- */
function kdpDrawGrid(ctx, P, x, y, size, opt){
  const doc = ctx.doc, cell = size/9;
  const L = KDP_LAYOUT;

  if(opt.tints && P.kind === "x"){
    doc.setFillColor(L.tint, L.tint, L.tint);
    for(let i=0;i<9;i++){
      ctx.rect(x+i*cell, y+i*cell, cell, cell, "F");
      if(8-i !== i) ctx.rect(x+(8-i)*cell, y+i*cell, cell, cell, "F");
    }
  }
  if(opt.tints && P.kind === "hyper"){
    doc.setFillColor(L.tint, L.tint, L.tint);
    for(const rc of [[1,1],[1,5],[5,1],[5,5]])
      ctx.rect(x+rc[1]*cell, y+rc[0]*cell, 3*cell, 3*cell, "F");
  }

  doc.setDrawColor(0);
  for(let i=0;i<=9;i++){
    doc.setLineWidth(i%3===0 ? L.boxLineW : L.cellLineW);
    ctx.line(x+i*cell, y, x+i*cell, y+size);
    ctx.line(x, y+i*cell, x+size, y+i*cell);
  }

  /* How far down the cell the cage-sum band reaches. Zero when no sums are
     drawn, so uncaged grids and the solutions section are unaffected. */
  let sumBand = 0;

  if(opt.cages && P.cages && P.cages.length){
    const inset = cell*0.085;
    doc.setDrawColor(70);
    doc.setLineWidth(L.cageLineW);
    doc.setLineDashPattern([cell*0.09, cell*0.075], 0);
    const diffAt = (i,j) => j<0 || P.cageOf[i] !== P.cageOf[j];
    for(let i=0;i<81;i++){
      const r=(i/9)|0, c=i%9, cx=x+c*cell, cy=y+r*cell;
      const up=diffAt(i, r>0?i-9:-1), dn=diffAt(i, r<8?i+9:-1),
            lf=diffAt(i, c>0?i-1:-1), rt=diffAt(i, c<8?i+1:-1);
      if(up) ctx.line(cx+(lf?inset:0), cy+inset, cx+cell-(rt?inset:0), cy+inset);
      if(dn) ctx.line(cx+(lf?inset:0), cy+cell-inset, cx+cell-(rt?inset:0), cy+cell-inset);
      if(lf) ctx.line(cx+inset, cy+(up?inset:0), cx+inset, cy+cell-(dn?inset:0));
      if(rt) ctx.line(cx+cell-inset, cy+(up?inset:0), cx+cell-inset, cy+cell-(dn?inset:0));
    }
    doc.setLineDashPattern([], 0);

    const sumPt = cell*L.cageRatio;
    /* Ink top of the sum, far enough below the dashed cage border to read as
       sitting inside the cage rather than on it. */
    const sumTop = inset*1.5;
    const sumInk = L.digitInkUp + L.digitInkDown;
    doc.setFont(KDP_FONT_FAMILY, "bold");
    doc.setFontSize(sumPt);
    doc.setTextColor(40,40,40);
    for(const g of P.cages){
      const a = g.cells[0], r=(a/9)|0, c=a%9;
      const s = String(g.sum);
      const tx = x+c*cell+inset*2.0, ty = y+r*cell+sumTop;
      const w = doc.getTextWidth(s);
      doc.setFillColor(255,255,255);
      ctx.rect(tx-sumPt*0.10, ty-sumPt*0.05, w+sumPt*0.20, sumPt*(sumInk+0.11), "F");
      ctx.text(s, tx, ty+sumPt*L.digitInkUp,
               {baseline:"middle", ink:{up:L.digitInkUp, down:L.digitInkDown}});
    }
    /* Where the sum's knockout ends, measured from the top of the cell. */
    sumBand = sumTop + sumPt*(sumInk+0.06);
    doc.setDrawColor(0);
  }

  /* Digits are centred in the cell. In a caged grid they drop by the smallest
     amount that clears the sum's ink — a few per cent of a cell, the same for
     every digit in the grid, so the rows still read as level. */
  const caged = sumBand > 0;
  const givenPt = cell*(caged ? L.givenRatioCaged : L.givenRatio);
  const solPt   = cell*(caged ? L.solRatioCaged   : L.solRatio);
  /* The ink of a digit is not centred on the requested y — it sits 0.016em
     high — so true optical centring nudges down by that much. Then the two
     clamps: never into the sum above, never out of the cell below. */
  const digitCyFor = function(pt){
    const centred = cell/2 + (L.digitInkUp - L.digitInkDown)/2*pt;
    const floorY  = sumBand + cell*L.digitClearIn + L.digitInkUp*pt;
    return Math.min(Math.max(centred, floorY), cell - L.digitInkDown*pt);
  };
  const givenCy = digitCyFor(givenPt);
  const solCy   = digitCyFor(solPt);

  for(let i=0;i<81;i++){
    const r=(i/9)|0, c=i%9;
    if(P.given[i]){
      doc.setTextColor(0,0,0);
      doc.setFont(KDP_FONT_FAMILY, "bold");
      doc.setFontSize(givenPt);
      ctx.text(String(P.sol[i]), x+c*cell+cell/2, y+r*cell+givenCy,
               {align:"center", baseline:"middle", ink:{up:L.digitInkUp, down:L.digitInkDown}});
    } else if(opt.withSol){
      doc.setTextColor(20,20,20);
      doc.setFont(KDP_FONT_FAMILY, "normal");
      doc.setFontSize(solPt);
      ctx.text(String(P.sol[i]), x+c*cell+cell/2, y+r*cell+solCy,
               {align:"center", baseline:"middle", ink:{up:L.digitInkUp, down:L.digitInkDown}});
    }
  }
  doc.setTextColor(0,0,0);
  doc.setFont(KDP_FONT_FAMILY, "normal");
}

/* ---------------------------------------------------------------------------
   Front matter. Adapted from the site's own how-to-play and MODE_RULES copy,
   rewritten for print: no taps, no keyboard shortcuts, no references to the
   app. Every field is overridable from the export form.
--------------------------------------------------------------------------- */
const KDP_MODE_NAME = { killer:"Killer Sudoku", classic:"Classic Sudoku", x:"Sudoku X", hyper:"Hyper Sudoku" };

const KDP_QR_URL = "https://zaneysudoku.com/";
/* QR for KDP_QR_URL: 29x29 modules, version 3, error correction H (30%
   recoverable), generated once and pinned here so every book carries the
   identical code and the bytes never drift. Drawn as vector rectangles, not
   an embedded image, so it is resolution-independent in print and pure black
   ink on white — which is what a scanner wants and what KDP prints best. */
const KDP_QR = [
  "11111110001100110111001111111",
  "10000010001001010010001000001",
  "10111010001110101001101011101",
  "10111010000100010101001011101",
  "10111010100011001001001011101",
  "10000010011010100111101000001",
  "11111110101010101010101111111",
  "00000000111000011110100000000",
  "00110011110000111001011010000",
  "10110101000001110111101110001",
  "01011110111010010000001011010",
  "01111001000000100000100010001",
  "01000111100111010011010101111",
  "01110101001011100101001101111",
  "11101011101100101011011111011",
  "00011001100101011101000011000",
  "01100010011110001111100111001",
  "01000001000101010000100100000",
  "10001010011100000100101101000",
  "00000100110110100101111011100",
  "01001110000000111001111111100",
  "00000000111001001111100011001",
  "11111110100000101011101010110",
  "10000010001011111000100010011",
  "10111010001000110000111111100",
  "10111010100111010101000011110",
  "10111010100101100100100101001",
  "10000010000000100110101011010",
  "11111110001010111001101100010"
];


  /* The rules, the tips and the closing note, taken from the help page at
     zaneysudoku.com/#/help and rewritten for print. Two of the site's sections
     are deliberately not here: Controls, because arrow keys mean nothing on
     paper, and the piece about where the puzzles come from. Its pencil-mark
     advice is folded into the tips, and the pointer to the guides lives on the
     QR page. Two pages per mode; the count is KDP_FRONT.howtoPages and the
     plan pads around it. */
const KDP_HOWTO = {
  killer: [
    [
      {t:"h1", s:"How to play killer sudoku"},
      {t:"p",  s:"Killer sudoku is ordinary sudoku with one twist: there are almost never any starting digits. Instead the grid is carved into dashed cages, and each cage tells you what its digits add up to."},
      {t:"h2", s:"The rules"},
      {t:"li", s:"Every row, every column and every 3×3 box contains the digits 1 to 9, exactly once each."},
      {t:"li", s:"The digits inside each dashed cage add up to the small number printed in its top-left corner."},
      {t:"li", s:"A digit cannot repeat inside a cage."},
      {t:"p",  s:"That is the whole game. Everything after this is deduction."}
    ],
    [
      {t:"h2", s:"Three things worth knowing"},
      {t:"lead", lead:"Learn the forced combinations. ", s:"A two-cell cage summing to 3 can only be 1+2. Sum 4 is 1+3. Sum 16 is 7+9, and 17 is 8+9. Those are free squares — fill them in first and the rest of the grid opens up around them."},
      {t:"lead", lead:"Use the rule of 45. ", s:"Every row, every column and every 3×3 box sums to 45. If the cages covering a box total 43 with a single cell poking out beyond it, that overflow is the value of the cell. Innies and outies win more killer puzzles than raw arithmetic does."},
      {t:"lead", lead:"Pencil marks are not cheating. ", s:"Every puzzle in this book has a blank strip beneath it for working. Use it. Writing down the candidates for a cage is how you find the pair that solves it, and crossing a digit out of a row, column, box and cage as you place it keeps the grid honest."},
      {t:"h2", s:"About the puzzles"},
      {t:"p",  s:"Every puzzle in this book was checked before it was printed: a solver confirmed that each grid has exactly one solution. There are no broken puzzles here and no ambiguous endings. If you are stuck, you are stuck on something that is genuinely there."},
      {t:"p",  s:"Solutions begin on page {{SOLUTIONS_PAGE}}. They will keep."}
    ]
  ],
  classic: [
    [
      {t:"h1", s:"How to play classic sudoku"},
      {t:"p",  s:"No cages, no diagonals, no extra regions. Fill every row, every column and every 3×3 box with the digits 1 to 9, once each. This is the original, and it is still the best one."},
      {t:"h2", s:"The rules"},
      {t:"li", s:"Each of the nine rows contains 1 to 9 with no repeats."},
      {t:"li", s:"Each of the nine columns contains 1 to 9 with no repeats."},
      {t:"li", s:"Each of the nine 3×3 boxes contains 1 to 9 with no repeats."},
      {t:"p",  s:"A digit already printed in the grid is a given. It never changes."}
    ],
    [
      {t:"h2", s:"Three things worth knowing"},
      {t:"lead", lead:"Scan before you write. ", s:"Pick a digit and look for the boxes where it has only one legal home. Working one digit at a time across the whole grid finds more placements, faster, than working one cell at a time."},
      {t:"lead", lead:"Hidden singles beat naked ones. ", s:"A cell with only one candidate left is easy to spot. A digit with only one possible cell left in a row is harder to spot and appears far more often. Look for the second kind."},
      {t:"lead", lead:"Pencil marks are not cheating. ", s:"Every puzzle in this book has a blank strip beneath it for working. When scanning stops producing placements, write the candidates down — pairs and triples only become visible once they are on the page."},
      {t:"h2", s:"About the puzzles"},
      {t:"p",  s:"Every puzzle in this book was checked before it was printed: a solver confirmed that each grid has exactly one solution. There are no broken puzzles here and no ambiguous endings."},
      {t:"p",  s:"Solutions begin on page {{SOLUTIONS_PAGE}}. They will keep."}
    ]
  ],
  x: [
    [
      {t:"h1", s:"How to play Sudoku X"},
      {t:"p",  s:"Classic sudoku plus one extra rule: both shaded diagonals must also contain the digits 1 to 9, once each. Two more regions, and a very different puzzle."},
      {t:"h2", s:"The rules"},
      {t:"li", s:"Every row, every column and every 3×3 box contains 1 to 9 with no repeats."},
      {t:"li", s:"Both shaded diagonals — corner to corner, in each direction — also contain 1 to 9 with no repeats."},
      {t:"p",  s:"The shading is there to help you see the diagonals. It carries no other meaning."}
    ],
    [
      {t:"h2", s:"Three things worth knowing"},
      {t:"lead", lead:"Start at the centre. ", s:"The middle cell sits on both diagonals at once, so it is constrained by four regions rather than three. It is almost always the most productive cell on the grid."},
      {t:"lead", lead:"The diagonals cut through the corners. ", s:"Each corner box holds three diagonal cells. That makes the four corner boxes far more constrained than they look, and they are usually where a stuck grid breaks open."},
      {t:"lead", lead:"Treat a diagonal as a row. ", s:"Everything you know about scanning a row applies to it — hidden singles, pairs, the lot. The only difference is that it crosses five boxes instead of three. Use the blank strip under each puzzle for candidates."},
      {t:"h2", s:"About the puzzles"},
      {t:"p",  s:"Every puzzle in this book was checked before it was printed: a solver confirmed that each grid has exactly one solution, using the diagonal constraint. There are no broken puzzles here."},
      {t:"p",  s:"Solutions begin on page {{SOLUTIONS_PAGE}}. They will keep."}
    ]
  ],
  hyper: [
    [
      {t:"h1", s:"How to play Hyper Sudoku"},
      {t:"p",  s:"Classic sudoku with four extra shaded 3×3 windows, each of which must also contain the digits 1 to 9. Thirteen regions on a nine-by-nine grid."},
      {t:"h2", s:"The rules"},
      {t:"li", s:"Every row, every column and every 3×3 box contains 1 to 9 with no repeats."},
      {t:"li", s:"Each of the four shaded windows also contains 1 to 9 with no repeats."},
      {t:"p",  s:"The windows overlap the ordinary boxes rather than replacing them. A cell inside a window belongs to both."}
    ],
    [
      {t:"h2", s:"Three things worth knowing"},
      {t:"lead", lead:"Work the overlaps. ", s:"A cell inside a shaded window answers to four regions at once — row, column, box and window. Those cells fall first, and they take the rest of the window with them."},
      {t:"lead", lead:"Mind the gaps. ", s:"The row and column between the windows belong to no window at all. They are the least constrained lines on the grid and are usually the last to fill."},
      {t:"lead", lead:"A window is just another box. ", s:"Scan it the same way: pick a digit, find the cells it cannot occupy, see what is left. Thirteen regions means thirteen chances to find a hidden single. Use the blank strip under each puzzle for candidates."},
      {t:"h2", s:"About the puzzles"},
      {t:"p",  s:"Every puzzle in this book was checked before it was printed: a solver confirmed that each grid has exactly one solution, using the window constraint. There are no broken puzzles here."},
      {t:"p",  s:"Solutions begin on page {{SOLUTIONS_PAGE}}. They will keep."}
    ]
  ]
};

/* The pointer to the guides, which used to sit at the end of the how-to
   section. It reads better on the QR page, next to the address it refers to. */
const KDP_GUIDES = {
  killer:  "Three guides live alongside the game and cost nothing to read: a complete beginner\u2019s guide to killer sudoku, a cage combinations cheat sheet giving every sum for every cage size with the forced combinations marked, and a strategy guide on the rule of 45, innies and outies.",
  classic: "Guides, a solutions archive and four daily challenges are there too, along with a cage combinations cheat sheet and a strategy guide if you ever fancy trying killer sudoku.",
  x:       "Guides, a solutions archive and four daily challenges are there too, including a full beginner\u2019s guide and a strategy guide.",
  hyper:   "Guides, a solutions archive and four daily challenges are there too, including a full beginner\u2019s guide and a strategy guide.",
  mixed:   "Every variation in this book is playable there too, alongside guides, a solutions archive and four daily challenges."
};

/* Difficulty copy is generated from the same tables the generator uses, so it
   cannot describe a book it did not produce. */
/* When a book climbs through several levels, this page is what tells the
   reader where they are — otherwise puzzle 200 getting harder just reads as
   the book being inconsistent. */
function kdpAboutBands(mode, bands, modes){
  const ranges = kdpBandRanges(bands);
  const list = (modes && modes.length) ? modes : kdpBookModes(bands, mode);
  const mixed = list.length > 1;
  const modeName = KDP_MODE_NAME[mode] || mode;
  const blocks = [{t:"h1", s:"About the puzzles in this book"}];
  if(mixed){
    const names = list.map(function(m){ return KDP_MODE_NAME[m] || m; });
    blocks.push({t:"p", s:"This book holds "+names.length+" kinds of sudoku: "+
      names.slice(0,-1).join(", ")+" and "+names[names.length-1]+". They run in sections, "+
      "one after another, so you can work straight through or go to the kind you came for."});
    blocks.push({t:"p", s:"The rules for every one of them are set out earlier in this book, "+
      "a section each. If a variation is new to you, read its rules first — they are short."});
  } else {
    blocks.push({t:"p", s:"This is a "+modeName.toLowerCase()+" book that gets harder as you go. "+
      "It starts gently and finishes at the top of the range, so you can work straight through it "+
      "and feel the climb rather than picking puzzles at random."});
  }
  blocks.push({t:"h2", s:"How it is arranged"});
  for(const r of ranges){
    const label = (typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[r.difficulty]) || r.difficulty;
    const what = mixed ? ((KDP_MODE_NAME[r.mode] || r.mode) + ", " + String(label).toLowerCase()) : label;
    blocks.push({t:"li", s:"Puzzles "+r.from+" to "+r.to+" — "+what+" ("+r.count+" puzzle"+(r.count===1?"":"s")+")"});
  }
  blocks.push({t:"p", s:"Every puzzle is labelled at the top of the page with "+
    (mixed ? "its kind and its level" : "its level")+", and the running head along the top edge "+
    "carries it too, so you always know where you are."});
  const mins = ranges.map(function(r){
    const m = r.mode || mode;
    return (typeof PAR !== "undefined" && PAR[m] && PAR[m][r.difficulty])
      ? Math.round(PAR[m][r.difficulty]/60) : null;
  }).filter(function(x){ return x; });
  if(!mixed && mins.length >= 2)
    blocks.push({t:"p", s:"Our own target times run from about "+mins[0]+" minutes at the start to "+
      "around "+mins[mins.length-1]+" minutes by the end. They are benchmarks, not a judgement — nobody is timing you."});
  blocks.push({t:"p", s:"Difficulty is set by how each grid is built, not by how it looks, and every "+
    "puzzle was checked to have exactly one solution before it was printed."});
  return blocks;
}

function kdpAboutDifficulty(mode, diff){
  const label = (typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[diff]) || diff;
  const mins  = (typeof PAR !== "undefined" && PAR[mode] && PAR[mode][diff])
                  ? Math.round(PAR[mode][diff]/60) : null;
  const blocks = [{t:"h1", s:"About this difficulty"}];
  const tone = {
    easy:      "This is the gentle end. Expect steady progress and few dead ends — a puzzle you can finish in one sitting without writing much down.",
    medium:    "The middle of the range. Scanning will get you a good way in, then you will need to start writing candidates down to finish.",
    hard:      "Properly hard. There will be points where no digit is immediately placeable and the only way forward is through the candidates.",
    expert:    "For solvers who already finish hard puzzles reliably. Long chains of deduction, and stretches where progress comes one cell at a time.",
    nightmare: "The top of the range, and not an exaggeration. These are built to resist. Set aside an evening and expect to leave one unfinished occasionally.",
    cowards:   "Every puzzle here can be solved one obvious step at a time, start to finish. There is never a moment where you must guess or write out candidates — if you cannot see the next move, it is there and you have missed it."
  };
  blocks.push({t:"p", s:(mode==="killer"?"Killer sudoku, ":mode==="x"?"Sudoku X, ":mode==="hyper"?"Hyper sudoku, ":"Classic sudoku, ")+
                        String(label).toLowerCase()+". "+(tone[diff]||"")});

  if(mode === "killer" && typeof DIFF_CFG !== "undefined" && DIFF_CFG[diff]){
    const sz = DIFF_CFG[diff].sizes;
    blocks.push({t:"p", s:"Cages in this volume run from "+Math.min.apply(null,sz)+" to "+
      Math.max.apply(null,sz)+" cells. "+(DIFF_CFG[diff].reveal
        ? "A handful of digits are given to start you off."
        : "No starting digits are given — every cell is deduced from the cage sums.")});
  } else if(mode === "classic" && typeof CLASSIC_CLUES !== "undefined" && CLASSIC_CLUES[diff]){
    blocks.push({t:"p", s:"Puzzles at this level start from around "+CLASSIC_CLUES[diff]+" given digits."});
  } else if(mode === "x" && typeof X_CLUES !== "undefined" && X_CLUES[diff]){
    blocks.push({t:"p", s:"Puzzles at this level start from around "+X_CLUES[diff]+" given digits, before the diagonals are taken into account."});
  } else if(mode === "hyper" && typeof H_CLUES !== "undefined" && H_CLUES[diff]){
    blocks.push({t:"p", s:"Puzzles at this level start from around "+H_CLUES[diff]+" given digits, before the windows are taken into account."});
  }
  if(mins) blocks.push({t:"p", s:"Our own target time for a puzzle at this level is about "+mins+" minutes. It is a benchmark, not a judgement — nobody is timing you."});
  blocks.push({t:"p", s:"Difficulty is set by how the grid is built, not by how it looks. Every puzzle in this book sits at the same level, so the last one is no harder than the first."});
  return blocks;
}

function kdpDefaultFront(mode, diff, opts){
  opts = opts || {};
  const year = opts.year || 2026;
  const modes = (opts.modes && opts.modes.length) ? opts.modes : [mode];
  const mixed = modes.length > 1;
  const modeName = mixed ? "Sudoku Variety" : (KDP_MODE_NAME[mode] || "Sudoku");
  const label = (typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[diff]) || diff;
  /* The half title is three lines, always, in this order: the company, the
     book, then the volume. They are separate fields because they are set in
     different type and because "Zaney Sudoku Killer Sudoku Vol 1" on one line
     is not a title page. `title` is the composed form, for the copyright page,
     the PDF metadata and the series list — the imprint is the publisher, so it
     is deliberately not part of it. */
  const imprint  = opts.imprint  || "Zaney Sudoku";
  const bookName = opts.bookName || modeName;
  /* Every book gets a volume line by default: the half title is a three-line
     shape, and a missing volume would collapse it back to two. */
  const volume   = opts.volume === undefined ? "Vol 1" : (opts.volume || "");
  return {
    bookName, volume,
    title:    opts.title || [bookName, volume].filter(Boolean).join(" "),
    subtitle: opts.subtitle || (opts.puzzleCount ? opts.puzzleCount+" puzzles, every one verified" : ""),
    imprint,
    author:   opts.author  || "zaney.dev",
    isbn:     opts.isbn    || "",
    site:     opts.site    || "zaneysudoku.com",
    /* The two credits every Zaney book carries. Overridable, but they default
       on: the maker's line sits under the copyright, and the muse's line sits
       in the middle of the block where it was asked to go — not first, where it
       would read as the publisher, and not last, where it would read as an
       afterthought. */
    creator: opts.creator === undefined ? "Created by Zane Morris-Stewart." : opts.creator,
    muse:    opts.muse    === undefined ? "Mused by Caroline R. Grant."    : opts.muse,
    copyright: opts.copyright || [
      "Copyright © "+year+" "+(opts.author||"zaney.dev"),
      opts.creator === undefined ? "Created by Zane Morris-Stewart." : opts.creator,
      "All rights reserved. No part of this publication may be reproduced, distributed or transmitted in any form or by any means without the prior written permission of the publisher, except for brief quotations in a review.",
      opts.muse === undefined ? "Mused by Caroline R. Grant." : opts.muse,
      "Puzzles created and verified by Zaney Sudoku. Every puzzle in this volume has been checked to have exactly one solution.",
      "First edition."
    ].filter(Boolean),
    howto: kdpHowtoFor(modes),
    guides: opts.guides || (mixed ? KDP_GUIDES.mixed : (KDP_GUIDES[mode] || KDP_GUIDES.classic)),
    about: (opts.bands && opts.bands.length > 1)
             ? kdpAboutBands(mode, opts.bands, modes)
             : kdpAboutDifficulty(mode, diff)
  };
}

/* ---------------------------------------------------------------------------
   Cage combinations — the back-matter cheat sheet.

   The same tables as zaneysudoku.com/killer-sudoku-combinations.html, but
   computed here rather than copied: every way to fill an n-cell cage is every
   set of n distinct digits from 1 to 9 that adds to the total, in the order the
   site lists them. dev/check-combos.py parses the site's page and asserts the
   two agree, so the printed sheet cannot drift from the one online.

   Only killer books carry it, and it goes after the solutions.
--------------------------------------------------------------------------- */
const KDP_COMBO_SIZES = [2, 3, 4, 5];
const KDP_COMBO_NAME = {2:"Two-cell cages", 3:"Three-cell cages",
                        4:"Four-cell cages", 5:"Five-cell cages"};

function kdpComboTable(n){
  const bySum = {}, cur = [];
  (function walk(start, left, sum){
    if(left === 0){ (bySum[sum] = bySum[sum] || []).push(cur.join("+")); return; }
    for(let d = start; d <= 9; d++){ cur.push(d); walk(d+1, left-1, sum+d); cur.pop(); }
  })(1, n, 0);
  const out = [];
  for(const k of Object.keys(bySum).map(Number).sort(function(a,b){ return a-b; }))
    out.push({sum: k, ways: bySum[k].length, list: bySum[k]});
  return out;
}

/* The sums with exactly one way to fill them — the ones worth memorising. */
function kdpComboForced(){
  const out = [];
  for(const n of KDP_COMBO_SIZES)
    for(const r of kdpComboTable(n))
      if(r.ways === 1) out.push({cells: n, sum: r.sum, only: r.list[0]});
  return out;
}

/* Text measurement. The section's page count has to be known before anything is
   laid out, and that needs real font metrics, so the app installs a measurer
   built from the same jsPDF and the same embedded font it will print with.
   Guessing instead would make the plan and the page disagree. */
let KDP_MEASURE = null;
let KDP_COMBO_CACHE = {};
function kdpSetMeasure(fn){ KDP_MEASURE = fn; KDP_COMBO_CACHE = {}; }
function kdpMeasure(str, pt, weight){
  if(!KDP_MEASURE)
    throw new Error("EXPORT ABORTED — no text measurer installed. The cage-combinations "+
      "section cannot be paginated without one; call kdpSetMeasure() with a function "+
      "(text, pt, weight) => width in points, built from jsPDF and the embedded font.");
  return KDP_MEASURE(str, pt, weight);
}

const KDP_COMBO_STYLE = {
  h1:   {size: 17,  font: "bold",   before: 0,  after: 12, lead: 1.24},
  h2:   {size: 11.5,font: "bold",   before: 14, after: 6,  lead: 1.24},
  p:    {size: 8.6, font: "normal", before: 0,  after: 8,  lead: 1.42},
  lead: {size: 8.6, font: "normal", before: 0,  after: 8,  lead: 1.42},
  head: {size: 7.4, font: "bold",   before: 0,  after: 3,  lead: 1.5},
  row:  {size: 8,   font: "normal", before: 0,  after: 0,  lead: 1.5},
  gap:  6
};

/* The width the section is set to. Deliberately the narrowest live area the
   book could end up with — the widest gutter tier — because the gutter depends
   on the page count and the page count depends on this. Fixing it at the worst
   case breaks the loop, and a book with a slimmer gutter simply gets a little
   more white to the outside. */
function kdpComboWidth(P){
  const trim = kdpTrimPt(P);
  const worst = KDP_GUTTER_TIERS[KDP_GUTTER_TIERS.length - 1].gutterIn;
  return trim[0] - (KDP_MARGIN_IN + Math.max(worst, KDP_GUTTER_FLOOR_IN)) * KDP_IN;
}

function kdpComboWrap(str, width, st){
  /* Word wrap against real metrics; returns the number of lines. */
  const words = String(str).split(" ");
  let lines = 1, cur = "";
  for(const w of words){
    const next = cur ? cur + " " + w : w;
    if(kdpMeasure(next, st.size, st.font) <= width || !cur) cur = next;
    else { lines++; cur = w; }
  }
  return lines;
}

/* The section as a list of atoms, each with the height it will occupy. Atoms
   are what get packed into pages, so nothing can be measured one way and drawn
   another. */
function kdpComboAtoms(width){
  const S = KDP_COMBO_STYLE;
  const atoms = [];
  const prose = function(kind, text, lead){
    const st = S[kind];
    const w = lead ? width : width;
    const n = kdpComboWrap((lead ? lead + text : text), w, st);
    atoms.push({t: kind, s: text, lead: lead || null,
                h: st.before + n*st.size*st.lead + st.after});
  };

  prose("h1", "Cage combinations");
  prose("p", "A cage's total limits which digits can live inside it. Some totals are generous — a three-cell cage of 15 can be filled eight ways. Others are a gift: a two-cell cage of 17 can only be 8+9. Spotting the forced ones is the single biggest upgrade you can make to your solving.");
  prose("p", "Every combination below is a set of different digits, because a digit cannot repeat inside a cage. The order within a cage is for you to work out.");

  /* Forced table: three narrow columns, one line each. */
  prose("h2", "The forced combinations");
  prose("p", "These totals have exactly one possible combination. When you see one you know every digit in the cage at once — you just do not know the order yet.");
  const forced = kdpComboForced();
  const colW = [width*0.22, width*0.16, width*0.62];
  atoms.push({t:"fhead", cols: colW, h: S.head.size*S.head.lead + S.head.after});
  for(const f of forced)
    atoms.push({t:"frow", f: f, cols: colW, h: S.row.size*S.row.lead});
  atoms.push({t:"space", h: S.gap});
  prose("p", "The forced totals always come in pairs at the extremes — the two smallest and the two largest a cage of that size can hold. If a total is near the limit for its size, check here first.");

  const notes = {
    2: "Totals run from 3 to 17. A two-cell cage can never make 10 out of 5+5, so 10 has four options rather than five.",
    3: "Totals run from 6 to 24. The middle of the range is the murkiest, with up to eight combinations each — lean on the row and box constraints to narrow them.",
    4: "Totals run from 10 to 30. Even the crowded ones exclude digits, which is often more useful than knowing what is in the cage.",
    5: "Totals run from 15 to 35. At this size the extremes are still worth memorising; the middle is best used for what it rules out."
  };
  for(const n of KDP_COMBO_SIZES){
    prose("h2", KDP_COMBO_NAME[n]);
    prose("p", notes[n]);
    const rows = kdpComboTable(n);
    /* One fixed column width per cage size, so the grid lines up down the page
       instead of wrapping ragged. */
    let itemW = 0;
    for(const r of rows) for(const c of r.list)
      itemW = Math.max(itemW, kdpMeasure(c, S.row.size, S.row.font));
    const sumW = kdpMeasure("Total", S.head.size, S.head.font) + 10;
    const waysW = kdpMeasure("Ways", S.head.size, S.head.font) + 10;
    const listW = width - sumW - waysW;
    const perLine = Math.max(1, Math.floor(listW / (itemW + S.gap*1.6)));
    atoms.push({t:"thead", n: n, sumW: sumW, waysW: waysW,
                h: S.head.size*S.head.lead + S.head.after});
    for(const r of rows){
      const lines = Math.ceil(r.ways / perLine);
      atoms.push({t:"trow", r: r, n: n, sumW: sumW, waysW: waysW,
                  perLine: perLine, itemW: itemW, h: lines*S.row.size*S.row.lead});
    }
    atoms.push({t:"space", h: S.gap});
  }

  prose("h2", "How to use these tables");
  prose("lead", "Scan the puzzle for any cage whose total appears in the forced table, and pencil those digits in straight away.", "Start at the extremes. ");
  prose("lead", "A two-cell cage of 16 is 7+9 — but if a 7 already sits in that row, the cage cell in that row must be the 9.", "Intersect with the sudoku rules. ");
  prose("lead", "Even a total with many combinations rules digits out. A two-cell cage of 5 is 1+4 or 2+3, so it can never hold 5, 6, 7, 8 or 9 — five eliminations for free.", "Use the exclusions. ");
  prose("lead", "Cage combinations and the rule of 45 together will carry you through most hard puzzles without a guess.", "Combine with the rule of 45. ");
  return atoms;
}

/* Pack the atoms into pages. A table header is never left stranded at the foot
   of a page with nothing under it, and a heading never ends a page either. */
function kdpComboPages(presetId){
  presetId = kdpResolvePreset(presetId);
  if(KDP_COMBO_CACHE[presetId]) return KDP_COMBO_CACHE[presetId];
  const P = KDP_PRESETS[presetId];
  if(!P) throw new Error("Unknown preset "+presetId);
  const width = kdpComboWidth(P);
  const trim = kdpTrimPt(P);
  const height = trim[1] - 2*KDP_MARGIN_IN*KDP_IN - KDP_LAYOUT.footBlockPt;

  const atoms = kdpComboAtoms(width);
  const pages = [];
  let cur = [], used = 0, head = null;
  const flush = function(){ if(cur.length){ pages.push(cur); cur = []; used = 0; } };
  for(let i = 0; i < atoms.length; i++){
    const a = atoms[i];
    if(a.t === "thead" || a.t === "fhead") head = a;
    if(a.t === "h1" || a.t === "h2") head = null;
    if(used + a.h > height && cur.length){
      /* Do not orphan a heading or a table header at the foot of a page. */
      while(cur.length && /^(h1|h2|thead|fhead)$/.test(cur[cur.length-1].t)) i--, cur.pop();
      flush();
      /* A table running over a page break repeats its column headings, because
         a reference table whose columns are named on the previous page is a
         table you have to flip back and forth to read. */
      if(head && (atoms[i+1] || a).t !== "thead" && (atoms[i+1] || a).t !== "fhead" &&
         /^(trow|frow)$/.test(a.t)){
        const cont = Object.assign({}, head, {cont: true});
        cur.push(cont); used += cont.h;
      }
    }
    if(a.t === "space" && used === 0) continue;
    cur.push(a); used += a.h;
  }
  flush();
  KDP_COMBO_CACHE[presetId] = pages;
  return pages;
}

/* ---------------------------------------------------------------------------
   Drawing context. Every mark goes through here so the validator can walk the
   drawing calls afterwards and bounds-check them against the mirrored live
   area, rather than eyeballing a render.
--------------------------------------------------------------------------- */
const KDP_FONT_FAMILY = "Inter";

function kdpCtx(doc, trace){
  return {
    doc: doc,
    page: 1,
    marks: trace ? [] : null,
    trace: !!trace,
    _m: function(x,y,w,h,stroked,kind){ if(this.marks) this.marks.push({page:this.page, x:x, y:y, w:Math.max(w,0), h:Math.max(h,0), s:!!stroked, t:kind||"draw"}); },
    line: function(x1,y1,x2,y2){
      this.doc.line(x1,y1,x2,y2);
      this._m(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1), true);
    },
    rect: function(x,y,w,h,style){
      this.doc.rect(x,y,w,h,style);
      this._m(x,y,w,h, style !== "F");
    },
    circle: function(x,y,r,style){
      this.doc.circle(x,y,r,style);
      this._m(x-r, y-r, 2*r, 2*r, style !== "F");
    },
    /* Images go through here for the same reason everything else does: the
       validator walks the marks afterwards and an image that strayed into a
       margin has to be as visible to it as a stray line would be. */
    image: function(data,x,y,w,h,alias){
      this.doc.addImage(data, "PNG", x, y, w, h, alias, "NONE");
      this._m(x,y,w,h,false,"image");
    },
    text: function(str,x,y,o){
      o = o||{};
      this.doc.text(str,x,y,o);
      if(!this.marks) return;
      const size = this.doc.getFontSize();
      const w = this.doc.getTextWidth(str);
      const tx = o.align==="center" ? x-w/2 : o.align==="right" ? x-w : x;
      /* Callers that know their string is all digits pass the measured ink
         extents. Everything else falls back to the em box, which is generous
         but never lets a real collision through. */
      const ink = o.ink;
      const ty = ink ? y - size*ink.up
               : o.baseline==="middle" ? y-size*0.5
               : o.baseline==="top"    ? y
               : o.baseline==="bottom" ? y-size
               : y - size*0.78;
      this._m(tx, ty, w, ink ? size*(ink.up+ink.down) : size*1.02, false, "text");
    }
  };
}

/* ---------------------------------------------------------------------------
   Text flow for front and back matter.
--------------------------------------------------------------------------- */
const KDP_TEXT = {
  h1:   {size:17,   font:"bold",   before:0,  after:13, lead:1.24},
  h2:   {size:11.5, font:"bold",   before:15, after:6,  lead:1.24},
  p:    {size:9.5,  font:"normal", before:0,  after:9,  lead:1.44},
  lead: {size:9.5,  font:"normal", before:0,  after:9,  lead:1.44},
  li:   {size:9.5,  font:"normal", before:0,  after:6,  lead:1.44, indent:13},
  small:{size:8,    font:"normal", before:0,  after:7,  lead:1.42}
};

/* Greedy line breaker over mixed bold/normal runs, so a bold lead-in can share
   a line with the sentence that follows it. */
function kdpBreakRuns(doc, runs, maxW, size){
  const lines = [];
  let cur = [], curW = 0;
  for(const run of runs){
    doc.setFont(KDP_FONT_FAMILY, run.font);
    doc.setFontSize(size);
    const words = String(run.s).split(/\s+/).filter(function(w){ return w.length; });
    for(let i=0;i<words.length;i++){
      const word = words[i];
      const wpx = doc.getTextWidth(word);
      const spx = doc.getTextWidth(" ");
      const add = cur.length ? spx + wpx : wpx;
      if(curW + add > maxW && cur.length){
        lines.push(cur); cur = []; curW = 0;
        cur.push({s:word, font:run.font, w:wpx}); curW = wpx;
      } else {
        cur.push({s:word, font:run.font, w:wpx, space:cur.length>0});
        curW += add;
      }
    }
  }
  if(cur.length) lines.push(cur);
  return lines;
}

function kdpFlow(ctx, blocks, box, startY, align){
  const doc = ctx.doc;
  let y = startY;
  for(const b of blocks){
    const st = KDP_TEXT[b.t] || KDP_TEXT.p;
    y += st.before;
    const indent = st.indent || 0;
    const maxW = box.w - indent;
    let runs;
    if(b.t === "lead") runs = [{s:b.lead, font:"bold"}, {s:b.s, font:"normal"}];
    else               runs = [{s:b.s,    font:st.font}];
    const lines = kdpBreakRuns(doc, runs, maxW, st.size);
    const lh = st.size * st.lead;
    for(let li=0; li<lines.length; li++){
      const line = lines[li];
      let x = box.x + indent;
      if(align === "center"){
        let tw = 0;
        for(const t of line) tw += t.w + (t.space ? doc.getTextWidth(" ") : 0);
        x = box.x + (box.w - tw)/2;
      }
      if(b.t === "li" && li === 0){
        /* Drawn, not typed: see kdpUnsupportedChars. */
        doc.setFillColor(0,0,0);
        ctx.circle(box.x + 3.4, y + st.size*0.52, st.size*0.115, "F");
      }
      for(const t of line){
        doc.setFont(KDP_FONT_FAMILY, t.font); doc.setFontSize(st.size);
        if(t.space) x += doc.getTextWidth(" ");
        ctx.text(t.s, x, y + st.size*0.78, {});
        x += t.w;
      }
      y += lh;
    }
    y += st.after;
  }
  return y;
}

/* ---------------------------------------------------------------------------
   Page rendering
--------------------------------------------------------------------------- */
/* The contents, worked out from the plan and the deck rather than typed in, so
   it cannot drift from the book. Difficulty bands are read back off the deck
   itself — consecutive puzzles sharing a level become one line — which means a
   book that climbs lists its climb, and a single-level book gets one row.
   Only numbered pages are listed: the front matter carries no folios, so
   pointing at it would be pointing at a page with no number on it. */
function kdpContents(plan, cfg){
  const rows = [];
  const per = plan.preset.puzzlesPerPage;
  const pageOf = function(i){ return plan.puzzleStart + Math.floor(i/per); };
  /* Built from the book's difficulty bands and the plan, never from the deck
     that happens to be in memory. A proof export deals only the puzzles its
     page limit needs, and a contents read off that short deck would print a
     range the finished book does not have. */
  const bands = (cfg && cfg.bands && cfg.bands.length)
    ? cfg.bands
    : [{difficulty: (cfg && cfg.diff) || null, count: plan.puzzleCount}];
  /* Name the variation as well as the level once a book holds more than one,
     because that is what a reader is looking for in the contents. */
  const modes = kdpBookModes(bands, cfg && cfg.mode);
  let from = 0;
  for(const b of bands){
    const n = Math.min(b.count, plan.puzzleCount - from);
    if(!(n > 0)) break;
    const level = b.difficulty && typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[b.difficulty];
    const kind = modes.length > 1 ? (KDP_MODE_NAME[b.mode] || b.mode) : null;
    const name = kind ? (level ? kind + " · " + level : kind) : level;
    rows.push({label: (name ? name + " — puzzles " : "Puzzles ") + (from+1) + "–" + (from+n),
               page: pageOf(from)});
    from += n;
  }
  /* The divider itself is unnumbered, so point at the first page of solutions,
     which is also the page the how-to section names. */
  if(from > 0) rows.push({label:"Solutions", page: plan.solutionStart});
  if(plan.comboPages) rows.push({label:"Cage combinations", page: plan.comboStart});
  return rows;
}

/* Letterspacing, for the imprint line on the half title. jsPDF has charSpace
   but it is not honoured consistently across its text paths, so the tracking is
   done here and every glyph goes through ctx.text like everything else. */
function kdpTracked(ctx, str, cx, y, track){
  const doc = ctx.doc;
  let total = 0;
  for(let i=0;i<str.length;i++) total += doc.getTextWidth(str[i]) + (i<str.length-1 ? track : 0);
  let x = cx - total/2;
  for(let i=0;i<str.length;i++){
    if(str[i] !== " ") ctx.text(str[i], x, y, {});
    x += doc.getTextWidth(str[i]) + track;
  }
}

/* The QR as vector rectangles: maximal horizontal runs of dark modules, each a
   filled black box. No image, no resolution, no halftone — the printer gets a
   hard-edged path, which is what makes a small code scan reliably off paper.
   Runs are drawn a whisker tall so adjacent rows cannot show a seam. */
function kdpDrawQR(ctx, x, y, size){
  const n = KDP_QR.length, m = size/n;
  ctx.doc.setFillColor(0,0,0);
  for(let r=0;r<n;r++){
    const row = KDP_QR[r];
    let c = 0;
    while(c < n){
      if(row[c] !== "1"){ c++; continue; }
      let k = c;
      while(k < n && row[k] === "1") k++;
      ctx.rect(x + c*m, y + r*m, (k-c)*m, m*1.02, "F");
      c = k;
    }
  }
}

/* Draw one page of the cage-combinations sheet. The atoms were measured when
   the book was planned; this only positions them, so what is printed is exactly
   what the page count was worked out from. */
function kdpRenderCombosPage(ctx, plan, box, part){
  const doc = ctx.doc, S = KDP_COMBO_STYLE;
  const page = kdpComboPages(plan.presetId)[part-1] || [];
  const width = kdpComboWidth(plan.preset);
  let y = box.y;

  const line = function(str, x, baseY, st, weight){
    doc.setFont(KDP_FONT_FAMILY, weight || st.font);
    doc.setFontSize(st.size);
    ctx.text(str, x, baseY, {});
  };

  for(const a of page){
    if(a.t === "space"){ y += a.h; continue; }

    if(a.t === "h1" || a.t === "h2" || a.t === "p" || a.t === "lead"){
      const st = S[a.t];
      y += st.before;
      const runs = a.lead ? [{s:a.lead, font:"bold"}, {s:a.s, font:"normal"}]
                          : [{s:a.s, font:st.font}];
      const lines = kdpBreakRuns(doc, runs, width, st.size);
      for(const ln of lines){
        let x = box.x;
        for(const t of ln){
          doc.setFont(KDP_FONT_FAMILY, t.font); doc.setFontSize(st.size);
          if(t.space) x += doc.getTextWidth(" ");
          ctx.text(t.s, x, y + st.size*0.78, {});
          x += t.w;
        }
        y += st.size*st.lead;
      }
      y += st.after;
      continue;
    }

    if(a.t === "fhead"){
      doc.setTextColor(105,105,105);
      line("Cage", box.x, y + S.head.size*0.78, S.head);
      line("Total", box.x + a.cols[0], y + S.head.size*0.78, S.head);
      line(a.cont ? "Only combination (continued)" : "Only combination",
           box.x + a.cols[0] + a.cols[1], y + S.head.size*0.78, S.head);
      doc.setTextColor(0,0,0);
      y += a.h;
      continue;
    }
    if(a.t === "frow"){
      const b = y + S.row.size*0.78;
      line(a.f.cells + " cells", box.x, b, S.row);
      line(String(a.f.sum), box.x + a.cols[0], b, S.row, "bold");
      line(a.f.only, box.x + a.cols[0] + a.cols[1], b, S.row, "bold");
      y += a.h;
      continue;
    }
    if(a.t === "thead"){
      doc.setTextColor(105,105,105);
      line("Total", box.x, y + S.head.size*0.78, S.head);
      line("Ways", box.x + a.sumW, y + S.head.size*0.78, S.head);
      line(a.cont ? "Combinations (continued)" : "Combinations",
           box.x + a.sumW + a.waysW, y + S.head.size*0.78, S.head);
      doc.setTextColor(0,0,0);
      y += a.h;
      continue;
    }
    if(a.t === "trow"){
      const b = y + S.row.size*0.78;
      line(String(a.r.sum), box.x, b, S.row, "bold");
      doc.setTextColor(105,105,105);
      line(String(a.r.ways), box.x + a.sumW, b, S.row);
      doc.setTextColor(0,0,0);
      const listX = box.x + a.sumW + a.waysW;
      const step = (width - a.sumW - a.waysW) / a.perLine;
      for(let i=0;i<a.r.list.length;i++){
        const col = i % a.perLine, row = (i / a.perLine) | 0;
        line(a.r.list[i], listX + col*step, b + row*S.row.size*S.row.lead, S.row,
             a.r.ways === 1 ? "bold" : "normal");
      }
      y += a.h;
      continue;
    }
  }
}

function kdpFolio(ctx, box, n){
  const doc = ctx.doc;
  doc.setFont(KDP_FONT_FAMILY, "normal");
  doc.setFontSize(KDP_LAYOUT.folioPt);
  doc.setTextColor(0,0,0);
  const x = box.recto ? (box.x + box.w) : box.x;
  /* Held 1.5pt clear of the live-area edge: a folio sitting flush on the
     boundary reads as tight, and its descender box would touch the margin. */
  ctx.text(String(n), x, box.y + box.h - 1.5, {align: box.recto ? "right" : "left", baseline:"bottom"});
}

function kdpRunningHead(ctx, box, text){
  const doc = ctx.doc;
  doc.setFont(KDP_FONT_FAMILY, "normal");
  doc.setFontSize(KDP_LAYOUT.runHeadPt);
  doc.setTextColor(105,105,105);
  const x = box.recto ? (box.x + box.w) : box.x;
  ctx.text(text.toUpperCase(), x, box.y, {
    align: box.recto ? "right" : "left",
    baseline: "top",
    charSpace: KDP_LAYOUT.runHeadTrack
  });
  doc.setTextColor(0,0,0);
}

function kdpRenderPuzzlePage(ctx, plan, cfg, pg, box){
  const P = plan.preset, L = KDP_LAYOUT, doc = ctx.doc;
  const contentTop = box.y + L.runHeadPt + 6;
  const contentBot = box.y + box.h - L.footBlockPt;
  const slotH = (contentBot - contentTop) / P.puzzleRows;
  const strip = L.noteStripIn * KDP_IN;

  for(let k=0; k<pg.items.length; k++){
    const item = cfg.puzzles[pg.items[k]];
    const slotTop = contentTop + k*slotH;

    doc.setFont(KDP_FONT_FAMILY, "bold");
    doc.setFontSize(L.titlePt);
    doc.setTextColor(0,0,0);
    ctx.text(item.label, box.x, slotTop + L.titlePt*0.8, {});
    doc.setFont(KDP_FONT_FAMILY, "normal");
    doc.setFontSize(L.titlePt - 1.5);
    doc.setTextColor(90,90,90);
    ctx.text(item.diffLabel, box.x + box.w, slotTop + L.titlePt*0.8, {align:"right"});
    doc.setTextColor(0,0,0);

    const gTop = slotTop + L.titlePt + 8;
    const gH   = slotH - (L.titlePt + 8);
    const needCages = item.P.kind === "killer";
    const fit = kdpFitGrid(box.w, gH, strip, {given:true, cages:needCages});
    if(!fit.ok) return fit;

    const gx = box.x + (box.w - fit.grid)/2;
    const slack = Math.max(0, gH - fit.grid - fit.reserve);
    const gy = gTop + slack/3;
    kdpDrawGrid(ctx, item.P, gx, gy, fit.grid, {withSol:false, cages:true, tints:true});
  }
  return {ok:true};
}

function kdpRenderSolutionPage(ctx, plan, cfg, pg, box){
  const P = plan.preset, L = KDP_LAYOUT, doc = ctx.doc;
  const contentTop = box.y;
  const contentBot = box.y + box.h - L.footBlockPt;
  const cols = P.solCols, rows = P.solRows;
  const cw = (box.w - L.solColGapPt*(cols-1)) / cols;
  const ch = ((contentBot - contentTop) - L.solRowGapPt*(rows-1)) / rows;
  const labelBlock = L.solLabelPt + 5;

  for(let k=0; k<pg.items.length; k++){
    const item = cfg.puzzles[pg.items[k]];
    const col = k % cols, row = (k / cols) | 0;
    const sx = box.x + col*(cw + L.solColGapPt);
    const sy = contentTop + row*(ch + L.solRowGapPt);

    const fit = kdpFitGrid(cw, ch - labelBlock, 0, {given:true, sol:true});
    if(!fit.ok) return fit;
    const gx = sx + (cw - fit.grid)/2;

    doc.setFont(KDP_FONT_FAMILY, "bold");
    doc.setFontSize(L.solLabelPt);
    doc.setTextColor(0,0,0);
    ctx.text(item.solLabel, gx, sy + L.solLabelPt*0.8, {});

    kdpDrawGrid(ctx, item.P, gx, sy + labelBlock, fit.grid,
                {withSol:true, cages:false, tints:true});
  }
  return {ok:true};
}

function kdpRenderPage(ctx, plan, cfg, pg, index){
  const pageNo = index + 1;
  const box = kdpLiveArea(plan.preset, pageNo, plan.gutterIn);
  const doc = ctx.doc, L = KDP_LAYOUT, F = cfg.front;
  ctx.page = pageNo;
  let res = {ok:true};

  if(pg.kind === "halftitle"){
    /* Company, then book, then volume — one line each, in that order, for
       every book. The imprint is set small and letterspaced above the title so
       it reads as the publisher rather than as the first word of it. */
    doc.setTextColor(0,0,0);
    let y = box.y + box.h*0.28;
    if(F.imprint){
      doc.setFont(KDP_FONT_FAMILY,"bold"); doc.setFontSize(10);
      doc.setTextColor(105,105,105);
      kdpTracked(ctx, F.imprint.toUpperCase(), box.x + box.w/2, y, 1.5);
      doc.setTextColor(0,0,0);
      y += 10*2.4;
    }
    const t = kdpBreakRuns(doc, [{s:F.bookName || F.title, font:"bold"}], box.w, 21);
    for(const line of t){
      let tw = 0; doc.setFont(KDP_FONT_FAMILY,"bold"); doc.setFontSize(21);
      for(const w of line) tw += w.w + (w.space ? doc.getTextWidth(" ") : 0);
      let x = box.x + (box.w - tw)/2;
      for(const w of line){ if(w.space) x += doc.getTextWidth(" "); ctx.text(w.s, x, y, {}); x += w.w; }
      y += 21*1.22;
    }
    if(F.volume){
      y += 6;
      doc.setFont(KDP_FONT_FAMILY,"normal"); doc.setFontSize(13);
      ctx.text(F.volume, box.x + box.w/2, y, {align:"center"});
      y += 13*1.22;
    }
    if(F.subtitle){
      y += 10;
      doc.setFont(KDP_FONT_FAMILY,"normal"); doc.setFontSize(10); doc.setTextColor(90,90,90);
      ctx.text(F.subtitle, box.x + box.w/2, y, {align:"center"});
      doc.setTextColor(0,0,0);
    }
  }

  else if(pg.kind === "contents"){
    let y = kdpFlow(ctx, [{t:"h1", s:"Contents"}], box, box.y + 14);
    const rows = kdpContents(plan, cfg);
    const size = 10, lh = size*1.95;
    doc.setFont(KDP_FONT_FAMILY,"normal"); doc.setFontSize(size); doc.setTextColor(0,0,0);
    for(const r of rows){
      const base = y + size*0.78;
      const num = String(r.page), numW = doc.getTextWidth(num);
      ctx.text(r.label, box.x, base, {});
      ctx.text(num, box.x + box.w, base, {align:"right"});
      /* Dot leaders, held 5pt clear of the type at each end so nothing on this
         page is closer to anything else than the rest of the book allows. */
      const from = box.x + doc.getTextWidth(r.label) + 5;
      const to   = box.x + box.w - numW - 5;
      if(to - from > 6){
        doc.setDrawColor(140);
        doc.setLineWidth(0.6);
        doc.setLineDashPattern([0.6, 3.2], 0);
        ctx.line(from, base - size*0.22, to, base - size*0.22);
        doc.setLineDashPattern([], 0);
        doc.setDrawColor(0);
      }
      y += lh;
    }
  }

  else if(pg.kind === "combos"){
    kdpRenderCombosPage(ctx, plan, box, pg.part);
  }

  else if(pg.kind === "playmore" || pg.kind === "backpage"){
    const back = pg.kind === "backpage";
    let y = box.y + box.h*(back ? 0.16 : 0.14);
    doc.setFont(KDP_FONT_FAMILY,"bold"); doc.setFontSize(17); doc.setTextColor(0,0,0);
    ctx.text(back ? "Keep playing, free" : "1.7 million more puzzles, free",
             box.x + box.w/2, y, {align:"center"});
    y += 17*1.24 + 10;

    const intro = back
      ? "Thank you for playing. Every puzzle in this book was made and checked the same way as the whole free archive on the site, where there is a fresh daily challenge waiting."
      : "Scan the code, or type the address underneath it. Killer, classic, Sudoku X and Hyper, four daily challenges, a solutions archive and the guides — no charge, no account needed.";
    y = kdpFlow(ctx, [{t:"p", s:intro}], box, y, "center");

    const qr = Math.min(box.w*0.52, 150);
    y += 12;
    kdpDrawQR(ctx, box.x + (box.w - qr)/2, y, qr);
    y += qr + 20;

    doc.setFont(KDP_FONT_FAMILY,"bold"); doc.setFontSize(13); doc.setTextColor(0,0,0);
    ctx.text(F.site, box.x + box.w/2, y, {align:"center"});
    y += 13*1.24 + 12;

    const tail = back
      ? [{t:"p", s:"If this book was good company, a short review helps another solver find it — and tells us which volume to print next."},
         {t:"p", s:"More volumes in this series are listed on the previous page."}]
      : [{t:"p", s:F.guides}];
    kdpFlow(ctx, tail, box, y, "center");
  }

  else if(pg.kind === "copyright"){
    const blocks = [];
    blocks.push({t:"small", s:F.title});
    for(const line of F.copyright) blocks.push({t:"small", s:line});
    /* The edition and seed range used to print here. They identify a reprint,
       but they are production detail and a reader has no use for them, so they
       live in the PDF metadata now and nowhere on the page. */
    if(F.isbn) blocks.push({t:"small", s:"ISBN "+F.isbn});
    blocks.push({t:"small", s:F.site});
    /* The imprint mark goes bottom-right of the copyright block. It is an
       opaque image, not a transparent one — a print interior is black ink on
       white paper and a transparent PNG is a colour-management argument nobody
       needs — so the block is moved up to leave it clear space. Set beside the
       text instead, its white ground rubbed out the end of a line. */
    const mark = cfg.assets && cfg.assets.imprint;
    const mw = mark ? Math.min(box.w*0.22, 120) : 0;
    const mh = mark ? mw * (cfg.assets.imprintH / cfg.assets.imprintW) : 0;
    /* Copyright pages sit low on the page by convention. */
    const h = 8*1.42*18 + (mark ? mh + 12 : 0);
    const endY = kdpFlow(ctx, blocks, box, Math.max(box.y, box.y + box.h - h));
    if(mark){
      const my = Math.min(endY + 12, box.y + box.h - mh);
      ctx.image(mark, box.x + box.w - mw, my, mw, mh, "zaney-imprint");
    }
  }

  else if(pg.kind === "howto"){
    kdpFlow(ctx, F.howto[pg.part-1], box, box.y + 14);
  }

  else if(pg.kind === "about"){
    kdpFlow(ctx, F.about, box, box.y + 14);
  }

  else if(pg.kind === "divider"){
    doc.setFont(KDP_FONT_FAMILY,"bold"); doc.setFontSize(24); doc.setTextColor(0,0,0);
    ctx.text("Solutions", box.x + box.w/2, box.y + box.h*0.34, {align:"center"});
    doc.setFont(KDP_FONT_FAMILY,"normal"); doc.setFontSize(9); doc.setTextColor(105,105,105);
    ctx.text("Puzzle "+1+" to "+cfg.puzzles.length, box.x + box.w/2, box.y + box.h*0.34 + 22, {align:"center"});
    doc.setTextColor(0,0,0);
  }

  else if(pg.kind === "series"){
    const blocks = [{t:"h1", s:"Also in the Zaney Sudoku series"}];
    const others = cfg.seriesList || [];
    if(others.length) for(const o of others) blocks.push({t:"li", s:o});
    else blocks.push({t:"p", s:"More volumes are on the way."});
    blocks.push({t:"p", s:"Every volume is a different set of puzzles. No puzzle appears in two books."});
    blocks.push({t:"p", s:"Play free at "+F.site+" — 1.7 million puzzles across killer, classic, Sudoku X and Hyper, plus four daily challenges."});
    kdpFlow(ctx, blocks, box, box.y + 14);
  }

  else if(pg.kind === "puzzles"){
    const first = cfg.puzzles[pg.items[0]];
    kdpRunningHead(ctx, box, (first && first.runHead) || cfg.runningHead);
    res = kdpRenderPuzzlePage(ctx, plan, cfg, pg, box);
  }

  else if(pg.kind === "solutions"){
    res = kdpRenderSolutionPage(ctx, plan, cfg, pg, box);
  }

  /* pg.kind === "blank" draws nothing, deliberately. */

  if(pg.folio && res.ok) kdpFolio(ctx, box, pageNo);
  return res;
}

/* Every string that will be typeset, gathered so it can be checked against the
   embedded subset before anything is composed. */
function kdpCollectText(cfg){
  const out = [cfg.front.title, cfg.front.subtitle, cfg.front.author,
               cfg.front.imprint, (cfg.front.imprint||"").toUpperCase(),
               cfg.front.bookName, cfg.front.volume,
               cfg.front.isbn, cfg.front.site, cfg.runningHead,
               "1.7 million more puzzles, free", "Keep playing, free",
               "Scan the code, or type the address underneath it. Killer, classic, Sudoku X and Hyper, four daily challenges, a solutions archive and the guides — no charge, no account needed.",
               "Thank you for playing. Every puzzle in this book was made and checked the same way as the whole free archive on the site, where there is a fresh daily challenge waiting.",
               "If this book was good company, a short review helps another solver find it — and tells us which volume to print next.",
               "More volumes in this series are listed on the previous page.",
               "Contents", "Solutions", "Puzzles ", "0123456789", cfg.front.guides];
  for(const b of (cfg.bands||[])){
    if(b.difficulty && typeof DIFF_LABEL !== "undefined" && DIFF_LABEL[b.difficulty])
      out.push(DIFF_LABEL[b.difficulty] + " — puzzles ");
    if(b.mode && KDP_MODE_NAME[b.mode]) out.push(KDP_MODE_NAME[b.mode] + " · ");
  }
  for(const line of cfg.front.copyright||[]) out.push(line);
  const blocks = [].concat.apply([], (cfg.front.howto||[])).concat(cfg.front.about||[]);
  for(const b of blocks){ if(b.s) out.push(b.s); if(b.lead) out.push(b.lead); }
  for(const t of cfg.seriesList||[]) out.push(t);
  if(cfg.puzzles && cfg.puzzles.length){
    out.push(cfg.puzzles[0].label, cfg.puzzles[0].solLabel, cfg.puzzles[0].diffLabel);
    out.push(cfg.puzzles[cfg.puzzles.length-1].label);
  }
  out.push("Solutions", "Puzzle", "0123456789");
  return out.filter(Boolean);
}

/* jsPDF draws nothing at all for a glyph the embedded font lacks — no box, no
   fallback, just a hole. fonts/inter.woff2 is a web subset (206 codepoints), so
   this is easy to hit with ordinary typography like a bullet or a euro sign.
   Checked before composing so it fails loudly instead of shipping. */
function kdpUnsupportedChars(cfg, charset){
  if(!charset) return [];
  const have = {};
  for(const ch of charset) have[ch] = true;
  const bad = {};
  for(const s of kdpCollectText(cfg))
    for(const ch of String(s))
      if(ch !== "\n" && ch !== "\t" && !have[ch]) bad[ch] = (bad[ch]||0) + 1;
  return Object.keys(bad).map(function(ch){
    return {ch: ch, code: "U+" + ("0000"+ch.charCodeAt(0).toString(16).toUpperCase()).slice(-4), count: bad[ch]};
  });
}

/* ---------------------------------------------------------------------------
   Seed ledger. Two paths, and the exporter says out loud which one it is on
   before a single puzzle is dealt.
--------------------------------------------------------------------------- */
function kdpLedgerCheck(books, bookId){
  const b = books[bookId];
  if(!b) throw new Error("No entry '"+bookId+"' in books.json");
  for(const f of ["title","mode","difficulty","preset","seedStart","seedEnd","puzzleCount"])
    if(b[f] === undefined || b[f] === null)
      throw new Error("books.json entry '"+bookId+"' is missing required field '"+f+"'");
  if(b.seedEnd < b.seedStart)
    throw new Error("'"+bookId+"' has seedEnd before seedStart");
  if(b.bands && b.bands.length){
    for(const band of b.bands){
      if(!(band.count > 0))
        throw new Error("'"+bookId+"' has a difficulty band with no puzzles in it.");
      /* Each band is checked against its own variation's levels, because a
         variety book can hold a Coward's classic band next to a killer one. */
      const bm = band.mode || b.mode;
      const valid = kdpValidDifficulties(bm);
      if(valid.indexOf(band.difficulty) < 0)
        throw new Error("'"+bookId+"' has a '"+band.difficulty+"' band, which "+
          (KDP_MODE_NAME[bm]||bm)+" does not have. Its levels are: "+valid.join(", ")+".");
    }
    const bt = kdpBandTotal(b.bands);
    if(bt !== b.puzzleCount)
      throw new Error("'"+bookId+"' has difficulty bands totalling "+bt+" puzzles but declares "+
                      b.puzzleCount+". They have to agree.");
  }
  const span = b.seedEnd - b.seedStart + 1;
  if(span !== b.puzzleCount)
    throw new Error("'"+bookId+"' declares puzzleCount "+b.puzzleCount+" but its seed range "+
                    b.seedStart+"–"+b.seedEnd+" holds "+span+" seeds. Fix books.json.");
  if(!KDP_PRESETS[kdpResolvePreset(b.preset)])
    throw new Error("'"+bookId+"' names unknown preset '"+b.preset+"'");

  const overlaps = [];
  for(const k in books){
    if(!Object.prototype.hasOwnProperty.call(books,k) || k === bookId) continue;
    const o = books[k];
    if(o.seedStart === undefined || o.seedEnd === undefined) continue;
    if(o.altEditionOf === bookId) continue;   /* a declared alt edition of THIS book */
    if(b.seedStart <= o.seedEnd && o.seedStart <= b.seedEnd) overlaps.push(k);
  }

  if(b.altEditionOf){
    const base = books[b.altEditionOf];
    if(!base) throw new Error("'"+bookId+"' declares altEditionOf '"+b.altEditionOf+"', which is not in books.json");
    if(base.altEditionOf) throw new Error("'"+bookId+"' is an alt edition of '"+b.altEditionOf+"', which is itself an alt edition. Point it at the original.");
    if(b.seedStart !== base.seedStart || b.seedEnd !== base.seedEnd)
      throw new Error("'"+bookId+"' is an alt edition of '"+b.altEditionOf+"' but does not reuse its exact seed range ("+
                      base.seedStart+"–"+base.seedEnd+"). An alt edition must be the same puzzles.");
    if(kdpResolvePreset(b.preset) === kdpResolvePreset(base.preset))
      throw new Error("'"+bookId+"' is an alt edition of '"+b.altEditionOf+"' under the SAME preset ("+b.preset+"). "+
                      "That is a duplicate book, not a large-print edition.");
    if(b.mode !== base.mode || b.difficulty !== base.difficulty)
      throw new Error("'"+bookId+"' is an alt edition of '"+b.altEditionOf+"' but changes mode/difficulty. That is a different book.");
    /* The base edition may share this range, and so may any sibling that is
       also an alt edition of the same book — a title can legitimately exist as
       large print AND a compact. Each of those has to be a distinct format. */
    const siblings = overlaps.filter(function(k){
      return k !== b.altEditionOf && books[k].altEditionOf === b.altEditionOf;
    });
    for(const k of siblings){
      if(kdpResolvePreset(books[k].preset) === kdpResolvePreset(b.preset))
        throw new Error("'"+bookId+"' and '"+k+"' are both alt editions of '"+b.altEditionOf+
          "' under the SAME preset ("+b.preset+"). Two editions of one title have to be different formats.");
    }
    const strays = overlaps.filter(function(k){
      return k !== b.altEditionOf && books[k].altEditionOf !== b.altEditionOf;
    });
    if(strays.length)
      throw new Error("'"+bookId+"' overlaps "+strays.join(", ")+" as well as its base edition. "+
        "Only the base and its other editions may share this range.");
    return {
      path: "altEdition",
      of: b.altEditionOf,
      message: "ALT EDITION PATH. '"+bookId+"' deliberately reuses the exact seed range of '"+b.altEditionOf+
               "' ("+b.seedStart+"–"+b.seedEnd+") under preset "+b.preset+" instead of "+base.preset+
               ". These are the same puzzles in a different format, which is the one case where a repeat is intended."
    };
  }

  if(overlaps.length)
    throw new Error("REFUSING TO EXPORT. '"+bookId+"' (seeds "+b.seedStart+"–"+b.seedEnd+
      ") overlaps "+overlaps.map(function(k){ return "'"+k+"' ("+books[k].seedStart+"–"+books[k].seedEnd+")"; }).join(" and ")+
      ". Duplicate puzzles across your own catalogue get flagged by Amazon and noticed by reviewers. "+
      "Either move this range or declare \"altEditionOf\" if this really is a second format of the same book.");

  return {
    path: "unique",
    message: "UNIQUE RANGE PATH. '"+bookId+"' claims seeds "+b.seedStart+"–"+b.seedEnd+
             " ("+b.puzzleCount+" puzzles). Checked against "+(Object.keys(books).length-1)+
             " other ledger entries — no overlap."
  };
}

function kdpSeriesList(books, bookId){
  const out = [];
  for(const k in books){
    if(!Object.prototype.hasOwnProperty.call(books,k) || k === bookId) continue;
    const o = books[k], p = KDP_PRESETS[kdpResolvePreset(o.preset)];
    const name = [o.title, o.volume].filter(Boolean).join(" ");
    out.push(name + (o.altEditionOf && p ? " — " + p.name : "") +
             (o.puzzleCount ? " · " + o.puzzleCount + " puzzles" : ""));
  }
  return out.sort();
}

/* ---------------------------------------------------------------------------
   Deterministic PDF post-pass.

   Three things jsPDF does that KDP will not forgive, and one that breaks
   reprints. All four fixes are LENGTH-PRESERVING — replaced spans are padded
   with spaces — so the xref offsets stay valid and the file needs no
   reserialisation.

     1. jsPDF writes all fourteen base-14 Type1 fonts (Helvetica, Courier,
        Times, Symbol, ZapfDingbats) into every document and lists them in the
        shared /Resources, used or not. They carry no FontFile, so a preflight
        check sees fourteen non-embedded fonts however carefully you embed your
        own. The objects are nulled and their /Resources entries removed.
     2. /MediaBox comes out as 364.3199999999999932 rather than 364.32.
     3. jsPDF stamps a random /ID, so two runs of identical input produce
        different bytes. Replaced with a hash of the book identity.
     4. /CreationDate is pinned to a constant, not today, for the same reason.
--------------------------------------------------------------------------- */
const KDP_FIXED_EPOCH = Date.UTC(2020, 0, 1, 0, 0, 0);

const KDP_BASE14 = ["Helvetica","Helvetica-Bold","Helvetica-Oblique","Helvetica-BoldOblique",
  "Courier","Courier-Bold","Courier-Oblique","Courier-BoldOblique",
  "Times-Roman","Times-Bold","Times-Italic","Times-BoldItalic","ZapfDingbats","Symbol"];

function kdpHashHex(str){
  let out = "";
  for(let k=0;k<4;k++){
    let h = (2166136261 ^ Math.imul(k+1, 0x9E3779B9)) >>> 0;
    for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    out += ("00000000" + h.toString(16)).slice(-8);
  }
  return out.toUpperCase();
}

function kdpPad(replacement, originalLength){
  if(replacement.length > originalLength)
    throw new Error("kdpFixup: replacement longer than the span it replaces");
  return replacement + new Array(originalLength - replacement.length + 1).join(" ");
}

function kdpFixup(bytes, opts){
  let s = "";
  const CH = 8192;
  for(let i=0;i<bytes.length;i+=CH)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i+CH));
  const before = s.length;
  const report = {stripped:[], mediaBoxes:0, id:null};

  /* 1a. null out the base-14 font objects */
  const objRe = /(\d+) 0 obj\r?\n(<<\r?\n\/Type \/Font\r?\n\/BaseFont \/([A-Za-z-]+)\r?\n\/Subtype \/Type1[\s\S]{0,200}?>>)\r?\nendobj/g;
  s = s.replace(objRe, function(whole, num, dict, base){
    if(KDP_BASE14.indexOf(base) < 0) return whole;
    report.stripped.push(parseInt(num,10));
    return whole.replace(dict, kdpPad("null", dict.length));
  });

  /* 1b. drop their names from the shared /Resources /Font dictionary */
  if(report.stripped.length){
    const refRe = /\/F\d+ (\d+) 0 R/g;
    s = s.replace(refRe, function(whole, num){
      return report.stripped.indexOf(parseInt(num,10)) >= 0 ? kdpPad("", whole.length) : whole;
    });
  }

  /* 2. exact MediaBox */
  if(opts && opts.trimPt){
    const want = "[0 0 " + kdpNum(opts.trimPt[0]) + " " + kdpNum(opts.trimPt[1]) + "]";
    s = s.replace(/\/MediaBox (\[[^\]]*\])/g, function(whole, box){
      report.mediaBoxes++;
      return whole.replace(box, kdpPad(want, box.length));
    });
  }

  /* 3. deterministic /ID */
  if(opts && opts.seed){
    const hex = kdpHashHex(opts.seed);
    s = s.replace(/\/ID \[ <([0-9A-Fa-f]+)> <([0-9A-Fa-f]+)> \]/g, function(whole, a){
      report.id = hex.slice(0, a.length);
      return whole.split(a).join(report.id);
    });
  }

  if(s.length !== before)
    throw new Error("kdpFixup: byte length changed ("+before+" → "+s.length+"); xref would be invalid");

  const out = new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) out[i] = s.charCodeAt(i) & 0xFF;
  return {bytes: out, report: report};
}

function kdpNum(v){
  const r = Math.round(v*1000)/1000;
  return (Math.abs(r - Math.round(r)) < 1e-9) ? String(Math.round(r)) : String(r);
}

/* ---------------------------------------------------------------------------
   Assembly
--------------------------------------------------------------------------- */
function kdpRegisterFonts(doc, fonts){
  if(!fonts || !fonts.regular || !fonts.bold)
    throw new Error("KDP_FONTS not loaded — the interior needs real embedded fonts, "+
                    "and jsPDF's built-in Helvetica is not one.");
  doc.addFileToVFS("Inter-kdp-regular.ttf", fonts.regular);
  doc.addFont("Inter-kdp-regular.ttf", KDP_FONT_FAMILY, "normal");
  doc.addFileToVFS("Inter-kdp-bold.ttf", fonts.bold);
  doc.addFont("Inter-kdp-bold.ttf", KDP_FONT_FAMILY, "bold");
  doc.setFont(KDP_FONT_FAMILY, "normal");
}

/* ---------------------------------------------------------------------------
   Cover template.

   A single page at the exact full-cover size with the trim, spine, safe areas
   and the barcode keep-out drawn on it, to drop into Canva as an underlay so
   the artwork lines up first time instead of after a rejection.
--------------------------------------------------------------------------- */
function kdpBuildCoverTemplate(jsPDFctor, fonts, spec, meta){
  meta = meta || {};
  const IN = KDP_IN;
  const W = spec.fullIn[0]*IN, H = spec.fullIn[1]*IN;
  const doc = new jsPDFctor({orientation: W >= H ? "landscape" : "portrait",
                             unit:"pt", format:[W, H], compress:true});
  kdpRegisterFonts(doc, fonts);

  const bleed = spec.bleedIn*IN;
  const tw = spec.trimIn[0]*IN, th = spec.trimIn[1]*IN;
  const spine = spec.spineIn*IN;
  const safe = spec.safeMarginIn*IN;
  const spineX = spec.spineFromLeftIn*IN;
  const frontX = spec.frontFromLeftIn*IN;

  const label = function(text, x, y, size, grey, align){
    doc.setFont(KDP_FONT_FAMILY,"normal");
    doc.setFontSize(size);
    doc.setTextColor(grey, grey, grey);
    doc.text(text, x, y, align ? {align: align} : undefined);
  };

  /* everything outside the trim is bleed and will be cut off */
  doc.setFillColor(246,238,238);
  doc.rect(0, 0, W, bleed, "F");
  doc.rect(0, H-bleed, W, bleed, "F");
  doc.rect(0, 0, bleed, H, "F");
  doc.rect(W-bleed, 0, bleed, H, "F");

  /* trim */
  doc.setDrawColor(150,60,60);
  doc.setLineWidth(0.75);
  doc.setLineDashPattern([4,3],0);
  doc.rect(bleed, bleed, W-2*bleed, H-2*bleed);
  doc.setLineDashPattern([],0);

  /* spine */
  doc.setDrawColor(40,90,160);
  doc.setLineWidth(1);
  doc.line(spineX, 0, spineX, H);
  doc.line(frontX, 0, frontX, H);

  /* safe areas, one per panel */
  doc.setDrawColor(120,160,120);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2,3],0);
  doc.rect(bleed+safe, bleed+safe, tw-2*safe, th-2*safe);
  doc.rect(frontX+safe, bleed+safe, tw-2*safe, th-2*safe);
  doc.setLineDashPattern([],0);

  /* barcode keep-out, on the back cover */
  const bx = spec.barcode.fromLeftIn*IN;
  const by = H - (spec.barcode.fromBottomIn*IN) - (spec.barcode.hIn*IN);
  doc.setFillColor(232,232,236);
  doc.rect(bx, by, spec.barcode.wIn*IN, spec.barcode.hIn*IN, "F");
  label("BARCODE — keep clear", bx + (spec.barcode.wIn*IN)/2, by + (spec.barcode.hIn*IN)/2, 8, 110, "center");

  /* panel names */
  label("BACK COVER", bleed + tw/2, bleed + 26, 13, 150, "center");
  label("FRONT COVER", frontX + tw/2, bleed + 26, 13, 150, "center");
  if(spine > 16){
    doc.setFont(KDP_FONT_FAMILY,"normal");
    doc.setFontSize(9);
    doc.setTextColor(150,150,150);
    doc.text("SPINE", spineX + spine/2 + 3.5, H/2 + 18, {angle: 90});
  }

  /* the numbers, along the bottom inside the back cover's safe area */
  const lines = [
    (meta.title || "Cover template") + (meta.bookId ? "  ·  " + meta.bookId : ""),
    spec.pages + " pages  ·  " + spec.paper + " paper  ·  trim " + spec.trimIn[0] + " × " + spec.trimIn[1] + " in",
    "Full cover " + spec.fullIn[0].toFixed(3) + " × " + spec.fullIn[1].toFixed(3) + " in" +
      "  (" + spec.fullCm[0].toFixed(2) + " × " + spec.fullCm[1].toFixed(2) + " cm" +
      "  ·  " + spec.fullPx300[0] + " × " + spec.fullPx300[1] + " px at 300dpi)",
    "Spine " + spec.spineIn.toFixed(4) + " in / " + spec.spineCm.toFixed(2) + " cm" +
      (spec.spineTextAllowed
        ? "  ·  spine text allowed, keep it within " + spec.spineTextSafeIn.toFixed(3) + " in"
        : "  ·  NO spine text: KDP needs " + spec.spineTextMinPages + "+ pages"),
    "Red dashes = trim, cut line.  Green dots = safe area, keep text inside.  Blue = spine folds.  Pink = bleed, gets cut off.",
    "Check against kdp.amazon.com/cover-calculator at title setup."
  ];
  let y = bleed + safe + 42;
  for(const t of lines){
    label(t, bleed + safe + 4, y, 8, 110);
    y += 11;
  }

  doc.setProperties({
    title: (meta.title || "Cover template") + " — cover",
    subject: (meta.bookId || "") + " · full cover " + spec.fullIn[0].toFixed(3) + "x" + spec.fullIn[1].toFixed(3) +
             "in · spine " + spec.spineIn.toFixed(4) + "in · " + spec.pages + "pp " + spec.paper,
    creator: "Zaney Books cover template"
  });
  doc.setCreationDate(new Date(KDP_FIXED_EPOCH));
  const raw = new Uint8Array(doc.output("arraybuffer"));
  return kdpFixup(raw, {
    trimPt: [W, H],
    seed: ["cover", meta.bookId||"", spec.pages, spec.paper, spec.fullIn.join("x")].join("|")
  });
}

function kdpAbortMessage(plan, cfg, fit, where){
  return "EXPORT ABORTED — unreadable at this size.\n\n"+
    "Preset "+plan.presetId+" (\""+plan.preset.name+"\", "+plan.preset.trimIn[0]+"×"+plan.preset.trimIn[1]+" in) "+
    "combined with "+(KDP_MODE_NAME[cfg.mode]||cfg.mode)+" puts type in the "+where+" at "+
    fit.smallest.toFixed(2)+"pt, below the "+KDP_LAYOUT.minTypePt+"pt legibility floor. "+
    "The grid is already filling the live area, so there is nothing left to reclaim.\n\n"+
    "This preset/mode combination does not work. Use a larger trim (preset B or C) for "+
    (KDP_MODE_NAME[cfg.mode]||cfg.mode)+", or fewer puzzles per page.";
}

/* Build the measurer the planner needs, from the very jsPDF and font the book
   will be printed with. One throwaway document, made once. */
function kdpInstallMeasure(jsPDFctor, fonts){
  const doc = new jsPDFctor({unit:"pt", format:[600,800]});
  kdpRegisterFonts(doc, fonts);
  kdpSetMeasure(function(str, pt, weight){
    doc.setFont(KDP_FONT_FAMILY, weight || "normal");
    doc.setFontSize(pt);
    return doc.getTextWidth(str);
  });
}

function kdpMakeDoc(jsPDFctor, plan){
  const t = kdpTrimPt(plan.preset);
  return new jsPDFctor({unit:"pt", format:[t[0], t[1]], compress:true});
}

/* Returns a driver the caller steps through, so the browser can chunk it
   between frames and Node can just run it to completion. */
function kdpAssembler(jsPDFctor, fonts, plan, cfg, pageLimit){
  /* The plan reserved KDP_FRONT.howtoPages pages before it knew which mode this
     is. If the copy for this mode is a different length, one page would silently
     print blank or one section would silently vanish. */
  const howtoPages = plan.pages.filter(function(g){ return g.kind === "howto"; }).length;
  if((cfg.front.howto || []).length !== howtoPages)
    throw new Error("EXPORT ABORTED — the plan reserved "+howtoPages+" how-to-play page(s) "+
      "but the copy for mode '"+cfg.mode+"' is "+(cfg.front.howto||[]).length+" page(s). "+
      "KDP_FRONT.howtoPages and KDP_HOWTO must agree.");
  const missing = kdpUnsupportedChars(cfg, fonts.charset);
  if(missing.length)
    throw new Error("EXPORT ABORTED — the embedded font cannot render "+
      missing.map(function(m){ return "'"+m.ch+"' ("+m.code+", used "+m.count+"×)"; }).join(", ")+
      ".\n\nfonts/inter.woff2 is the site's web subset and does not contain these. "+
      "jsPDF renders a missing glyph as nothing at all, so this would have printed as a gap. "+
      "Either reword the text, or replace fonts/inter.woff2 with a fuller Inter and re-run "+
      "tools/build-kdp-fonts.py.");
  const doc = kdpMakeDoc(jsPDFctor, plan);
  kdpRegisterFonts(doc, fonts);
  const ctx = kdpCtx(doc, cfg.trace);
  const total = Math.min(pageLimit || plan.pages.length, plan.pages.length);
  const trim = kdpTrimPt(plan.preset);
  let i = 0;
  return {
    doc: doc, ctx: ctx, total: total,
    done: function(){ return i >= total; },
    progress: function(){ return i; },
    step: function(n){
      const end = Math.min(i + (n||1), total);
      for(; i<end; i++){
        if(i > 0) doc.addPage([trim[0], trim[1]]);
        const r = kdpRenderPage(ctx, plan, cfg, plan.pages[i], i);
        if(!r.ok) throw new Error(kdpAbortMessage(plan, cfg, r,
          plan.pages[i].kind === "solutions" ? "solutions section" : "puzzle grids"));
      }
      return i;
    },
    finish: function(){
      doc.setProperties({
        title: cfg.front.title,
        subject: cfg.bookId+" · preset "+plan.presetId+" ("+plan.preset.name+") · seeds "+
                 cfg.seedStart+"–"+cfg.seedEnd+" · "+cfg.puzzleCount+" puzzles · "+plan.total+"pp",
        keywords: [cfg.bookId, "preset:"+plan.presetId, "trim:"+plan.preset.trimIn.join("x")+"in",
                   "seeds:"+cfg.seedStart+"-"+cfg.seedEnd, "puzzles:"+cfg.puzzleCount,
                   "pages:"+plan.total, "mode:"+cfg.mode, "difficulty:"+cfg.diff].join(", "),
        author: cfg.front.author,
        creator: "Zaney Sudoku KDP interior exporter"
      });
      /* Pinned, not today's date: same seeds + same preset must give the same
         bytes when this is reprinted years from now. */
      doc.setCreationDate(new Date(KDP_FIXED_EPOCH));
      const raw = new Uint8Array(doc.output("arraybuffer"));
      return kdpFixup(raw, {
        trimPt: trim,
        seed: [cfg.bookId, plan.presetId, cfg.seedStart, cfg.seedEnd,
               cfg.puzzleCount, plan.total, cfg.mode, cfg.diff].join("|")
      });
    }
  };
}
