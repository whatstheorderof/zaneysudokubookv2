#!/usr/bin/env python3
"""Structural verification of a generated KDP interior.

Reads <id>.pdf and <id>.marks.json from the output directory and asserts the
things KDP actually rejects files for. Every check prints PASS or FAIL; the
script exits non-zero if anything failed.

    python3 tools/kdp-verify.py /tmp/kdp-out ZS-003
"""
import json, os, subprocess, sys
from pypdf import PdfReader
from pypdf.generic import IndirectObject

PT = 72.0
HALF_STROKE = 0.55          # half the heaviest line weight used (1.1pt box border)

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  — " + detail) if detail else ""))
    return ok


def verify(outdir, book_id, render=True):
    pdf_path = os.path.join(outdir, book_id + ".pdf")
    meta = json.load(open(os.path.join(outdir, book_id + ".marks.json")))
    plan = meta["plan"]
    reader = PdfReader(pdf_path)

    print("\n=== %s — preset %s, %d pages predicted ===" % (book_id, plan["presetId"], plan["total"]))

    # ---- 2. page count: even, and exactly what the planner predicted --------
    n = len(reader.pages)
    check("page count matches the plan", n == plan["total"], "%d pages in the file, %d predicted" % (n, plan["total"]))
    check("page count is even", n % 2 == 0, "%d" % n)

    if meta.get("proof"):
        print("  (proof mode: first %d pages of a %d-page book — structural checks only)"
              % (meta["proof"], plan["fullTotal"]))
        check("proof interior is even, so KDP will accept the upload", n % 2 == 0, "%d pages" % n)
        check("proof interior meets KDP's 24-page minimum", n >= 24, "%d pages" % n)

    # ---- divider on a recto -------------------------------------------------
    kinds = plan["kinds"]
    div = [i + 1 for i, k in enumerate(kinds) if k == "divider"]
    if meta.get("proof") and not div:
        print("  NOTE  divider falls outside the proof range, as expected")
    else:
        check("exactly one solutions divider", len(div) == 1, "at page(s) %s" % div)
    if div:
        check("divider falls on a recto", div[0] % 2 == 1, "page %d" % div[0])
        check("divider verso is blank", kinds[div[0]] == "blank" if div[0] < len(kinds) else False)
    if div:
        check("divider page carries no folio", not plan["folios"][div[0] - 1])
    check("no blank page carries a folio",
          all(not plan["folios"][i] for i, k in enumerate(kinds) if k == "blank"))
    check("front matter is unnumbered", not any(plan["folios"][:6]))
    check("numbering starts at page 7", plan["folios"][6] is True)

    # ---- 3. MediaBox exactly the trim, and no crop/trim/bleed boxes ---------
    tw, th = plan["trimPt"]
    bad_mb, extra_boxes = [], []
    for i, page in enumerate(reader.pages):
        mb = page.mediabox
        vals = (float(mb.left), float(mb.bottom), float(mb.right), float(mb.top))
        if vals != (0.0, 0.0, round(tw, 6), round(th, 6)):
            if abs(vals[2] - tw) > 1e-9 or abs(vals[3] - th) > 1e-9 or vals[0] or vals[1]:
                bad_mb.append((i + 1, vals))
        for key in ("/CropBox", "/TrimBox", "/BleedBox", "/ArtBox"):
            if key in page:
                box = page[key]
                if isinstance(box, IndirectObject):
                    box = box.get_object()
                bx = tuple(float(v) for v in box)
                if bx != (0.0, 0.0, float(mb.right), float(mb.top)):
                    extra_boxes.append((i + 1, key, bx))
    check("every MediaBox is exactly %g x %g pt" % (tw, th), not bad_mb,
          ("first offender: %s" % (bad_mb[0],)) if bad_mb else "all %d pages" % n)
    check("no crop/trim/bleed box differs from the trim", not extra_boxes,
          ("%s" % (extra_boxes[:1],)) if extra_boxes else "no bleed, no crop marks")

    # ---- 4. every font embedded --------------------------------------------
    fonts, unembedded = [], []
    for obj in reader.resolved_objects.values() if hasattr(reader, "resolved_objects") else []:
        pass
    seen = set()
    def walk_fonts(res):
        f = res.get("/Font")
        if not f:
            return
        f = f.get_object()
        for name, ref in f.items():
            fd = ref.get_object()
            key = (str(ref.idnum) if isinstance(ref, IndirectObject) else name)
            if key in seen:
                continue
            seen.add(key)
            base = str(fd.get("/BaseFont", "?"))
            sub = str(fd.get("/Subtype", "?"))
            desc = fd.get("/FontDescriptor")
            if sub == "/Type0":
                dfs = fd.get("/DescendantFonts")
                if dfs:
                    desc = dfs.get_object()[0].get_object().get("/FontDescriptor")
            embedded = False
            if desc is not None:
                d = desc.get_object()
                embedded = any(k in d for k in ("/FontFile", "/FontFile2", "/FontFile3"))
            fonts.append((base, sub, embedded))
            if not embedded:
                unembedded.append((base, sub))
    for page in reader.pages:
        res = page.get("/Resources")
        if res:
            walk_fonts(res.get_object())
    check("all referenced fonts are embedded", not unembedded and len(fonts) > 0,
          "%d font(s): %s" % (len(fonts), ", ".join("%s %s" % (b, s) for b, s, _ in fonts))
          if not unembedded else "NOT embedded: %s" % unembedded)

    # raw scan: no base-14 font object may survive anywhere in the file
    raw = open(pdf_path, "rb").read()
    base14 = [b"/Helvetica", b"/Courier", b"/Times-Roman", b"/ZapfDingbats", b"/Symbol"]
    hits = [b.decode() for b in base14 if b + b"\n/Subtype /Type1" in raw or b + b"\r\n/Subtype /Type1" in raw]
    check("no base-14 Type1 font objects remain", not hits, "stripped %d" % len(meta["report"]["stripped"]) if not hits else "found %s" % hits)

    # ---- 5. no drawn content crosses into any margin ------------------------
    margin = meta["marginIn"] * PT
    gutter = plan["gutterIn"] * PT
    viol = []
    for m in meta["marks"]:
        p = m["page"]
        recto = (p % 2) == 1
        x0 = gutter if recto else margin
        y0 = margin
        x1 = tw - (margin if recto else gutter)
        y1 = th - margin
        # only stroked marks extend past their geometry, by half a line width
        pad = HALF_STROKE if m.get("s") else 0.0
        mx0, my0 = m["x"] - pad, m["y"] - pad
        mx1, my1 = m["x"] + m["w"] + pad, m["y"] + m["h"] + pad
        if mx0 < x0 - 1e-6 or my0 < y0 - 1e-6 or mx1 > x1 + 1e-6 or my1 > y1 + 1e-6:
            viol.append((p, "recto" if recto else "verso",
                         round(mx0, 2), round(my0, 2), round(mx1, 2), round(my1, 2),
                         "live=[%.2f,%.2f,%.2f,%.2f]" % (x0, y0, x1, y1)))
    check("no drawn mark crosses into a margin", not viol,
          "%d marks checked across %d pages" % (len(meta["marks"]), n) if not viol
          else "%d violations, first: %s" % (len(viol), viol[0]))

    # the mirroring itself: each side's content must sit against ITS OWN limits
    body = [m for m in meta["marks"] if m["page"] >= 7]
    odd_x0 = min((m["x"] for m in body if m["page"] % 2 == 1), default=None)
    even_x0 = min((m["x"] for m in body if m["page"] % 2 == 0), default=None)
    odd_x1 = max((m["x"] + m["w"] for m in body if m["page"] % 2 == 1), default=None)
    even_x1 = max((m["x"] + m["w"] for m in body if m["page"] % 2 == 0), default=None)
    check("recto content starts at the gutter, verso at the outer margin",
          abs(odd_x0 - gutter) < 1.2 and abs(even_x0 - margin) < 1.2,
          "recto left %.2f (gutter %.2f), verso left %.2f (margin %.2f)" % (odd_x0, gutter, even_x0, margin))
    check("recto content ends at the outer margin, verso at the gutter",
          abs(odd_x1 - (tw - margin)) < 1.2 and abs(even_x1 - (tw - gutter)) < 1.2,
          "recto right %.2f (limit %.2f), verso right %.2f (limit %.2f)"
          % (odd_x1, tw - margin, even_x1, tw - gutter))
    if abs(gutter - margin) > 0.5:
        check("gutter and outer margin genuinely differ, so mirroring is visible",
              odd_x0 > even_x0 + 1, "recto inset %.2fpt vs verso %.2fpt" % (odd_x0, even_x0))
    else:
        print("  NOTE  gutter (%.2fpt) equals the outer margin, so this preset's pages are"
              " geometrically symmetric — mirroring runs but is not visible here." % gutter)

    # ---- 7. flat-fee ceiling where the preset targets it --------------------
    if plan["presetId"] in ("B", "C"):
        check("preset %s at or under the 110-page flat-fee ceiling" % plan["presetId"],
              n <= 110, "%d pages" % n)

    # ---- 8. render proof pages ---------------------------------------------
    if render and not meta.get("proof"):
        div_pg = div[0] if div else 1
        last_sol = max([i + 1 for i, k in enumerate(kinds) if k == "solutions"] or [n])
        wanted = sorted(set([1, 7, 8, div_pg, last_sol]))
        made = []
        for pg in wanted:
            stem = os.path.join(outdir, "%s-p%03d" % (book_id, pg))
            subprocess.run(["pdftoppm", "-f", str(pg), "-l", str(pg), "-r", "110",
                            "-png", "-singlefile", pdf_path, stem], check=True)
            made.append(stem + ".png")
        check("rendered proof pages %s" % wanted, all(os.path.exists(p) for p in made))

    return meta


if __name__ == "__main__":
    outdir = sys.argv[1]
    for book_id in sys.argv[2:]:
        verify(outdir, book_id)
    failed = [r for r in results if not r[1]]
    print("\n%d checks, %d failed" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)
