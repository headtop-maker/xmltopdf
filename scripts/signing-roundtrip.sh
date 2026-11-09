#!/usr/bin/env bash
# Technical detached-signature round-trip with a throwaway self-signed RSA key.
#
# This proves that the stored PDF bytes can be signed and that changing a single
# byte invalidates the CMS signature. It does NOT validate GOST keys, a specific
# crypto provider, CAdES/PAdES profiles or the customer's signing process.
set -euo pipefail

PDF="${1:-test/fixtures/torg2-reference.pdf}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -days 1 \
  -subj "/CN=Local test signer/O=XMLToPDF" >/dev/null 2>&1

openssl cms -sign -binary -in "$PDF" -signer "$WORK/cert.pem" -inkey "$WORK/key.pem" \
  -outform DER -out "$WORK/document.sig" -md sha256

openssl cms -verify -binary -inform DER -in "$WORK/document.sig" -content "$PDF" \
  -CAfile "$WORK/cert.pem" -out /dev/null 2>/dev/null \
  && echo "OK   detached CMS signature verifies against the stored PDF"

cp "$PDF" "$WORK/tampered.pdf"
size=$(wc -c < "$WORK/tampered.pdf")
offset=$(( size / 2 ))
printf '\x00' | dd of="$WORK/tampered.pdf" bs=1 seek="$offset" count=1 conv=notrunc status=none

if openssl cms -verify -binary -inform DER -in "$WORK/document.sig" -content "$WORK/tampered.pdf" \
     -CAfile "$WORK/cert.pem" -out /dev/null 2>/dev/null; then
  echo "FAIL tampered PDF still verifies" >&2
  exit 1
fi
echo "OK   modifying one byte breaks verification (tamper detected)"
echo "PDF SHA-256: $(shasum -a 256 "$PDF" | cut -d' ' -f1)"
