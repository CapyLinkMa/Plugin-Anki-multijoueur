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
  Joueurs = comptes anonymes Supabase Auth (session dans `multijoueur/user_files/`, jamais dans git).
- **Vie privée** : on n'envoie que des chiffres d'étude et un pseudo, jamais le contenu des cartes.
- **Langue** : interface en français. Les deux utilisateurs ne sont pas développeurs : leur
  expliquer simplement, sans jargon.
- **Programmes différents** : l'un est en médecine, l'autre au bac en biologie. Pas de paquet
  commun, des volumes de cartes différents. Donc les classements et défis doivent être **équitables** :
  comparer surtout des pourcentages de son propre objectif, la régularité, la rétention et le
  vidage de ses retards, pas seulement le nombre brut de cartes. Chacun fixe son objectif quotidien.
- Fonctionnalités choisies (2026-10-01, côté CapyLinkMa) : cochées dans `FONCTIONNALITES.md` :
  1, 2, 3, 5, 7, 8, 11, 13, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29.
  En attente de l'avis de Xyroob.

## Travailler à deux sur ce dépôt
- Avant de commencer : `git pull`. En finissant une partie : commit clair en français + `git push`.
- Noter dans « En cours » ci-dessous ce sur quoi on travaille, pour ne pas faire la même chose.
- Une nouvelle décision importante → l'ajouter dans « Décisions déjà prises ».

## Fait (v1, 2026-10-01)
1 classement semaine, 2 multi-critères, 3 régularité, 5 records, 7 duel, 15 objectif commun,
16 série de groupe, 19 fil d'activité, 20 réactions, 21 statut en direct, 24 profil,
28 graphique, 29 carte de chaleur.

## Reste à faire (choisi)
8 défi sur mesure, 11 défi zéro retard, 13 saisons, 22 pomodoro synchronisé, 23 messages courts,
25 badges de groupe, 26 points multijoueur, 27 trophées de saison.

## En cours
- (personne)

## Pour Claude
- Plugin Anki (Python 3.13, Qt6 via `aqt`). Pas de pip dans Anki : seulement la bibliothèque
  standard (`urllib`) pour parler à Supabase.
- Les requêtes réseau ne doivent jamais bloquer Anki (fil d'arrière-plan, délais courts, et le
  plugin doit marcher hors ligne en gardant les envois en attente).
- Toujours tester avant de dire que c'est fini, et l'expliquer simplement à l'utilisateur.
