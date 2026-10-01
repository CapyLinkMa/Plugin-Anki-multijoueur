# Plugin Anki multijoueur

Étudier ensemble à distance avec Anki : classements équitables (au % de son propre objectif),
duel de la semaine, objectif commun, série de groupe, fil d'activité avec réactions, statut
« en train d'étudier », graphiques et carte de chaleur, records. Fonctionne à côté de
n'importe quel autre plugin : il ne lit que les chiffres d'Anki.

## Installer (chaque joueur)
1. Copier le dossier `multijoueur/` dans le dossier des plugins d'Anki
   (Anki → Outils → Modules complémentaires → « Afficher les fichiers »), sous le nom `anki_multijoueur`.
2. Redémarrer Anki → menu **Outils → 👥 Multijoueur** : créer son profil, puis créer ou rejoindre un groupe
   (code à 6 caractères).

## Serveur (une seule fois, déjà fait pour notre groupe)
Projet Supabase gratuit : coller `supabase/schema.sql` dans SQL Editor → Run, et activer
Authentication → Sign In / Providers → « Allow anonymous sign-ins », et désactiver « Confirm email »
(les comptes sécurisés sont nom d'utilisateur + mot de passe, sans courriel).

## Développement
- Tests : `python -m unittest discover tests` (avec Anki : `PYTHONPATH=/Applications/Anki.app/Contents/Resources/app_packages`).
- Aperçu dans un navigateur avec de faux joueurs : `python tools/dev_server.py` → http://localhost:8790
- Voir `CLAUDE.md` (décisions) et `FONCTIONNALITES.md` (liste choisie).
