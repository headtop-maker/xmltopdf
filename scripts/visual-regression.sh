#!/usr/bin/env bash
# Converts the fixture set through a running service and compares rendered pages
# with the approved Linux goldens. Requires the local image for PNG rendering.
#
# Usage:
#   ./scripts/visual-regression.sh            # compare
#   ./scripts/visual-regression.sh --update   # regenerate goldens (review the diff!)
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-local-test-key}"
IMAGE="${IMAGE:-xmltopdf:local}"
OUT="${OUT:-test-output/visual/current}"
UPDATE="${1:-}"

FIXTURES=(
  "torg2:test/fixtures/torg2.xml"
  "torg2-title1:test/fixtures/torg2-title1.xml"
  "upd-schfdop:test/fixtures/upd-schfdop.xml"
  "upd-schf:test/fixtures/upd-schf.xml"
  "upd-dop:test/fixtures/upd-dop.xml"
  "upd-svrk:test/fixtures/upd-svrk.xml"
  "upd-svzk:test/fixtures/upd-svzk.xml"
  "upd-title1:test/fixtures/upd-title1.xml"
)

rm -rf "$OUT"
mkdir -p "$OUT/pdf" "$OUT/png"

for entry in "${FIXTURES[@]}"; do
  name="${entry%%:*}"
  file="${entry#*:}"
  curl -fsS -m 120 \
    -H "X-API-Key: $API_KEY" \
    -H 'Content-Type: application/octet-stream' \
    -H 'Accept: application/json' \
    --data-binary "@$file" \
    "$BASE_URL/api/v1/conversions" > "$OUT/pdf/$name.json"
  url=$(node -e "process.stdout.write(require('./$OUT/pdf/$name.json').downloadUrl)")
  curl -fsS "$url" -o "$OUT/pdf/$name.pdf"
  mkdir -p "$OUT/png/$name"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$PWD/$OUT:/work" \
    "$IMAGE" pdftoppm -r 100 -png "/work/pdf/$name.pdf" "/work/png/$name/page" >/dev/null
  echo "rendered $name"
done

if [ "$UPDATE" = "--update" ]; then
  rm -rf test/golden
  mkdir -p test/golden
  for name in $(ls "$OUT/png"); do
    mkdir -p "test/golden/$name"
    cp "$OUT/png/$name"/*.png "test/golden/$name/"
  done
  echo "goldens updated in test/golden (Linux renderer, 100 dpi)"
else
  node scripts/compare-images.mjs test/golden "$OUT/png"
fi
