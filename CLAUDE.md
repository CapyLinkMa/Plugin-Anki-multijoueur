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
  Xyroob : d'accord, et ajoute 6, 9, 12, 14, 17.
- **Interface v3** (2026-10-01, maquette de Xyroob) : onglets Accueil (duel en grand avec anneaux du jour,
  « ta journée », tes points du jour, série + objectif commun) · Classement · Stats · Activité ; le profil
  derrière le bouton avatar en haut. Une couleur par joueur partout : toi = ambre, les autres = bleu puis
  d'autres teintes. Polices Sora (titres) + DM Sans (texte), avec repli système hors ligne.
  Onglet « Défis » ajouté en v4 (5 onglets).
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
- **Défis, paris, saisons, badges, points multijoueur, pomodoro, messages** (v4, 2026-10-01, `games.py`) :
  tout passe par la table `events` (genre + JSON), **sans changer le schéma** ; les résultats ne sont jamais
  stockés, chaque ordinateur les recalcule à partir des `days` et des événements (mêmes chiffres partout).
  Genres : `challenge`, `bet`, `bet_accept`, `bet_decline`, `cancel`, `pomo`, `pomo_join`, `pomo_stop`,
  `frame`, `msg`. Équité : défis de groupe et paris en points (`group.day_points`) ou journées finies ;
  un objectif en cartes seulement pour un défi perso (« juste moi », sans récompense).
  Récompenses proportionnelles à l'objectif (`games.REWARD`) et au plus 4 défis en même temps
  (sinon ignorés) : pas de « farm ». Points multijoueur = points des journées depuis la création du groupe
  + défis réussis (→ titres et cadres, ne baissent jamais) ; porte-monnaie des paris = 50 de départ + ça
  ± paris. Saison = mois (points des journées) ; à la fin : 🥇🥈🥉, 📅 plus régulier, 🧠 meilleure rétention ;
  un 🥇 débloque le cadre « Champion·ne ». La fenêtre se rafraîchit seule toutes les 30 s (`api.poll`,
  sans lire Anki) ; l'alerte du pomodoro s'affiche aussi dans Anki fenêtre fermée.

- **Présence et bulles pendant les révisions** (v5, 2026-10-03, Xyroob) : toutes les 45 s (`api.live_check`,
  2 petites requêtes en arrière-plan), un point discret (`web/presence.*`, injecté dans l'écran de révision) montre
  qui révise depuis moins de 5 min (`LIVE_DOT_MINUTES`) ; en quittant les révisions on passe en statut `idle`.
  Les nouveaux `msg` et les « Encourager » qui me sont adressés s'affichent en bulle (infobulle Anki hors révisions,
  rien si la fenêtre est ouverte). Dernier événement vu : `msg_seen` dans `state.json` ; un message de plus de 30 min
  n'est pas montré. Réglages : `indicateur_revisions`, `indicateur_coin`. Schéma inchangé.
- **v6** (2026-10-05, CapyLinkMa) : **notifications à gauche par défaut** (les casinos sont à droite) : coin
  `haut-gauche` pour les bulles/le point pendant les révisions, et toasts de la fenêtre en bas à gauche
  (les infobulles d'Anki sont déjà en bas à gauche). **Réglages par ordinateur** dans la fenêtre (avatar →
  Réglages : point, bulles, minuteur, son, coin), gardés dans `state.json` (`settings`) ; config.json ne donne
  que les valeurs par défaut. Bulles aussi pour un pari qui m'est proposé, un nouveau défi, un pomodoro lancé ;
  **cliquables** (`pycmd("mjlive:…")` → ouvre la fenêtre sur le bon onglet, ou rejoint le pomodoro).
  **Minuteur du pomodoro** pendant les révisions. Fenêtre : carte « À faire » (paris à accepter, pomodoro à
  rejoindre, défis qui finissent), **historique des duels** (`games.duel_history`), carte « Résultats »
  dans Activité (`games.moments` : défis finis, paris réglés, duels, saisons, calculés, jamais postés),
  **défis rapides** en un clic, pastille de non-lus sur Activité (`feed_seen`). `snapshot()` garde en mémoire
  les calculs tant que rien n'a changé (`api._computed`).

- **v7** (2026-10-05, Xyroob) : **messages écrits librement** (`msg` avec `{text}` au lieu de `{code}`, 300 caractères
  max, `games.clean_message` / `games.message_text` ; les messages rapides restent), limite anti-spam 150/jour.
  Point « il/elle révise » plus visible (8 px, halo qui respire, pastille plus opaque). Minuteur du pomodoro :
  barre de progression, petit « ping » au changement de phase, un clic le réduit à 🍅 (retenu dans le
  `localStorage` de l'écran de révision). Schéma inchangé.

- **v8** (2026-10-06, CapyLinkMa) : **frappe plus fluide**. La zone de message ne recalcule plus sa hauteur à chaque
  touche (`field-sizing: content`, repli JS seulement si le texte déborde ou rétrécit). Le halo du point vert est animé
  en `transform`/`opacity` (plus de `box-shadow` redessiné à chaque image) et se met en pause (`mj-typing`) quand une
  zone de texte de l'écran de révision a le focus : dans Anki, une animation sans fin retarde un peu les touches.

- **v9** (2026-10-08, Xyroob) : **points plus équitables**. Constat sur nos vraies données : « ce qu'Anki demande »
  comptait les vieux retards (paquets plus ouverts) et la somme des limites de nouvelles cartes de tous les paquets,
  donc personne ne finissait jamais sa journée (8 pts sur 18 jamais gagnés) et celui qui avait le plus de retards
  était écrasé. Maintenant l'objectif (`api.note_target`, `targets[jour].goal` en cartes distinctes) = révisions dues
  **aujourd'hui** (`metrics.due_today`, limites d'Anki comprises) + nouvelles cartes au plus à **son rythme**
  (moyenne des 14 derniers jours étudiés, `api.new_card_pace`). Retards rattrapés et nouvelles en plus → au-delà de
  100 %. Bonus retards : zéro retard **ou** au moins 5 % de moins que la veille (`group.backlog_ok`). Rétention :
  ≥ 85 % **ou** ≥ sa propre moyenne des 4 semaines d'avant (`group.retention_bar`). Jour vu seulement sur téléphone :
  objectif habituel (médiane des 14 jours d'avant) au lieu de l'objectif du profil. Schéma inchangé.
  **Fiche joueur** dans Stats (`group.recent`, `group.averages`) : aujourd'hui, moyennes sur 7 jours avec tendance et
  comparaison avec moi, barres des cartes par jour, tableau des 14 derniers jours (points détaillés au survol).

- **v10** (2026-10-08, Xyroob) : **pomodoro en anneau** (SVG qui se referme autour de 🍅/☕, rouge travail, vert pause,
  lueur la dernière minute ; réduit = l'anneau seul). **Course en direct** pendant les révisions, seulement quand un
  ami révise en même temps : une fine ligne avec chaque avatar à son **% de journée** (équitable, pas les cartes),
  détails au survol, un mot de 5 s seulement quand quelqu'un passe devant ou qu'on finit sa journée. Le % et les
  cartes voyagent dans `profiles.status` (`study:<pct>:<cartes>`, `group.live_status` / `live_progress`, envoyé toutes
  les 60 s pendant les révisions) : schéma inchangé, un ancien plugin qui envoie « study » reste « il révise ».
  Réglage `race`. **Mises à jour faciles à trouver** : flèche ⬆️ en haut de la fenêtre (point rouge s'il y en a une),
  carte « Mise à jour du plugin » dans le profil, et lien « ⬆️ Mise à jour » dans la barre du haut d'Anki quand une
  mise à jour attend.

- **v11** (2026-10-08, Xyroob) : la course en direct compare le **paquet en cours** (pas la journée) :
  `metrics.deck_progress` = cartes distinctes finies aujourd'hui dans le paquet sélectionné (+ sous-paquets) ÷
  (finies + restantes selon `col.sched.counts()`, apprentissage exclu). Statut `study:<pct>:<restantes>:p` (le « p »
  le distingue du format v10). Un mot de 5 s quand quelqu'un passe devant ou finit son paquet. Le nom du paquet
  n'est pas envoyé.

- **Jeu « Arène »** (2026-10-08, Xyroob) : page web à part dans `jeu/`, **sans lien avec le plugin ni avec l'étude**
  (aucun besoin de changer `version.json`). Combat en arène façon LoL, 2 à 4 joueurs (bots pour compléter),
  monnaie fictive remise à zéro à chaque partie : casino (machine à sous, roulette) et boîtes surprises entre les manches,
  « tapis » et « quitte ou double » pendant les manches. L'ordinateur de l'hôte fait tourner la partie (`jeu/sim.js`) ;
  tout passe par Supabase Realtime (canal `arene-<CODE>`, messages diffusés, **rien dans la base, schéma inchangé**).
  `?local` dans l'adresse = test entre onglets sans Internet.

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
v3 (Xyroob) : nouvelle interface, 17 encourager d'un clic (+ « Féliciter » = 👏 sur sa journée finie).
v4 (CapyLinkMa) : 6 bilan mensuel, 8 défi sur mesure, 9 course, 11 zéro retard, 12 paris, 13 saisons,
14 boss d'équipe, 22 pomodoro synchronisé, 23 messages courts, 25 badges de groupe, 26 points/titres/cadres,
27 trophées de saison.
v5 (Xyroob) : point « il/elle révise » et bulles de messages pendant les révisions.
v6 (CapyLinkMa) : notifications à gauche, réglages, bulles cliquables + minuteur, À faire, historique des duels,
résultats, défis rapides, non-lus.
v7 (Xyroob) : messages écrits librement, point vert plus visible, minuteur du pomodoro réductible.
v8 (CapyLinkMa) : frappe plus fluide (zone de message, point vert en pause pendant qu'on tape).
v9 (Xyroob) : points plus équitables (journée sans les vieux retards, nouvelles à son rythme), fiche joueur dans Stats.
v10 (Xyroob) : pomodoro en anneau, course en direct pendant les révisions, bouton de mise à jour dans la fenêtre.
v11 (Xyroob) : course en direct sur le paquet qu'on fait (% et cartes restantes).

## Reste à faire (choisi)
Tout ce qui a été choisi est fait. Idées non choisies : 4, 10, 18, 30, et 31-33 (pont vers les casinos).

## En cours
- (personne)

## Pour Claude
- Plugin Anki (Python 3.13, Qt6 via `aqt`). Pas de pip dans Anki : seulement la bibliothèque
  standard (`urllib`) pour parler à Supabase.
- Les requêtes réseau ne doivent jamais bloquer Anki (fil d'arrière-plan, délais courts, et le
  plugin doit marcher hors ligne en gardant les envois en attente).
- Toujours tester avant de dire que c'est fini, et l'expliquer simplement à l'utilisateur.
