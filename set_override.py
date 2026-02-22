import sys
from pathlib import Path

OVERRIDES = Path("overrides.csv")

def main():
    if len(sys.argv) < 3:
        print("Usage: python set_override.py \"NOM_COMMUNE\" 1|2|3")
        sys.exit(1)

    commune = sys.argv[1].strip().upper()
    secteur = sys.argv[2].strip()

    if secteur not in {"1", "2", "3"}:
        print("Le secteur doit être 1, 2 ou 3.")
        sys.exit(1)

    # charge existant
    lines = []
    if OVERRIDES.exists():
        lines = [l.strip() for l in OVERRIDES.read_text(encoding="utf-8").splitlines() if l.strip()]

    # supprime ancienne entrée si existe
    lines = [l for l in lines if not l.split(";")[0].strip().upper() == commune]

    # ajoute nouvelle
    lines.append(f"{commune};{secteur}")

    OVERRIDES.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✅ Override ajouté: {commune} -> secteur {secteur}")

if __name__ == "__main__":
    main()
