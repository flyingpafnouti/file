# FileLab

FileLab est un atelier de fichiers 100 % local et statique. Les images, vidéos, pistes audio, PDF et archives sont traités dans le navigateur : aucun fichier n'est envoyé vers un serveur.

## Fonctionnalités

- conversion, compression, redimensionnement, rotation et flip d'images ;
- traitement par lots avec presets, renommage et téléchargement ZIP ;
- conversion vidéo/audio locale avec FFmpeg WebAssembly, découpage, résolution, bitrate, miniature, GIF et extraction audio ;
- création et extraction d'archives ZIP ;
- fusion, extraction, suppression et rotation de pages PDF, plus images vers PDF ;
- calcul SHA-256 local, métadonnées utiles et file d'attente annulable ;
- PWA installable avec mise en cache hors connexion après le premier chargement.

## Développement

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
npm run dev
```

Ouvrez ensuite <http://localhost:3000>. Le moteur FFmpeg (~32 Mo) est servi depuis les dépendances locales et n'est chargé que lors du premier traitement audio ou vidéo.

## Build statique

```bash
npm run build
npm run preview
```

Le dossier `dist/` contient le site statique. Les chemins sont relatifs, donc le build fonctionne à la racine d'un domaine comme sous un chemin tel que `/file-lab/`.

## Déploiement GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` construit et publie automatiquement le site à chaque push sur `main`.

1. Créez un dépôt GitHub et poussez la branche `main`.
2. Dans **Settings → Pages**, choisissez **GitHub Actions** comme source.
3. Le prochain push publiera `dist/` sur GitHub Pages.

## Confidentialité

FileLab ne contient ni backend, ni analytics, ni cookie, ni clé API. Les presets personnels sont les seules données conservées dans `localStorage`. Les fichiers et résultats restent en mémoire le temps de la session puis sont libérés par le navigateur.
