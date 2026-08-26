# Zaney Books

Print-interior exporter for the Zaney Sudoku puzzle books on Amazon KDP.
Open it, pick or create a book, hit Export, upload the PDF to KDP.

Everything runs in the browser. Puzzles are dealt on your machine and the PDF is
built there; nothing is uploaded anywhere.

## Deploying

It is a plain static site. **No build step, no framework, no config files** —
that is deliberate, and it is why it deploys reliably:

1. Push this repo to GitHub.
2. Vercel → Add New → Project → import it.
3. Framework Preset **Other**. Leave Build Command, Output Directory and Install
   Command blank.
4. Deploy. The root URL is the tool.

There is no `vercel.json`, no `.vercelignore` and no `package.json` at the root.
Nothing can exclude your files or switch off deployments. `dev/` holds the test
tooling and has its own `package.json`; it is never needed at runtime.

Running it locally is the same site:

```
python3 -m http.server 8777      # then open http://localhost:8777/
```

`file://` will not work — the browser blocks the fetches the page needs.

## Making a book

**Library** lists your books. Click one to select it; the costs panel updates as
you go.

**+ New book** — title, puzzle type, trim size, how many puzzles fit on a page,
and the difficulty. A seed range clear of everything else is picked for you, and
the editor shows the page count and print cost before you save.

### Trim sizes

| size | category | notes |
|---|---|---|
| 5.06 × 7.81 in | REGULAR | the UK Su Doku title you are benchmarking |
| 5.83 × 8.27 in | REGULAR | A5, commuter size |
| 6 × 9 in | REGULAR | the popular middle ground — only just REGULAR, at the 6.12 × 9 limit |
| 8.5 × 11 in | LARGE | the usual puzzle-book size, and what large print wants |

Each pairs with **1 or 2 puzzles per page**, so there are eight formats. All
eight clear the 5 pt legibility floor; the tightest is 5.06 × 7.81 at two a page,
where solution digits land at 6.4 pt — legible, but small.

There is no 4 × 6 pocket size because KDP does not print one: their smallest
paperback trim is 5 × 8. A5 is the nearest thing.

Adding another size is one row in `KDP_TRIMS` in `core.js`. Nothing else changes.

### Books that get harder as they go

Pick **Gets harder as it goes** and set as many levels as you like — say 100
easy, 120 medium, 116 hard. The editor shows which puzzle numbers each level
covers and the running total.

The book then climbs: puzzle 1 is easy, puzzle 336 is hard. Every puzzle is
labelled with its level at the top of its page, the running head along the top
edge carries it too, and the front matter gets a page explaining the
arrangement so a reader knows where they are rather than thinking the book is
inconsistent.

Seeds stay one contiguous run — puzzle *i* is always seed `seedStart + i`. The
generator hashes difficulty into the seed, so the same seed at a different level
is a different puzzle, and the band split is part of the book's identity as much
as its range is.

### Same puzzles, different size

Under **Advanced**, "Same puzzles as" makes the new book a second edition of an
existing one: identical puzzles, different trim. Everything else must have a
seed range of its own — the exporter refuses to deal an overlapping one, because
repeated puzzles across your own catalogue get flagged by Amazon and noticed by
reviewers.

### Exporting

**Export PDF** deals the puzzles and builds the interior. Killer books are the
slow ones — 336 grids take a minute or two across the worker pool. Tick **proof
mode** to build only the first 24 pages when you just want to test a KDP upload.

Every interior contains, in order: half title, copyright, a two-page how-to-play
with the rules, a page about the difficulty, the puzzles with page numbers from
the first one, a Solutions divider on a right-hand page, every solution, and a
"more in the series" page.

## Where the library lives

The library is stored in your browser, so it survives reloads but is per-browser
and per-device. **Download books.json** writes it out; drop that in the repo root
and commit it, and it becomes the starting library everywhere. **Reset to file**
throws away local changes and reloads `books.json`.

`books.json` is deployed with the site, so anyone with the URL can read it —
seed ranges, unpublished titles, ASINs. `robots.txt` and a noindex meta tag keep
it out of search results, which is as far as a static host goes. Turn on
**Vercel Authentication** in Settings → Deployment Protection; on the Hobby plan
it covers preview URLs but not production, so don't post the link anywhere.

## What the exporter guarantees

* Page size is exactly the trim. No bleed, no crop marks, no oversized pages —
  all three get files rejected.
* The gutter alternates: wide margin on the left for odd pages, right for even.
* Every font is a real embedded subset. jsPDF writes fourteen unembedded base-14
  fonts into every document; a post-pass strips them, because a preflight check
  otherwise sees fourteen non-embedded fonts however carefully you embed yours.
* The solutions divider always lands on a right-hand page, and the total is
  always even.
* Type never drops below 5 pt. If a preset and mode combination cannot clear
  that, the export aborts and names it rather than shipping something unreadable.
* **Same seeds and same preset always produce the same bytes**, so a reprint
  years from now matches what is in the shops. `/CreationDate` is a constant,
  `/ID` is a hash of the book identity rather than jsPDF's random one, jsPDF is
  pinned at 2.5.1 in `vendor/`, and the font subset build has its timestamp
  pinned too.

## The puzzle engine

`engine.js` is the generator, copied verbatim out of `zaneysudoku/index.html`
and hash-locked in `engine.lock.json`. **Do not edit it here** — changing it
changes every puzzle in every book you have already printed. The page checks the
hash on load and refuses to export if it has been touched.

```
python3 dev/sync-engine.py --check --from ../zaneysudoku/index.html   # fails on drift
python3 dev/sync-engine.py       --from ../zaneysudoku/index.html   # re-vendor
```

## Tests

```
cd dev && npm install && npm test
```

135 checks: pagination and refusal guards, the page in jsdom, structural PDF
verification including a bounds check of every drawing call against the mirrored
live area, and the site's own solver run over a sample of printed puzzles.
Preset A takes a few minutes because 336 killer grids have to be dealt.

`node dev/kdp-browser-check.js` additionally drives the real page in Chromium and
asserts the downloaded PDF is byte-identical to the one Node builds. It needs
`npm i -D playwright` and a server running on 8777.
