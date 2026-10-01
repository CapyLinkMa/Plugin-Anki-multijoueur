"""Updates from the group's GitHub repository, so nobody has to copy files
by hand. Qt-free (the HTTP getter can be replaced in tests).

The version lives in version.json ({"version": <number>, "nouveautes": "..."}):
whoever pushes a change to multijoueur/ raises the number, and everyone's
Anki offers the update at its next start. Installing downloads the
repository's zip and copies its multijoueur/ folder over this add-on, keeping
user_files/ (session, state) and meta.json (Anki's copy of the settings).
"""

import io
import json
import os
import urllib.error
import urllib.request
import zipfile

TIMEOUT = 15
VERSION_FILE = "version.json"
KEEP = ("user_files", "meta.json", "__pycache__")


class UpdateError(Exception):
    """An update that could not be checked or installed, with a message fit for the player."""


def default_get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-cache"}),
                                    timeout=TIMEOUT) as resp:
            return resp.read()
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise UpdateError("Pas de connexion à GitHub : réessaie plus tard.") from exc


def local_info(addon_dir):
    try:
        with open(os.path.join(addon_dir, VERSION_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"version": 0}


def remote_info(repo, branch="main", get=default_get):
    raw = get(f"https://raw.githubusercontent.com/{repo}/{branch}/multijoueur/{VERSION_FILE}")
    try:
        info = json.loads(raw.decode("utf-8"))
        int(info["version"])
    except (ValueError, KeyError, TypeError) as exc:
        raise UpdateError("Le numéro de version sur GitHub est illisible.") from exc
    return info


def available(addon_dir, repo, branch="main", get=default_get):
    """The newer version's info, or None when this one is up to date."""
    if not repo:
        return None
    remote = remote_info(repo, branch, get)
    return remote if int(remote["version"]) > int(local_info(addon_dir).get("version") or 0) else None


def install(addon_dir, repo, branch="main", get=default_get):
    """Copies the repository's multijoueur/ folder over this add-on. -> the installed version info."""
    data = get(f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UpdateError("Le téléchargement depuis GitHub est abîmé : réessaie.") from exc
    files = {}
    for name in archive.namelist():
        parts = name.split("/")
        # "<repo>-<branch>/multijoueur/<path>"
        if len(parts) < 3 or parts[1] != "multijoueur" or name.endswith("/"):
            continue
        rel = parts[2:]
        if any(p in ("", ".", "..") for p in rel) or rel[0] in KEEP:
            continue
        files[os.path.join(*rel)] = archive.read(name)
    if VERSION_FILE not in files or "__init__.py" not in files:
        raise UpdateError("Le dépôt GitHub ne contient pas le plugin attendu.")
    for rel, content in files.items():   # everything read first: a broken zip changes nothing
        path = os.path.join(addon_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "wb") as f:
            f.write(content)
        os.replace(path + ".tmp", path)
    return json.loads(files[VERSION_FILE].decode("utf-8"))
