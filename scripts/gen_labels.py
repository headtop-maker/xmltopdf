#!/usr/bin/env python3
"""Generate Russian labels for appendix fields from pinned XSD annotations.

Usage: python3 scripts/gen_labels.py <xsd> <out.json>
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

XS = "{http://www.w3.org/2001/XMLSchema}"


def documentation(node):
    annotation = node.find(f"{XS}annotation/{XS}documentation")
    if annotation is None or annotation.text is None:
        return ""
    return re.sub(r"\s+", " ", annotation.text).strip()


def main():
    source, output = sys.argv[1], sys.argv[2]
    raw = open(source, "rb").read()
    declared = re.search(rb'encoding="([^"]+)"', raw[:200])
    if declared and declared.group(1).lower() in (b"windows-1251", b"cp1251"):
        raw = raw.decode("cp1251").encode("utf-8")
    raw = re.sub(rb'encoding="[^"]*"', b'encoding="utf-8"', raw, count=1)
    root = ET.fromstring(raw)

    element_docs = {}
    attribute_docs = {}

    def visit_complex(complex_type):
        for attribute in complex_type.findall(f"{XS}attribute"):
            name = attribute.get("name")
            label = documentation(attribute)
            if name and label and name not in attribute_docs:
                attribute_docs[name] = label
        for child in complex_type:
            if child.tag.split("}")[-1] in ("sequence", "choice", "all"):
                for element in child.findall(f"{XS}element"):
                    visit_element(element)
            elif child.tag.split("}")[-1] in ("complexContent", "simpleContent"):
                for extension in child:
                    visit_complex(extension)

    def visit_element(element):
        name = element.get("name")
        label = documentation(element)
        if name and label and name not in element_docs:
            element_docs[name] = label
        inline = element.find(f"{XS}complexType")
        if inline is not None:
            visit_complex(inline)

    for element in root.findall(f"{XS}element"):
        visit_element(element)
    for complex_type in root.findall(f"{XS}complexType"):
        visit_complex(complex_type)

    with open(output, "w", encoding="utf-8") as handle:
        json.dump(
            {"elementDocs": element_docs, "attributeDocs": attribute_docs},
            handle,
            ensure_ascii=False,
            indent=2,
        )
        handle.write("\n")
    print(f"labels: {len(element_docs)} elements, {len(attribute_docs)} attributes")


if __name__ == "__main__":
    main()
