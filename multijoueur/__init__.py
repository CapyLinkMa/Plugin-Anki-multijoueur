"""👥 Anki Multijoueur - study together at a distance: rankings, weekly
duel, group goals, activity feed. Reads only Anki's own numbers (works next
to any other add-on) and shares them with your group's Supabase server.

Module map: metrics.py (Anki numbers) · server.py (Supabase over HTTP) · games.py (défis, paris, saisons…) ·
group.py (rankings, duel, streaks: pure) · api.py (sync + window requests) ·
window.py + web/ (the window) · updater.py (updates from GitHub).
"""

import os
import time
import traceback

from aqt import gui_hooks, mw
from aqt.qt import QAction, QTimer
from aqt.utils import askUser, showInfo, showWarning, tooltip

from . import updater
from .api import MultiAPI
from .server import Server

ADDON_DIR = os.path.dirname(__file__)
USER_FILES = os.path.join(ADDON_DIR, "user_files")
STATUS_EVERY = 120      # seconds between two "en train d'étudier" pings
SYNC_AFTER_CARDS = 300  # seconds between two syncs while reviewing
UPDATE_CHECK_DELAY = 8  # seconds after Anki opens: let it start in peace first

_api = None
_window = None
_timer = None
_pomo_timer = None
_last = {"status": 0.0, "sync": 0.0}
_installing = [False]


def _config():
    return mw.addonManager.getConfig(__name__) or {}


def _run_bg(task, done):
    mw.taskman.run_in_background(task, lambda fut: done(fut.result()))


def get_api():
    global _api
    if _api is None:
        cfg = _config()
        server = Server(cfg.get("supabase_url", ""), cfg.get("supabase_key", ""),
                        os.path.join(USER_FILES, "session.json"))
        _api = MultiAPI(server, lambda: mw.col, os.path.join(USER_FILES, "state.json"), run_bg=_run_bg)
        _api.on_install_update = install_update
    return _api


def _safe(fn):
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            traceback.print_exc()
    return wrapper


def _refresh_window():
    api = get_api()
    snap = api.snapshot()
    for listener in list(api.listeners):
        listener(snap)


def _in_background(fn):
    """Runs fn in the background -> {"ok", "value"} or {"ok": False, "error"}."""
    def task():
        try:
            return {"ok": True, "value": fn()}
        except updater.UpdateError as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:  # never let an update problem break Anki
            traceback.print_exc()
            return {"ok": False, "error": f"Erreur inattendue : {exc}"}
    return task


@_safe
def check_update(manual=False):
    """Asks GitHub for a newer version: offered once per version at start
    (then only a banner in the window), every time when asked from the menu."""
    repo = (_config().get("depot_github") or "").strip()

    def done(res):
        if not res["ok"]:
            if manual:
                showWarning(res["error"], title="Multijoueur")
            return
        api = get_api()
        api.update = info = res["value"]
        _refresh_window()
        if not info:
            if manual:
                tooltip("👥 Multijoueur : tu as déjà la dernière version ✅")
            return
        if not manual and api.store.get("update_asked") == info["version"]:
            return
        api.store["update_asked"] = info["version"]
        api._save()
        news = (info.get("nouveautes") or "").strip()
        if askUser("👥 Une mise à jour du Multijoueur est disponible !\n\n"
                   + (f"Nouveautés : {news}\n\n" if news else "")
                   + "L'installer maintenant ? (Il faudra ensuite redémarrer Anki.)", title="Multijoueur"):
            install_update()

    _run_bg(_in_background(lambda: updater.available(ADDON_DIR, repo)), done)


@_safe
def install_update():
    if _installing[0]:
        return
    _installing[0] = True
    repo = (_config().get("depot_github") or "").strip()

    def done(res):
        _installing[0] = False
        if res["ok"]:
            get_api().update = None
            _refresh_window()
            showInfo("✅ Mise à jour du Multijoueur installée.\n\nFerme Anki et rouvre-le pour l'utiliser.",
                     title="Multijoueur")
        else:
            showWarning("La mise à jour n'a pas pu s'installer :\n" + res["error"], title="Multijoueur")

    tooltip("👥 Téléchargement de la mise à jour…")
    _run_bg(_in_background(lambda: updater.install(ADDON_DIR, repo)), done)


@_safe
def _sync():
    _last["sync"] = time.time()
    get_api().sync()


@_safe
def open_window():
    global _window
    from .window import GroupWindow
    api = get_api()
    if _window is not None:
        _window.raise_()
        _window.activateWindow()
        return
    _window = GroupWindow(mw, api)
    _window.finished.connect(_on_closed)
    _window.show()
    api.sync()


def _on_closed(_result=None):
    global _window
    _window = None


@_safe
def _pomo_tick():
    """The shared pomodoro's "Pause !" / "Au travail !" in Anki, window open or not."""
    api = get_api()
    text = api.pomodoro_alert()
    if text and _window is None:
        tooltip(text, period=6000)


@_safe
def _on_profile_open():
    global _api, _timer, _pomo_timer
    _api = None
    QTimer.singleShot(3000, _sync)
    QTimer.singleShot(UPDATE_CHECK_DELAY * 1000, check_update)
    if _timer is None:
        _timer = QTimer(mw)
        _timer.timeout.connect(_sync)
    _timer.start(max(2, int(_config().get("sync_minutes", 10))) * 60 * 1000)
    if _pomo_timer is None:
        _pomo_timer = QTimer(mw)
        _pomo_timer.timeout.connect(_pomo_tick)
        _pomo_timer.start(5000)


@_safe
def _on_answer(*_args):
    now = time.time()
    if now - _last["status"] > STATUS_EVERY:
        _last["status"] = now
        get_api().set_studying()
    if now - _last["sync"] > SYNC_AFTER_CARDS:
        _sync()


@_safe
def _on_state_change(new_state, old_state):
    if old_state == "review" and new_state in ("overview", "deckBrowser"):
        _sync()


@_safe
def _on_sync_finish():
    """Reviews done on the phone (no add-on there) arrive with Anki's sync:
    send them right away."""
    _sync()


def _on_toolbar(links, toolbar):
    links.append(toolbar.create_link("anki-multijoueur", "👥", open_window, tip="Multijoueur", id="anki-multijoueur"))


def _setup_menu():
    action = QAction("👥 Multijoueur", mw)
    action.triggered.connect(open_window)
    mw.form.menuTools.addAction(action)
    check = QAction("👥 Multijoueur : chercher une mise à jour", mw)
    check.triggered.connect(lambda: check_update(manual=True))
    mw.form.menuTools.addAction(check)


if mw is not None:
    gui_hooks.profile_did_open.append(_on_profile_open)
    gui_hooks.reviewer_did_answer_card.append(_on_answer)
    gui_hooks.state_did_change.append(_on_state_change)
    gui_hooks.sync_did_finish.append(_on_sync_finish)
    gui_hooks.top_toolbar_did_init_links.append(_on_toolbar)
    _setup_menu()
