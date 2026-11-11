# Statistiques privées et export Excel

Le frontend reste sur GitHub Pages. Les statistiques facultatives, le classement et l'administration utilisent le service Flask/Gunicorn `kimi-game` et sa base SQLite existante sur Ubuntu. Aucun fournisseur analytique externe.

## Navigation et connexion

Une vraie navigation/recharge revient toujours à START. Un retour d'arrière-plan conserve la partie courante. REPLAY attend le pseudo du résultat qualifié courant, mais une erreur réseau le libère sans annoncer une sauvegarde réussie. Les scores en attente sont accessibles séparément depuis « Pending scores » à l'accueil. Le nom est vide pour chaque nouvelle partie.

Les capacités secrètes des parties restent dans ce navigateur. Une file de 20 résultats maximum, conservés 7 jours, permet des nouvelles tentatives après retour réseau ou rechargement. Les entrées anonymes déjà confirmées restent en SQLite même au-delà de ce délai. Effacer le stockage local fait perdre leur droit de renommage. Chaque résultat utilise le même jeton lors des reprises, sans doublon. Seule la possession de ce jeton permet de compléter une entrée anonyme.

Les parties effectuées hors ligne peuvent être déclarées au retour de la connexion, avec début et fin, pendant 7 jours. Ces horaires sont déclarés par le navigateur : ce dispositif n'est pas une preuve anti-triche. Les scores restent bornés à 0–165, les jetons sont uniques et les entrées nommées sont immuables. Les anciennes protections et le tri des égalités restent en place.

## Consentement et mesures

« Privacy » propose un refus et une acceptation des statistiques, sans effet sur le jeu. La géolocalisation approximative est un choix distinct, décoché par défaut. Le navigateur persistant n'est créé pour les statistiques qu'après consentement. Aucun GPS, identifiant dérivé de l'IP ou fingerprinting. Les scores publics nécessaires au classement restent séparés.

Les événements sont dédupliqués par identifiant. La file locale consentie est limitée à 400 événements et 7 jours, avec délai réseau de 3 secondes, 8 tentatives par cycle et temporisation progressive. Une nouvelle navigation ou le retour en ligne relance les tentatives. Le jeu n'attend jamais ces appels.

Les statistiques brutes sont gardées 90 jours. L'administration et « Delete my statistics » permettent une suppression anticipée. Les scores publics ne sont pas effacés par la suppression des statistiques. Un export antérieur contenant les données supprimées est invalidé immédiatement. Les sauvegardes SQLite réalisées manuellement sont des copies privées séparées : leur suppression éventuelle relève aussi de l'administrateur.

Les parties ont un identifiant distinct, une durée de gameplay plafonnée à 60 secondes depuis GO, un temps actif estimé et une progression. Un point toutes les 10 secondes et les changements de visibilité suffisent ; aucun suivi des touches ou des étoiles. Une recharge du même onglet avec une partie en cours donne « interrupted ». Sans preuve de fin ou d'abandon, le statut reste « unknown ». Le passage en arrière-plan seul n'est jamais un abandon. L'événement d'abandon est pris en charge mais aucun abandon certain n'est inventé en l'absence d'une action explicite du jeu.

Les confirmations différées de noms sont rattachées à la partie et au navigateur d'origine, seulement si le consentement correspondant est encore actif. Les navigateurs peuvent avoir plusieurs pseudos. Les statistiques sont déclaratives, pas une identification de personnes.

## Administration

Adresse : `https://lammens-cloud.tail538586.ts.net/admin`

Identifiant : `admin`. Le mot de passe aléatoire est enregistré uniquement dans le fichier privé `~/.local/share/kimi-game/ADMIN-ACCESS.txt` (mode 600). Son hash et la clé de session sont dans `admin-credentials.json`, jamais dans Git ni GitHub Pages. Cookies HTTPS HttpOnly/SameSite Strict, expiration d'une heure, protection CSRF et limite d'essais de connexion. L'administration doit être ouverte via HTTPS ; l'HTTP local ne conserve volontairement pas son cookie sécurisé.

Le tableau de bord donne les indicateurs, le funnel, les visiteurs, visites, parties, événements, scores, localisations et appareils. Filtres UTC par dates, identifiant du navigateur et pseudo. Les liens d'identifiants ouvrent l'historique correspondant. Le fichier Excel inclut toujours toutes les données conservées, quels que soient les filtres d'affichage.

La géolocalisation retourne `unknown` sur cette installation : aucune base GeoIP locale n'est fournie. Pour l'activer ultérieurement, installer `geoip2`, fournir une base City locale dans `KIMI_GEOIP_DATABASE` et, seulement derrière un proxy local qui écrase correctement l'en-tête, activer `KIMI_TRUST_PROXY=1`. Aucun appel à un service géographique externe et aucune IP brute dans les tables statistiques. La localisation représente la connexion de réception ; les transmissions retardées peuvent ne pas refléter le lieu de jeu.

## Export automatique

Fichier privé unique : `~/.local/share/kimi-game/statistics.xlsx`.

`kimi-statistics-export.timer` lance un contrôle léger toutes les cinq minutes. Le service termine immédiatement s'il n'y a aucun changement, ou si le dernier export automatique date de moins d'une heure. Les écritures statistiques et les modifications du classement incrémentent une version dans SQLite. « Update Excel now » lance le travail en arrière-plan et ignore la limite horaire.

L'export utilise le runtime Node/artifact-tool local installé par Codex, configurable avec `KIMI_ARTIFACT_RUNTIME`. Emplacement actuel : `~/.cache/codex-runtimes/codex-primary-runtime/dependencies`. Ce runtime doit rester installé pour les exports futurs. Le jeu et les API restent fonctionnels si l'export échoue.

Un verrou empêche deux générations simultanées. Le worker prend un instantané cohérent, génère un fichier temporaire privé et compare chaque cellule exportée à la source avant remplacement atomique. Si la base change pendant la génération, le remplacement est reporté. Une erreur conserve le dernier classeur valide. Le tableau de bord affiche la dernière date, l'état en attente et les erreurs.

Onglets : Summary, Funnel, Visitors, Visits, Games, Events, Scores, Locations, Geography et Devices. Chaque champ de `stats_events` est exporté, ainsi que toutes les lignes et vues dérivées. Les secrets d'accès et métadonnées d'exploitation ne sont pas des statistiques et ne sont jamais exportés. Les timestamps bruts sont des nombres en secondes Unix UTC, explicitement étiquetés, sans perte de précision, avec des colonnes UTC lisibles supplémentaires au format date Excel. Les identifiants restent du texte et les pseudos ne deviennent jamais des formules Excel.

Installation du timer :

```bash
cp deploy/kimi-statistics-export.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kimi-statistics-export.timer
systemctl --user restart kimi-game
```

## Vérifications

```bash
npm test
npm run test:server
npm run test:leaderboard
node tests/statistics-browser.mjs
npm run test:browser
```

Les tests utilisent exclusivement des bases temporaires. Le test Excel intégral s'exécute si le runtime local est présent et est signalé comme ignoré en CI GitHub sans ce runtime. Il couvre les données complètes, les modifications de pseudo, le plafond horaire, le forçage manuel, l'absence de réécriture à vide et la préservation du fichier après interruption simulée. Les tests Chrome/WebKit iPhone couvrent consentement, recharges, panne, reprise, suppression et doublons. WebKit émulé ne remplace pas un essai sur un iPhone physique.
