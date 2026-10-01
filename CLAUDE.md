# Plugin Anki multijoueur

Projet commun de deux étudiants en médecine (préclinique, Québec), qui ont chacun leur propre
plugin « casino » pour Anki, différent l'un de l'autre. Ce dépôt est un **troisième plugin, séparé**,
que chacun installe à côté du sien pour étudier ensemble à distance.

## Décisions déjà prises
- **Indépendant des casinos** : le plugin lit seulement les données d'Anki (table `revlog`,
  `cards`, `col.sched`) : cartes faites, minutes, jours étudiés, rétention, nouvelles cartes.
  Il ne lit ni ne modifie les jetons, niveaux ou objets d'aucun casino. (Un « pont » vers les
  casinos pourra venir plus tard, en option, dans chaque casino.)
- **Serveur : Supabase, offre gratuite** (base Postgres + API REST). Le plugin lui parle en HTTP
  avec la clé publique `anon` ; les règles de sécurité (row level security) empêchent chacun
  de modifier les données des autres. Aucune clé secrète dans le code ni dans le dépôt.
  Projet : https://fohgoubpaklcqgrkroaw.supabase.co (compte CapyLinkMa). Schéma : `supabase/schema.sql`.
  Joueurs = comptes anonymes Supabase Auth (session dans `multijoueur/user_files/`, jamais dans git),
  sécurisables par **nom d'utilisateur + mot de passe, sans courriel** (le plugin fabrique une adresse
  `<nom>@joueurs.anki-multijoueur.app` jamais utilisée ; « Confirm email » désactivé dans Supabase).
- **Interface compacte** : elle vit à côté de nos casinos, donc petite fenêtre (600×680), une colonne.
- **Rattrapage** : les 14 derniers jours sont renvoyés à chaque synchro (et tout depuis le dernier envoi
  après une pause), et une synchro part après chaque synchro Anki : les cartes faites sur téléphone comptent.
- **Vie privée** : on n'envoie que des chiffres d'étude et un pseudo, jamais le contenu des cartes.
- **Langue** : interface en français. Les deux utilisateurs ne sont pas développeurs : leur
  expliquer simplement, sans jargon.
- **Programmes différents** : l'un est en médecine, l'autre au bac en biologie. Pas de paquet
  commun, des volumes de cartes différents. Donc les classements et défis doivent être **équitables** :
  comparer surtout des pourcentages de son propre objectif, la régularité, la rétention et le
  vidage de ses retards, pas seulement le nombre brut de cartes. Chacun fixe son objectif quotidien.
- Fonctionnalités choisies (2026-10-01) : cochées dans `FONCTIONNALITES.md`.
  CapyLinkMa : 1, 2, 3, 5, 7, 8, 11, 13, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29.
  Xyroob : d'accord, et ajoute 6, 9, 12, 14, 17. Il veut aussi une interface plus intuitive et plus belle
  (à faire ensemble : se mettre d'accord avant de toucher au design).
- **Objectif automatique et points** (2026-10-01, proposé par Xyroob qui a beaucoup plus de cartes) :
  l'objectif du jour = ce qu'Anki demande (cartes distinctes faites + encore dues, limites des paquets
  comprises), retenu chaque jour dans `user_files/state.json` (`targets`). Le serveur ne garde que `cards`
  et `goal` : `goal` est mis à l'échelle pour que cards/goal = cartes distinctes faites / cartes demandées
  (`api.server_row`). Jours jamais vus par Anki ordinateur : l'objectif du profil (« objectif de secours »).
  Points par jour (`group.day_points`) : jusqu'à 10 pour la part faite, +3 max au-delà de 100 %,
  +3 régularité, +3 zéro retard, +2 rétention ≥ 85 % (20 révisions min). Classement et duel : aux points.
- **Mises à jour depuis GitHub** (`updater.py`) : au démarrage, Anki compare `multijoueur/version.json`
  au GitHub (`depot_github` dans config.json) et propose d'installer (une fois par version, puis bannière
  dans la fenêtre ; aussi Outils → « chercher une mise à jour »). `user_files/` et `meta.json` sont gardés.

## Travailler à deux sur ce dépôt
- Avant de commencer : `git pull`. En finissant une partie : commit clair en français + `git push`.
- Noter dans « En cours » ci-dessous ce sur quoi on travaille, pour ne pas faire la même chose.
- Une nouvelle décision importante → l'ajouter dans « Décisions déjà prises ».
- **Pour livrer un changement du plugin à l'autre** : augmenter `version` de 1 dans `multijoueur/version.json`
  et écrire `nouveautes` en une phrase simple, puis commit + push sur `main`. Sans ça, personne n'est prévenu.

## Fait (v1, 2026-10-01)
1 classement semaine, 2 multi-critères, 3 régularité, 5 records, 7 duel, 15 objectif commun,
16 série de groupe, 19 fil d'activité, 20 réactions, 21 statut en direct, 24 profil,
28 graphique, 29 carte de chaleur.
v2 (Xyroob) : objectif automatique, points équitables, mises à jour depuis GitHub.

## Reste à faire (choisi)
6 bilan mensuel, 9 course à l'objectif, 12 paris amicaux, 14 boss d'équipe, 17 encourager d'un clic,
interface plus belle et plus intuitive, 8 défi sur mesure, 11 défi zéro retard, 13 saisons, 22 pomodoro synchronisé, 23 messages courts,
25 badges de groupe, 26 points multijoueur, 27 trophées de saison.

## En cours
- (personne)

## Pour Claude
- Plugin Anki (Python 3.13, Qt6 via `aqt`). Pas de pip dans Anki : seulement la bibliothèque
  standard (`urllib`) pour parler à Supabase.
- Les requêtes réseau ne doivent jamais bloquer Anki (fil d'arrière-plan, délais courts, et le
  plugin doit marcher hors ligne en gardant les envois en attente).
- Toujours tester avant de dire que c'est fini, et l'expliquer simplement à l'utilisateur.
