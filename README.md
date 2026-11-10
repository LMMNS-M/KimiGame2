# Kimi · Shooting Wishes

Jeu tactile portrait 9:16 : attraper les étoiles blanches et dorées, éviter les rouges pendant 60 secondes. Trois captures positives activent le combo x2. Le score ne descend jamais sous zéro. À la fin : résultat, record personnel, classement partagé des 5 meilleures parties et Replay. Aucune suite n'est proposée. Attraper une étoile rouge déclenche un léger filtre rouge translucide de 320 ms (16 % d'opacité maximale, 8 % si les animations réduites sont demandées).

## Architecture

- **GitHub Pages** héberge le HTML, le JavaScript, les images, les sons et la vidéo.
- **Ubuntu** héberge l'API Flask/Gunicorn et la base SQLite. Aucun compte Supabase ni service de stockage externe n'est utilisé.
- `js/server-config.js` choisit l'API HTTPS pour GitHub Pages ; en local, le jeu utilise le serveur qui sert la page.
- Le classement est partagé entre tous les joueurs. Chaque partie peut être enregistrée avec un pseudo public de 1 à 20 caractères. Le visuel TOP 5 affiche les cinq premières parties ; l'API conserve son top 10 et aucun score n'est supprimé. Plusieurs parties d'un même pseudo peuvent figurer au classement. Les égalités sont départagées par l'ordre d'enregistrement.
- Le record personnel et le dernier pseudo restent dans le navigateur ; les scores partagés sont exclusivement dans SQLite.

## Lancer localement

Python 3.12 et son module venv sont nécessaires. Node.js 22 sert aux tests, pas au serveur.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm start
```

Ouvrir <http://127.0.0.1:8080>. La base de développement est créée dans `data/scores.sqlite3`. Un simple `python -m http.server` permet de jouer, mais ne fournit pas l'API du classement.

## Service permanent sur ce serveur Ubuntu

Le service utilisateur `kimi-game` utilise :

- code : `/home/lammens-cloud/Documents/KimiGame2` ;
- base : `/home/lammens-cloud/.local/share/kimi-game/scores.sqlite3` ;
- écoute : `127.0.0.1:8080` ;
- origine GitHub autorisée : `https://lmmns-m.github.io`.

Le fichier de service fourni suppose ce chemin de projet. L'adapter si le dossier change.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/kimi-game.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kimi-game
systemctl --user status kimi-game
journalctl --user -u kimi-game -n 50
```

Le maintien du service hors session (`Linger=yes`) est déjà activé sur cette machine. Après une mise à jour Python : réinstaller les dépendances si nécessaire puis `systemctl --user restart kimi-game`.

### Accès HTTPS depuis GitHub Pages

Le domaine Tailscale de cette machine est `lammens-cloud.tail538586.ts.net`. Le port HTTPS 443 est prévu pour ce jeu, séparément des accès privés existants sur 8443 et 8444.

Une authentification administrateur Ubuntu est nécessaire pour activer cet accès :

```bash
sudo tailscale funnel --bg --https=443 http://127.0.0.1:8080
```

Si Tailscale demande d'autoriser Funnel dans son administration, suivre cette étape. Vérifier ensuite depuis une connexion externe :

```bash
curl https://lammens-cloud.tail538586.ts.net/api/health
```

Résultat attendu : `{"status":"ok"}`. Tant que cette URL n'est pas accessible, la publication des scores depuis GitHub Pages ne fonctionne pas. La machine Ubuntu doit rester allumée et connectée. Le jeu reste jouable si l'API est indisponible, mais une partie sans connexion initiale ne peut pas être publiée au classement.

Pour un domaine personnel, `deploy/Caddyfile.example` fournit une alternative. Modifier alors l'URL dans `js/server-config.js`. Si l'origine de la page change, adapter `KIMI_ALLOWED_ORIGINS` dans le service. Aucune clé secrète n'est placée dans le navigateur.

## Publication GitHub Pages

Dépôt prévu : `LMMNS-M/KimiGame2`. Le dépôt TarnStarGame et ses données ne sont pas modifiés.

1. Créer un dépôt GitHub vide `KimiGame2` dans le compte `LMMNS-M`.
2. Ajouter le remote et pousser la branche `main` :

   ```bash
   git remote add origin https://github.com/LMMNS-M/KimiGame2.git
   git push -u origin main
   ```

3. Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions**.
4. Lancer le workflow **Publish game to GitHub Pages** si nécessaire.

Le workflow ne publie que les fichiers du jeu. La base SQLite, l'environnement Python et le code du serveur ne sont pas inclus dans les fichiers de GitHub Pages. Le dépôt contient le code serveur pour permettre son installation, jamais les données des joueurs.

L'URL attendue, après déploiement réussi, est `https://lmmns-m.github.io/KimiGame2/`.

## Compatibilité iPhone

Les modules audio et chargement sont repris de la version locale de **TarnStarGame**, déjà testée sur iPhone par le propriétaire :

- lecture `playsinline` et activation vidéo/audio directement pendant le toucher de START ;
- démarrage sans attendre `loadeddata`, `play()` ou le décodage audio indéfiniment ;
- délai de secours de 5 secondes pour les ressources ;
- prise en charge du décodage WebKit par callbacks et des sons chargés tardivement ;
- reprise après retour dans l'onglet, gestion des promesses rejetées ;
- champ pseudo à 16 px pour éviter le zoom de saisie, classement défilable, zones sûres de l'écran.

Référence : [règles vidéo WebKit sur iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/).

La vidéo a été convertie de HEVC vers **H.264, yuv420p, MP4 faststart**, en conservant la piste audio et la résolution 1080 × 1920. Elle pèse environ 19 Mo au lieu de 86 Mo. L'original est conservé hors dépôt à `~/.local/share/kimi-game/original-media/stars-game-background-hevc.mp4` sur cette machine.

Les tests WebKit avec profil iPhone complètent les tests Chrome ; ils ne remplacent pas un essai sur un iPhone physique pour le son, le clavier et les modes économie d'énergie.

## Vérifications

```bash
npm test
npm run test:server
```

Tests de navigateur facultatifs (deux parties réelles, environ 2 min 15) :

```bash
npm ci
npx playwright install --with-deps webkit
npm run test:browser
```

Le test utilise Chrome installé dans `/usr/bin/google-chrome` (ou `CHROME_BIN`) et WebKit, crée une base temporaire séparée et la supprime après vérification. Il couvre la vidéo, le jeu, l'enregistrement, le replay et le démarrage sans médias. Les captures de résultat sont écrites dans `/tmp/kimi-iphone-result.png`.

Le scénario `/?test` joue automatiquement deux parties après START, sans appeler l'API ni publier de scores. `window.kimiGame.snapshot()` expose un diagnostic en lecture seule.

## Données, sauvegarde et limites

SQLite utilise des transactions et un index de classement. L'API refuse les scores hors de 0–165, les parties trop courtes, les jetons inconnus ou expirés et les changements d'un résultat déjà publié. Une requête réessayée après coupure réseau ne crée pas de doublon. Les ouvertures de parties sont limitées ; derrière le proxy local, cette limite de 60 parties par heure est partagée, ce qui convient à un petit jeu privé mais doit être adapté avant une audience plus large.

Ces contrôles ne constituent pas un système anti-triche complet : le score est calculé dans le navigateur et un joueur déterminé pourrait le falsifier dans la plage autorisée. Il n'y a ni compte joueur ni identité vérifiée.

Pour sauvegarder la base pendant que le serveur fonctionne :

```bash
.venv/bin/python scripts/backup_scores.py
```

La sauvegarde SQLite cohérente est créée dans `~/.local/share/kimi-game/backups/`. Aucun fichier de données ou de sauvegarde ne doit être ajouté au dépôt Git.

## Fichiers principaux

- `js/config.js`, `js/timeline.js` : rythme et règles de score.
- `js/assets.js` : chemins des 19 images, 19 sons et de la vidéo.
- `js/audio.js`, `js/loading.js` : médias et démarrage compatible iPhone.
- `js/game.js` : boucle de jeu, affichage, replay.
- `js/leaderboard.js`, `js/server-config.js` : formulaire et API du classement.
- `server.py` : API, validation et stockage SQLite.
- `deploy/` : service Ubuntu et exemple de reverse proxy.
