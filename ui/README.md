# Vendée Maps UI

## Lancer en local

Depuis le dossier `ui/` :

```bash
cd ui
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000` dans le navigateur.

## Notes

- Le SVG est chargé via `fetch("./Carte_des_communes_de_la_Vendée.svg")`.
- Les IDs de communes attendus sont au format `NNNNN NOM`.
- Import CSV attendu: `commune;secteur` (secteur = 1 à 9).

## Temps réel (Firebase)

1. Crée un projet Firebase + Firestore.
2. Active l’authentification anonyme (Authentication > Sign-in method).
3. Remplace les valeurs de `firebaseConfig` dans `ui/app.js`.
3. Règles Firestore (version stricte recommandée) :

```txt
Copie le contenu de `ui/firestore.rules` dans Firebase Console > Firestore Database > Rules.
```

## Sécurité

- Les règles strictes limitent l'accès à:
  - `vendee/state` (lecture + écriture authentifiée avec validation de schéma),
  - `vendee_presence/{uid}` (chaque client écrit uniquement son propre document).
- Elles sont plus sûres que la règle ouverte `allow read, write`.
