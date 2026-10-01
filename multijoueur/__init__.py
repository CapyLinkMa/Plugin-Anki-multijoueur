"""👥 Anki Multijoueur - study together at a distance: rankings, weekly
duel, group goals, activity feed. Reads only Anki's own numbers (works next
to any other add-on) and shares them with your group's Supabase server.

Module map: metrics.py (Anki numbers) · server.py (Supabase over HTTP) ·
group.py (rankings, duel, streaks: pure) · api.py (sync + window requests) ·
window.py + web/ (the window).
"""

import os
import time
import traceback

from aqt import gui_hooks, mw
from aqt.qt import QAction, QTimer

from .api import MultiAPI
from .server import Server

USER_FILES = os.path.join(os.path.dirname(__file__), "user_files")
STATUS_EVERY = 120      # seconds between two "en train d'étudier" pings
SYNC_AFTER_CARDS = 300  # seconds between two syncs while reviewing

_api = None
_window = None
_timer = None
_last = {"status": 0.0, "sync": 0.0}


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
    return _api


def _safe(fn):
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            traceback.print_exc()
    return wrapper


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
def _on_profile_open():
    global _api, _timer
    _api = None
    QTimer.singleShot(3000, _sync)
    if _timer is None:
        _timer = QTimer(mw)
        _timer.timeout.connect(_sync)
    _timer.start(max(2, int(_config().get("sync_minutes", 10))) * 60 * 1000)


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


def _setup_menu():
    action = QAction("👥 Multijoueur", mw)
    action.triggered.connect(open_window)
    mw.form.menuTools.addAction(action)


if mw is not None:
    gui_hooks.profile_did_open.append(_on_profile_open)
    gui_hooks.reviewer_did_answer_card.append(_on_answer)
    gui_hooks.state_did_change.append(_on_state_change)
    _setup_menu()
