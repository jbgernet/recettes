# Carnet de recettes

Application web (installable sur iPhone et Android) pour consulter le carnet de recettes familial.
Les recettes sont stockées dans un Google Sheet ; ce dépôt ne contient que l'application.

## Fonctionnement

- `index.html`, `app.js`, `app.css` : l'application, publiée avec GitHub Pages.
- `config.js` : adresse du serveur Google Apps Script et prénom du propriétaire.
- `apps-script/Code.gs` : le serveur, à coller dans Apps Script (Extensions → Apps Script depuis le Sheet).
  Il n'est pas exécuté par GitHub : il est ici pour garder son historique.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation sur l'écran d'accueil et ouverture hors connexion.

## Réglages côté Google (Apps Script → ⚙️ Paramètres du projet → Propriétés du script)

| Propriété | Rôle |
|---|---|
| `CODE_FAMILLE` | code à donner aux proches pour ajouter des recettes et commenter |
| `CODE_ADMIN` | code du propriétaire (valider les recettes, noter dans ses colonnes) |
| `APP_URL` | adresse GitHub Pages de l'app (l'ancien lien Apps Script y renvoie) |

Les codes ne sont jamais écrits dans ce dépôt public.

## Données

- Onglet **Recettes** : colonnes A à O comme avant, plus **P Statut** (« À valider » pour les recettes proposées) et **Q Ajoutée par**.
- Onglet **Commentaires** (créé automatiquement) : avis et notes des proches.
- Favoris, « à tester », menu de la semaine, liste de courses, produits toujours à la maison et minuteurs sont enregistrés sur chaque téléphone.

## Bibliothèques

- `vendor/pdfjs/` : pdf.js (Mozilla, licence Apache 2.0), chargé seulement quand on importe un PDF dans l'onglet « Ajouter ». Le texte est extrait sur le téléphone, sans IA.
