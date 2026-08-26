#!/usr/bin/env bash
# Full validation suite.  cd dev && npm install && npm test
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
OUT="${KDP_OUT:-$ROOT/out}"
mkdir -p "$OUT"

echo "### 1. layout, syntax and pins"
for f in "$ROOT/engine.js" "$ROOT/core.js" "$ROOT/app.js" "$ROOT/fonts.js" "$ROOT/vendor/jspdf.umd.min.js"; do
  node --check "$f" && echo "  $(basename "$f") parses"
done
node check-layout.js
node check-jspdf-pin.js
python3 build-kdp-fonts.py --check
if [ -n "${ZS_SITE:-}" ]; then
  python3 sync-engine.py --check --from "$ZS_SITE/index.html"
else
  echo "  (ZS_SITE not set — skipping the upstream engine comparison)"
fi

echo; echo "### 2. guards (everything here must refuse)"
node kdp-check-guards.js

echo; echo "### 3. the page itself (jsdom)"
node kdp-smoke-jsdom.js

echo; echo "### 4. generate the reference interiors"
node kdp-harness.js ZS-001 "$OUT"
node kdp-harness.js ZS-003 "$OUT"
node kdp-harness.js ZS-003 "$OUT" 24

echo; echo "### 5. structural verification + proof renders"
python3 kdp-verify.py "$OUT" ZS-001 ZS-003 ZS-003-proof

echo; echo "### 6. solver sample + reproducibility"
KDP_OUT="$OUT" node kdp-check-engine.js ZS-001 ZS-003

echo; echo "ALL SUITES PASSED"
