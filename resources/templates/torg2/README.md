# TORG-2 template contract

Source: `vislib13012026/Templates/671c72e0-35ec-41c8-9bda-19040d607bc5.sved`
(friendly name `ТОРГ-2_5.01 (423)_v006.001_22.12.2025`, revision 17).
The `.sved` archive is not committed; it is a locally supplied reference.

## Files

- `field-map.json` — 190 XPath rules extracted from the `правило` sheet.
  This is the field-completeness contract for the compiled renderer.
- `../../../scripts/compile-sved-layout.py` — extracts the Excel geometry
  (`представление`): page setup, 197 columns, 240 rows, 521 merged ranges,
  14 named blocks and 186 `${...}` placeholders into a neutral JSON layout.

## Usage

```bash
python3 scripts/compile-sved-layout.py \
  vislib13012026/Templates/671c72e0-35ec-41c8-9bda-19040d607bc5.sved \
  --out test-output/torg2-layout.json
```

Requires `openpyxl`. The output is an intermediate artifact and is not
consumed by the running service yet; the existing HTML renderer remains the
default.

## Status

- Extracted: field contract and layout geometry.
- Next: compiled renderer (fixed blocks + repeating tables), calibrated against
  the vislib/Saby reference PDFs, behind a feature flag.

## Geometry prototype (experimental)

`scripts/render-torg2-layout-preview.mjs` renders the compiled row ranges with
visible `${...}` placeholders. It is a geometry check only, not a production
renderer: the Excel template uses 197 narrow columns and many merges, and the
first preview exposed overlapping text/table borders. Do not enable it in the
service until the scaling and merge model is calibrated.
