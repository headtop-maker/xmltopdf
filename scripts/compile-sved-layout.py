#!/usr/bin/env python3
"""Compile a .sved Excel template into a neutral layout JSON.

This is the first stage of the TORG-2 template compiler. It does not render
anything and does not touch the running service. The output contains the
geometry, merged ranges, named blocks and cell styles that a later HTML/PDF
renderer can consume.

Usage:
  python3 scripts/compile-sved-layout.py vislib13012026/Templates/671c...sved \
      --out resources/templates/torg2/layout.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.utils import get_column_letter

EMU_PER_INCH = 914400
MM_PER_INCH = 25.4
PT_PER_INCH = 72.0


def mm_from_pt(value: float | None) -> float | None:
    return None if value is None else round(float(value) * MM_PER_INCH / PT_PER_INCH, 3)


def px_from_width(chars: float) -> float:
    # Excel's default-width approximation for Calibri 11 at 96 dpi.
    return chars * 7.0 + 5.0


def cell_value(cell: Any) -> Any:
    value = cell.value
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    return value


def color(value: Any) -> str | None:
    if value is None:
        return None
    if getattr(value, "type", None) == "rgb" and getattr(value, "rgb", None):
        return str(value.rgb)
    if getattr(value, "type", None) == "theme":
        return f"theme:{value.theme}:{value.tint}"
    if getattr(value, "indexed", None) is not None:
        return f"indexed:{value.indexed}"
    return None


def border_side(side: Any) -> dict[str, Any] | None:
    if side is None or getattr(side, "style", None) is None:
        return None
    return {"style": str(side.style), "color": color(side.color)}


def style_of(cell: Any) -> dict[str, Any] | None:
    if not cell.has_style:
        return None
    font = cell.font
    fill = cell.fill
    alignment = cell.alignment
    border = cell.border
    result: dict[str, Any] = {
        "font": {
            "name": font.name,
            "size": font.sz,
            "bold": bool(font.b),
            "italic": bool(font.i),
            "underline": font.u,
            "color": color(font.color),
        },
        "alignment": {
            "horizontal": alignment.horizontal,
            "vertical": alignment.vertical,
            "wrap": bool(alignment.wrap_text),
            "shrink": bool(alignment.shrink_to_fit),
            "indent": alignment.indent,
        },
        "numberFormat": cell.number_format,
        "border": {
            "left": border_side(border.left),
            "right": border_side(border.right),
            "top": border_side(border.top),
            "bottom": border_side(border.bottom),
        },
    }
    if getattr(fill, "fill_type", None):
        result["fill"] = {
            "type": fill.fill_type,
            "color": color(getattr(fill, "fgColor", None)),
        }
    return result


def named_range_bounds(wb: openpyxl.Workbook, sheet_name: str) -> list[dict[str, Any]]:
    result = []
    for name in wb.defined_names:
        definition = wb.defined_names[name]
        attr = getattr(definition, "attr_text", "") or ""
        prefix = next((p for p in (f"'{sheet_name}'!", f"{sheet_name}!") if attr.startswith(p)), None)
        if prefix is None:
            continue
        ref = attr[len(prefix):].replace("$", "")
        if ":" not in ref:
            continue
        start, end = ref.split(":", 1)
        start_col = openpyxl.utils.column_index_from_string("".join(c for c in start if c.isalpha()))
        end_col = openpyxl.utils.column_index_from_string("".join(c for c in end if c.isalpha()))
        start_row = int("".join(c for c in start if c.isdigit()))
        end_row = int("".join(c for c in end if c.isdigit()))
        result.append({"name": name, "ref": ref, "minCol": start_col, "maxCol": end_col,
                       "minRow": start_row, "maxRow": end_row})
    return result


def compile_layout(sved: Path, sheet_name: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="sved-layout-") as tmp:
        with zipfile.ZipFile(sved) as archive:
            archive.extractall(tmp)
        root = Path(tmp)
        meta = json.loads((root / "meta.json").read_text(encoding="utf-8"))
        workbook_path = root / "template.xlsx"
        wb = openpyxl.load_workbook(workbook_path, data_only=False)
        if sheet_name not in wb.sheetnames:
            raise SystemExit(f"sheet {sheet_name!r} not found; available: {wb.sheetnames}")
        ws = wb[sheet_name]
        names = named_range_bounds(wb, sheet_name)

        max_col = max([1] + [n["maxCol"] for n in names] + [r.max_col for r in ws.merged_cells.ranges])
        max_row = max([1] + [n["maxRow"] for n in names] + [r.max_row for r in ws.merged_cells.ranges])
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=max_col):
            for cell in row:
                if cell.value not in (None, ""):
                    max_col = max(max_col, cell.column)
                    max_row = max(max_row, cell.row)

        # openpyxl stores a single ColumnDimension for a whole range
        # (e.g. B:197 width=0.67). Resolve the ranges explicitly instead of
        # reading ws.column_dimensions[letter], which falls back to default 13.
        width_by_col: dict[int, float] = {}
        hidden_by_col: dict[int, bool] = {}
        for dim in ws.column_dimensions.values():
            start = dim.min or 1
            end = min(dim.max or start, max_col)
            if end < start or start > max_col:
                continue
            width = dim.width if dim.width is not None else 8.43
            for index in range(start, end + 1):
                width_by_col[index] = float(width)
                hidden_by_col[index] = bool(dim.hidden)

        columns = []
        for index in range(1, max_col + 1):
            letter = get_column_letter(index)
            width = width_by_col.get(index, 8.43)
            columns.append({
                "index": index,
                "letter": letter,
                "widthChars": round(width, 3),
                "widthPx": round(px_from_width(width), 2),
                "widthMm": round(px_from_width(width) * MM_PER_INCH / 96.0, 3),
                "hidden": hidden_by_col.get(index, False),
            })

        rows = []
        for index in range(1, max_row + 1):
            dim = ws.row_dimensions[index]
            height_pt = dim.height if dim.height is not None else 15.0
            rows.append({
                "index": index,
                "heightPt": round(float(height_pt), 3),
                "heightMm": mm_from_pt(height_pt),
                "hidden": bool(dim.hidden),
            })

        cells = []
        merged_anchors: set[tuple[int, int]] = set()
        for merged in ws.merged_cells.ranges:
            merged_anchors.add((merged.min_row, merged.min_col))
        for row in ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col):
            for cell in row:
                if cell.value in (None, "") and not cell.has_style and (cell.row, cell.column) not in merged_anchors:
                    continue
                cells.append({
                    "row": cell.row,
                    "col": cell.column,
                    "ref": cell.coordinate,
                    "value": cell_value(cell),
                    "style": style_of(cell),
                })

        merges = [
            {"minRow": r.min_row, "maxRow": r.max_row, "minCol": r.min_col, "maxCol": r.max_col,
             "ref": str(r)}
            for r in ws.merged_cells.ranges
        ]
        page = ws.page_setup
        margins = ws.page_margins
        row_breaks = [b.id for b in ws.row_breaks.brk]
        col_breaks = [b.id for b in ws.col_breaks.brk]

        return {
            "formatVersion": 1,
            "source": {
                "sved": sved.name,
                "meta": meta,
                "sheet": sheet_name,
                "workbook": "template.xlsx",
            },
            "page": {
                "orientation": page.orientation,
                "paperSize": page.paperSize,
                "fitToWidth": page.fitToWidth,
                "fitToHeight": page.fitToHeight,
                "scale": page.scale,
                "marginsMm": {
                    "left": round(margins.left * MM_PER_INCH, 3),
                    "right": round(margins.right * MM_PER_INCH, 3),
                    "top": round(margins.top * MM_PER_INCH, 3),
                    "bottom": round(margins.bottom * MM_PER_INCH, 3),
                    "header": round(margins.header * MM_PER_INCH, 3),
                    "footer": round(margins.footer * MM_PER_INCH, 3),
                },
                "rowBreaks": row_breaks,
                "colBreaks": col_breaks,
            },
            "columns": columns,
            "rows": rows,
            "merges": merges,
            "namedRanges": names,
            "cells": cells,
            "stats": {
                "columns": max_col,
                "rows": max_row,
                "cells": len(cells),
                "merges": len(merges),
                "namedRanges": len(names),
                "placeholders": sum(1 for c in cells if isinstance(c["value"], str) and "${" in c["value"]),
            },
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sved", type=Path)
    parser.add_argument("--sheet", default="представление")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    layout = compile_layout(args.sved, args.sheet)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(layout, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(layout["stats"], ensure_ascii=False))
    print(args.out)


if __name__ == "__main__":
    main()
