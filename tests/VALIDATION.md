# Validation — 10 novembre 2026

## Classement Ubuntu et préparation GitHub Pages

- `npm test` : 13 tests réussis, dont les tests audio/chargement repris de TarnStarGame.
- `npm run test:server` : 8 tests réussis. Classement top 10 persistant après recréation de l'application, ordre des égalités, envoi concurrent/idempotent, validation, expiration, limitation, CORS GitHub Pages, fichiers privés inaccessibles, requêtes Range vidéo.
- `npm run test:browser` : Chrome, 45 vérifications réussies sur deux parties complètes avec Replay ; aucun score de test publié.
- WebKit 27.2 / profil iPhone 13 : lecture vidéo 1080 px, partie réelle de 60 secondes, 165 points enregistrés via le formulaire dans SQLite, classement affiché et Replay réussis ; aucune erreur JavaScript.
- Formats 320 × 568 et 390 × 664 contrôlés après résultat : pas de débordement horizontal, Replay accessible. Capture : `/tmp/kimi-iphone-result.png`.
- WebKit : le jeu démarre également avec vidéo bloquée, `play()` en attente et AudioContext indisponible.
- Les tests navigateur utilisent une base temporaire supprimée à la fin. Base du service permanent contrôlée vide et intègre après les tests (`PRAGMA integrity_check = ok`).
- Service utilisateur `kimi-game` installé, activé et fonctionnel sur `127.0.0.1:8080`. Sauvegarde SQLite cohérente testée.
- Vidéo convertie HEVC → H.264/yuv420p/faststart : 85 585 216 → 19 023 470 octets, piste audio copiée ; original sauvegardé hors dépôt.
- Les modules `audio.js` et `loading.js` sont repris du dossier TarnStarGame fourni, sans modifier ce projet de référence ni sa base Supabase.

La validation WebKit reste une simulation sous Linux, pas un essai physique sur iPhone. Publication GitHub et accès Internet de l'API non validés à ce stade : authentification GitHub et activation administrative de Tailscale Funnel encore nécessaires.

---

# Historique — 12 septembre 2026

## Automatisée, logique

`node tests/game.test.js` : six tests réussis.

- 1 000 parties générées, chacune avec 60 blanches, 8 dorées et 12 rouges.
- Répartition croissante : 12 / 17 / 21 / 30 étoiles par quart de partie.
- Au moins trois dorées dans la phase finale ; dernier impact avant 60 secondes.
- Espacement horizontal contrôlé entre toutes les étoiles dont les chutes se chevauchent.
- Score normal, activation après trois positives, bonus x2, rouge touchée, rouge évitée, positive ratée.
- Chemins des 18 PNG, 19 MP3 et du MP4 vérifiés.

## Navigateur

Scénario reproductible : `/?test`, puis START. Le script utilise le vrai temps (pas d'accélération), la vidéo, AudioContext et des PointerEvents tactiles synthétiques. Le rapport détaillé est affiché dans la page.

Deux parties complètes validées avec Replay :

- START et 3 / 2 / 1 / GO ; exactement trois bips par partie, espacés de 1 seconde à 100 ms près ; un son GO.
- Deux captures dans la même tâche avec deux identifiants de pointeur ; une deuxième capture du même élément n'ajoute aucun point.
- Captures positives et sons bonus combo déclenchés ensemble.
- HURRY UP à 45 secondes ; TIME UP à 60 secondes, observé dans les 200 ms suivants.
- Aucun élément étoile actif à TIME UP, score figé ; la vidéo est toujours en lecture.
- Écran final et record conditionnel ; Replay remet à zéro, conserve le record, mélange la séquence.
- NEXT sans destination affiche le message prévu.
- Aucune erreur JavaScript ni avertissement console pendant les parties.

Métadonnées réellement lues : vidéo 1080 × 1920, durée 70,266666 secondes. Première image affichée avec vidéo en pause avant START.

Formats contrôlés : 390 × 844 et 320 × 568, sans débordement du document ni image cassée. Cadrage vérifié visuellement sur écran de départ, gameplay, combo et résultat.

Les essais tactiles sont simulés dans le navigateur de bureau. Le ressenti des pouces, le mix entendu sur haut-parleurs et les particularités de Safari iOS / Chrome Android n'ont pas été validés sur du matériel mobile physique.

## Ajustements visuels et de cadence

- PNG des étoiles réduit de 12,5 %, largeur de hitbox conservée.
- Traînées de 25 à 38 cqw, épaisseur et opacité conservées.
- Rotation de 60 à 120 degrés par chute, sens variable, uniquement sur l'image.
- Compteurs de gameplay réduits de 25 %, nombres réduits proportionnellement.
- Combo à 50 % de sa largeur précédente ; animation de 0,9 s depuis le double de cette nouvelle taille, disparition inchangée.
- Style textuel HURRY UP inutilisé supprimé ; PNG existant conservé à 45 s avec son audio.
- Départs individuels avant 45 s : anciens groupes décalés de 0,5–0,7 s, aucun intervalle inférieur à 0,5 s. Distribution 12/17/21/30 et réserve finale inchangées.
- Test supplémentaire de 1 000 séquences pour la cadence et les amplitudes de rotation.
- Scénario navigateur enrichi : mesures des PNG/hitboxes, traînées, compteurs, combo et vérification du chemin du PNG HURRY UP. Les captures sont retardées pour observer les chutes.

## Préparation du module et nouvelle pluie finale

- Rendu des étoiles réduit de 15 % par rapport à sa taille précédente ; hitbox portée à 140 % de la référence visuelle historique.
- Traînée portée de 38 à 42 cqw, sans changer son opacité ni son dessin.
- Génération des 45 premières secondes laissée inchangée.
- Les 30 étoiles finales commencent à partir de 45,6 s. Simulation de 10 000 parties : maximum observé de quatre chutes simultanées, aucune paire suivie d'une positive en moins de 0,4 s, aucun groupe de trois positives, aucun débordement après TIME UP.
- Score rouge plafonné à zéro, y compris lorsqu'elle casse un combo actif.
- Interface autonome exposée : `startStarsGame()`, `kimiGame.start()`, callback `onStarsGameComplete(result)` et événement `stars-game-complete`. Le résultat comprend score, record, tentatives et replays.
