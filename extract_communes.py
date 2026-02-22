import re
import csv
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_IN = Path("Carte_des_communes_de_la_Vendée.svg")
OUT = Path("communes_svg.csv")

ID_RE = re.compile(r"^(?P<insee>\d{5})\s+(?P<name>.+)$")

def main():
    tree = ET.parse(SVG_IN)
    root = tree.getroot()
    ns = {"svg": "http://www.w3.org/2000/svg"}

    rows = []
    seen = set()

    for tag in ["polygon", "path"]:
        for el in root.findall(f".//svg:{tag}", ns):
            el_id = el.get("id")
            if not el_id:
                continue
            m = ID_RE.match(el_id)
            if not m:
                continue
            insee = m.group("insee")
            name = m.group("name").strip()
            key = (insee, name)
            if key in seen:
                continue
            seen.add(key)
            rows.append((insee, name))

    rows.sort(key=lambda x: x[0])

    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["insee", "commune_svg"])
        w.writerows(rows)

    print(f"✅ {len(rows)} communes extraites -> {OUT}")

if __name__ == "__main__":
    main()
