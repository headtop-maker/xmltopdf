#!/usr/bin/env bash
# Local acceptance helper: converts the bundled TORG-2 fixture through a running
# service and produces text/PNG artefacts for comparison with the reference PDF.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:?Set API_KEY (the key from API_KEYS)}"
FIXTURE="${1:-test/fixtures/torg2.xml}"
OUT_DIR="${OUT_DIR:-test-output}"

mkdir -p "$OUT_DIR"

echo "POST $BASE_URL/api/v1/conversions"
http_code=$(curl -sS --fail-with-body -o "$OUT_DIR/conversion.json" -w '%{http_code}' \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/octet-stream' \
  -H 'Accept: application/json' \
  --data-binary "@$FIXTURE" \
  "$BASE_URL/api/v1/conversions")
echo "HTTP $http_code"

download_url=$(node -e "process.stdout.write(require('./$OUT_DIR/conversion.json').downloadUrl)")
curl -sS --fail-with-body -o "$OUT_DIR/torg2-generated.pdf" "$download_url"

echo "sha256: $(shasum -a 256 "$OUT_DIR/torg2-generated.pdf" | cut -d' ' -f1)"
node -e "const r=require('./$OUT_DIR/conversion.json'); console.log(JSON.stringify({pages:r.pageCount, bytes:r.pdfSizeBytes, unmapped:r.validation.unmappedCount, business:r.validation.business, warnings:r.warnings}, null, 2))"

pdftotext -layout "$OUT_DIR/torg2-generated.pdf" "$OUT_DIR/generated.txt"
pdftoppm -r 100 -png "$OUT_DIR/torg2-generated.pdf" "$OUT_DIR/page" >/dev/null 2>&1
echo "wrote $OUT_DIR/conversion.json, $OUT_DIR/torg2-generated.pdf, $OUT_DIR/generated.txt, $OUT_DIR/page-*.png"
