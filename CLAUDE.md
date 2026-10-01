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
  Projet Supabase pas encore créé.
- **Vie privée** : on n'envoie que des chiffres d'étude et un pseudo, jamais le contenu des cartes.
- **Langue** : interface en français. Les deux utilisateurs ne sont pas développeurs : leur
  expliquer simplement, sans jargon.
- Fonctionnalités : à choisir ensemble dans `FONCTIONNALITES.md` (cocher la liste).

## Travailler à deux sur ce dépôt
- Avant de commencer : `git pull`. En finissant une partie : commit clair en français + `git push`.
- Noter dans « En cours » ci-dessous ce sur quoi on travaille, pour ne pas faire la même chose.
- Une nouvelle décision importante → l'ajouter dans « Décisions déjà prises ».

## En cours
- (personne)

## Pour Claude
- Plugin Anki (Python 3.13, Qt6 via `aqt`). Pas de pip dans Anki : seulement la bibliothèque
  standard (`urllib`) pour parler à Supabase.
- Les requêtes réseau ne doivent jamais bloquer Anki (fil d'arrière-plan, délais courts, et le
  plugin doit marcher hors ligne en gardant les envois en attente).
- Toujours tester avant de dire que c'est fini, et l'expliquer simplement à l'utilisateur.
