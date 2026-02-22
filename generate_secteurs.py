import csv
import re
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_IN = Path("Carte_des_communes_de_la_Vendée.svg")
OUT_CSV = Path("secteurs.csv")
REPORT = Path("secteurs_report.txt")

ID_RE = re.compile(r"^(?P<insee>\d{5})\s+(?P<name>.+)$")

# --- Réglages ---
MODE = "equal_count"   # "equal_count" (auto) ou "thresholds" (manuel)

# Si MODE="thresholds" :
# tout ce qui est x <= X1 -> secteur 1, X1 < x <= X2 -> secteur 2, x > X2 -> secteur 3
X1 = 200.0
X2 = 400.0

# Optionnel : fichier d'override pour forcer des communes (une ligne: COMMUNE;secteur)
OVERRIDES_FILE = Path("overrides.csv")  # tu peux le laisser absent


def parse_polygon_points(points: str):
    """Retourne une liste de (x,y) depuis l'attribut points d'un polygon."""
    pts = []
    s = points.strip().replace(",", " ")
    parts = [p for p in s.split() if p]
    if len(parts) < 4:
        return pts
    # paires x,y
    for i in range(0, len(parts) - 1, 2):
        try:
            x = float(parts[i])
            y = float(parts[i + 1])
            pts.append((x, y))
        except ValueError:
            continue
    return pts


def centroid_from_points(pts):
    """Centroïde simple via bbox (robuste même si polygone concave)."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0


def parse_path_points_minimal(d: str):
    """
    Parse minimal des paths en prenant tous les couples numériques (x,y) trouvés.
    Ça ne reconstruit pas la géométrie exacte, mais donne un bbox usable.
    """
    nums = re.findall(r"[-+]?\d*\.\d+|[-+]?\d+", d)
    pts = []
    # prend par paires
    for i in range(0, len(nums) - 1, 2):
        try:
            x = float(nums[i])
            y = float(nums[i + 1])
            pts.append((x, y))
        except ValueError:
            continue
    return pts


def load_overrides():
    overrides = {}
    if not OVERRIDES_FILE.exists():
        return overrides
    with OVERRIDES_FILE.open("r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        for row in reader:
            if not row or len(row) < 2:
                continue
            commune = row[0].strip().upper()
            secteur = row[1].strip()
            if secteur in {"1", "2", "3"}:
                overrides[commune] = secteur
    return overrides


def main():
    if not SVG_IN.exists():
        raise FileNotFoundError(f"SVG introuvable: {SVG_IN.resolve()}")

    tree = ET.parse(SVG_IN)
    root = tree.getroot()
    ns = {"svg": "http://www.w3.org/2000/svg"}

    communes = []  # (insee, name, cx, cy, source)
    skipped = []

    for tag in ["polygon", "path"]:
        for el in root.findall(f".//svg:{tag}", ns):
            el_id = el.get("id")
            if not el_id:
                continue

            m = ID_RE.match(el_id)
            if not m:
                continue

            insee = m.group("insee")
            name = m.group("name").strip().upper()

            pts = []
            source = None

            if tag == "polygon":
                pts = parse_polygon_points(el.get("points", ""))
                source = "polygon"
            else:
                pts = parse_path_points_minimal(el.get("d", ""))
                source = "path(min)"

            if len(pts) < 2:
                skipped.append((insee, name, tag))
                continue

            cx, cy = centroid_from_points(pts)
            communes.append((insee, name, cx, cy, source))

    if not communes:
        raise RuntimeError("Aucune commune détectée dans le SVG (id non conforme ou SVG différent).")

    # --- Attribution secteur ---
    # Split en 3 secteurs par X (horizontal). Par défaut on fait des quantiles (≈ même nb de communes / secteur).
    xs_sorted = sorted([c[2] for c in communes])

    def quantile(q):
        idx = int(q * (len(xs_sorted) - 1))
        return xs_sorted[idx]

    if MODE == "equal_count":
        x1 = quantile(1/3)
        x2 = quantile(2/3)
    elif MODE == "thresholds":
        x1 = float(X1)
        x2 = float(X2)
    else:
        raise ValueError("MODE doit être 'equal_count' ou 'thresholds'.")

    overrides = load_overrides()

    out_rows = []
    counts = {"1": 0, "2": 0, "3": 0, "override": 0}

    for insee, name, cx, cy, source in communes:
        if name in overrides:
            secteur = overrides[name]
            counts["override"] += 1
        else:
            if cx <= x1:
                secteur = "1"
            elif cx <= x2:
                secteur = "2"
            else:
                secteur = "3"

        counts[secteur] += 1
        out_rows.append((name, secteur, insee, round(cx, 2), round(cy, 2), source))

    # Trie sympa
    out_rows.sort(key=lambda r: r[2])  # tri INSEE

    # CSV final (complet + exploitable)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        # Les 2 premières colonnes suffisent pour ton colorize,
        # les autres sont là pour debug/ajustement.
        w.writerow(["commune", "secteur", "insee", "cx", "cy", "source"])
        w.writerows(out_rows)

    # Report
    with REPORT.open("w", encoding="utf-8") as f:
        f.write("=== Génération secteurs.csv ===\n")
        f.write(f"MODE={MODE}\n")
        f.write(f"Seuils X: x1={x1:.2f} ; x2={x2:.2f}\n\n")
        f.write(f"Communes détectées: {len(communes)}\n")
        f.write(f"Secteur 1: {counts['1']}\n")
        f.write(f"Secteur 2: {counts['2']}\n")
        f.write(f"Secteur 3: {counts['3']}\n")
        f.write(f"Overrides appliqués: {counts['override']}\n\n")
        if skipped:
            f.write(f"Formes ignorées (points insuffisants): {len(skipped)}\n")
            for insee, name, tag in skipped[:50]:
                f.write(f"- {insee} {name} ({tag})\n")

    print(f"✅ Généré: {OUT_CSV} ({len(out_rows)} communes)")
    print(f"🧾 Rapport: {REPORT}")
    print(f"📏 Seuils X: x1={x1:.2f} / x2={x2:.2f}")
    print(f"🎛 Overrides: {counts['override']} (si overrides.csv existe)")

if __name__ == "__main__":
    main()
