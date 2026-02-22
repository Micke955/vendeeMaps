import csv
import re
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_IN = Path("Carte_des_communes_de_la_Vendée.svg")
CSV_SECTEURS = Path("secteurs.csv")
SVG_OUT = Path("Carte_des_communes_de_la_Vendée_secteurs.svg")

SECTOR_COLORS = {
    "1": "#E74C3C",  # rouge
    "2": "#3498DB",  # bleu
    "3": "#2ECC71",  # vert
}

ID_RE = re.compile(r"^(?P<insee>\d{5})\s+(?P<name>.+)$")

def normalize_name(s: str) -> str:
    s = s.strip().upper()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("’", "'")
    s = re.sub(r"\s+", " ", s)
    s = s.replace(" - ", "-").replace(" ", "-")
    return s

def load_sectors(csv_path: Path) -> dict[str, str]:
    mapping = {}
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            commune = normalize_name(row["commune"])
            secteur = row["secteur"].strip()
            mapping[commune] = secteur
    return mapping

def set_style_fill(elem: ET.Element, fill: str) -> None:
    style = elem.get("style", "")
    parts = [p for p in style.split(";") if p.strip()]
    parts = [p for p in parts if not p.startswith("fill:")]
    parts.insert(0, f"fill:{fill}")
    elem.set("style", ";".join(parts))

def main():
    sectors = load_sectors(CSV_SECTEURS)
    tree = ET.parse(SVG_IN)
    root = tree.getroot()

    ns = {"svg": "http://www.w3.org/2000/svg"}
    colored = 0

    for tag in ["polygon", "path"]:
        for el in root.findall(f".//svg:{tag}", ns):
            el_id = el.get("id")
            if not el_id:
                continue

            m = ID_RE.match(el_id)
            if not m:
                continue

            name = normalize_name(m.group("name"))
            secteur = sectors.get(name)
            if not secteur:
                continue

            fill = SECTOR_COLORS.get(secteur)
            if fill:
                set_style_fill(el, fill)
                colored += 1

    tree.write(SVG_OUT, encoding="utf-8", xml_declaration=True)
    print(f"SVG généré : {SVG_OUT} ({colored} communes colorées)")

if __name__ == "__main__":
    main()
