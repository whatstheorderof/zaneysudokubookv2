#!/usr/bin/env python3
"""Check the printed cage-combinations sheet against the one on the site.

The book computes its own tables rather than carrying a copy of the web page,
which is the only way to be sure they are right — but it also means the two
could drift apart without anybody noticing. This parses
killer-sudoku-combinations.html and asserts that, for every cage size and every
total, the site and the exporter list exactly the same combinations in exactly
the same order.

  ZS_SITE=../zaneysudoku python3 dev/check-combos.py
  python3 dev/check-combos.py --from /path/to/killer-sudoku-combinations.html
"""
import html as htmllib
import itertools
import os
import re
import sys

SIZES = [2, 3, 4, 5]


def computed():
    """Exactly what core.js kdpComboTable produces, worked out independently."""
    out = {}
    for n in SIZES:
        by_sum = {}
        for combo in itertools.combinations(range(1, 10), n):
            by_sum.setdefault(sum(combo), []).append("+".join(str(d) for d in combo))
        out[n] = {s: by_sum[s] for s in sorted(by_sum)}
    return out


def from_site(path):
    src = open(path, encoding="utf-8").read()
    src = re.sub(r"(?s)<(script|style)\b.*?</\1>", "", src)
    out = {}
    # Each cage-size section is an <h2> followed by the table that belongs to it.
    for n in SIZES:
        word = {2: "2-cell", 3: "3-cell", 4: "4-cell", 5: "5-cell"}[n]
        m = re.search(r"<h2[^>]*>\s*%s cages\s*</h2>(.*?)</table>" % word, src, re.S)
        if not m:
            raise SystemExit("could not find the %s cages table in %s" % (word, path))
        rows = {}
        for tr in re.findall(r"(?s)<tr>(.*?)</tr>", m.group(1)):
            cells = re.findall(r"(?s)<t[dh][^>]*>(.*?)</t[dh]>", tr)
            if len(cells) != 3:
                continue
            def clean(x):
                x = re.sub(r"<[^>]+>", "", x)
                return htmllib.unescape(x).replace("\xa0", " ").strip()
            total, ways, combos = (clean(c) for c in cells)
            if not total.isdigit():
                continue
            items = [c.strip() for c in re.split(r"\s*·\s*", combos) if c.strip()]
            rows[int(total)] = (int(ways), items)
        out[n] = rows
    return out


if __name__ == "__main__":
    path = None
    if "--from" in sys.argv:
        path = sys.argv[sys.argv.index("--from") + 1]
    elif os.environ.get("ZS_SITE"):
        path = os.path.join(os.environ["ZS_SITE"], "killer-sudoku-combinations.html")
    if not path or not os.path.exists(path):
        print("  (no site checkout — skipping the combinations comparison)")
        sys.exit(0)

    ours, theirs = computed(), from_site(path)
    # And the exporter's own tables, dumped by the harness. Comparing all three
    # is what makes this worth running: Python agreeing with itself proves
    # nothing about what gets printed.
    core = None
    dump = os.environ.get("KDP_COMBOS_JSON")
    if dump and os.path.exists(dump):
        import json
        core = {int(k): {int(s): v for s, v in tbl.items()}
                for k, tbl in json.load(open(dump)).items()}
    problems, checked = [], 0
    if core is not None:
        for n in SIZES:
            if core.get(n) != ours[n]:
                problems.append("%d-cell: the exporter's table differs from the computed one" % n)
    else:
        print("  NOTE  no exporter dump given (KDP_COMBOS_JSON), comparing the site "
              "against the reference computation only")
    for n in SIZES:
        if set(ours[n]) != set(theirs[n]):
            problems.append("%d-cell: totals differ — ours %s, site %s"
                            % (n, sorted(ours[n]), sorted(theirs[n])))
            continue
        for total, items in ours[n].items():
            ways, site_items = theirs[n][total]
            checked += 1
            if ways != len(items):
                problems.append("%d-cell total %d: site says %d ways, there are %d"
                                % (n, total, ways, len(items)))
            if site_items != items:
                problems.append("%d-cell total %d: site lists %s, we list %s"
                                % (n, total, site_items, items))
    if problems:
        for p in problems[:6]:
            print("  FAIL  " + p)
        sys.exit(1)
    total_combos = sum(len(v) for n in SIZES for v in ours[n].values())
    print("  PASS  the printed cheat sheet matches the site  — %d totals, %d combinations, "
          "cage sizes %s" % (checked, total_combos, ", ".join(str(n) for n in SIZES)))
