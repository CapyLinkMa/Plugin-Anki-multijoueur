"""The add-on's brain, Qt-free: keeps what was last fetched from the group,
syncs this player's numbers, and answers the window's requests.

Collection reads happen on Anki's main thread (collect()); every network
call goes through `run_bg(task, on_done)` so Anki never freezes on a slow
connection. Offline, nothing is lost: the next sync re-sends the days.
"""

import datetime
import json
import os

from . import group
from . import metrics
from .server import ServerError

FIRST_SYNC_DAYS = 365
SYNC_DAYS = 14
AVATARS = ["🙂", "🦫", "🦊", "🐼", "🐸", "🦉", "🐙", "🦄", "🐯", "🐨", "🐧", "🦖", "🧠", "🫀", "🫁", "🧬", "🔬", "💊", "🩺", "📚"]


class MultiAPI:
    def __init__(self, server, col_getter, store_path, run_bg=None, now=None):
        self.server = server
        self.col_getter = col_getter
        self.store_path = store_path
        self.run_bg = run_bg or (lambda task, done: done(task()))
        self.now = now or (lambda: datetime.datetime.now(datetime.timezone.utc))
        self.store = self._load()
        self.cache = {"profile": None, "group": None, "members": [], "days": [], "events": [], "reactions": []}
        self.error = None
        self.syncing = False
        self.listeners = []   # called with the new snapshot after each background sync

    # -- local file -------------------------------------------------------------------------
    def _load(self):
        try:
            with open(self.store_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        data.setdefault("sent", [])
        data.setdefault("first_sync_done", False)
        return data

    def _save(self):
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
        self.store["sent"] = self.store["sent"][-500:]
        with open(self.store_path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.store, f)
        os.replace(self.store_path + ".tmp", self.store_path)

    # -- sync -------------------------------------------------------------------------------
    def collect(self):
        """On the main thread: this player's recent days from Anki."""
        col = self.col_getter()
        if col is None:
            return None
        n = SYNC_DAYS if self.store["first_sync_done"] else FIRST_SYNC_DAYS
        return metrics.recent_days(col, n)

    def _network_sync(self, days):
        """In the background: send my days and milestones, fetch the group."""
        srv = self.server
        profile = srv.my_profile()
        out = {"profile": profile, "group": None, "members": [], "days": [], "events": [], "reactions": [],
               "pushed": False, "sent": []}
        if profile is None:
            return out
        if days:
            goal = int(profile.get("daily_goal") or 100)
            srv.push_days([dict(r, goal=goal) for r in days])
            out["pushed"] = True
        if profile.get("group_id"):
            out["group"] = srv.group()
            out["members"] = srv.members()
            since = (datetime.date.today() - datetime.timedelta(days=group.HEATMAP_WEEKS * 7 + 400)).isoformat()
            out["days"] = srv.days_since(since)
            if days:
                mine = {r["day"]: dict(r, goal=int(profile.get("daily_goal") or 100))
                        for r in out["days"] if r["user_id"] == srv.user_id}
                for key, kind, payload in group.milestones(mine, profile, days[-1]["day"], set(self.store["sent"])):
                    srv.post_event(profile["group_id"], kind, payload)
                    out["sent"].append(key)
            out["events"] = srv.events()
            out["reactions"] = srv.reactions([e["id"] for e in out["events"]])
        return out

    def sync(self, on_done=None):
        """Collect now, send and fetch in the background."""
        if self.syncing:
            return False
        try:
            days = self.collect()
        except Exception:
            days = None
        self.syncing = True

        def task():
            try:
                return {"ok": True, "data": self._network_sync(days)}
            except ServerError as exc:
                return {"ok": False, "error": str(exc)}

        def done(result):
            self.syncing = False
            if result["ok"]:
                data = result["data"]
                self.error = None
                for key in ("profile", "group", "members", "days", "events", "reactions"):
                    self.cache[key] = data[key]
                if data["pushed"]:
                    self.store["first_sync_done"] = True
                self.store["sent"] += data["sent"]
                self.store["last_sync"] = self.now().isoformat(timespec="seconds")
                self._save()
            else:
                self.error = result["error"]
            snap = self.snapshot()
            for listener in list(self.listeners):
                listener(snap)
            if on_done:
                on_done(snap)

        self.run_bg(task, done)
        return True

    def set_studying(self):
        """Called while reviewing (throttled by the caller): 'en train d'étudier'."""
        self.run_bg(lambda: self._quiet(lambda: self.server.set_status("study")), lambda _r: None)

    @staticmethod
    def _quiet(fn):
        try:
            return fn()
        except ServerError:
            return None

    # -- what the window shows -----------------------------------------------------------------
    def snapshot(self):
        c = self.cache
        me = self.server.user_id
        today = None
        col = self.col_getter()
        if col is not None:
            try:
                today = metrics.day_date(col, col.sched.today)
            except Exception:
                today = None
        today = today or datetime.date.today().isoformat()
        view = group.build(c["members"], c["days"], today, me, self.now()) if c["group"] else None
        names = {m["id"]: {"pseudo": m["pseudo"], "avatar": m.get("avatar") or "🙂"} for m in c["members"]}
        reactions = {}
        for r in c["reactions"]:
            entry = reactions.setdefault(r["event_id"], {})
            who = entry.setdefault(r["emoji"], [])
            who.append(names.get(r["user_id"], {}).get("pseudo", "?"))
        feed = [{"id": e["id"], "kind": e["kind"], "payload": e.get("payload") or {}, "at": e["created_at"],
                 "who": names.get(e["user_id"], {"pseudo": "Ancien membre", "avatar": "👤"}),
                 "mine": e["user_id"] == me,
                 "reactions": reactions.get(e["id"], {}),
                 "my_reactions": [r["emoji"] for r in c["reactions"] if r["event_id"] == e["id"] and r["user_id"] == me]}
                for e in c["events"]]
        return {"profile": c["profile"], "group": c["group"], "view": view, "feed": feed, "me": me,
                "error": self.error, "syncing": self.syncing, "last_sync": self.store.get("last_sync"),
                "avatars": AVATARS, "emojis": ["👏", "🔥", "💪", "😮", "❤️"], "ready": bool(self.store.get("last_sync"))}

    # -- the window's requests ---------------------------------------------------------------------
    def call(self, name, payload=None):
        handler = getattr(self, f"do_{name}", None)
        if handler is None:
            return {"ok": False, "error": f"Action inconnue : {name}"}
        try:
            out = handler(**(payload or {}))
        except ServerError as exc:
            return {"ok": False, "error": str(exc), "snapshot": self.snapshot()}
        out.setdefault("ok", True)
        out.setdefault("snapshot", self.snapshot())
        return out

    def do_snapshot(self):
        return {}

    def do_refresh(self):
        return {"started": self.sync()}

    def do_save_profile(self, pseudo, avatar, daily_goal, program=""):
        pseudo = (pseudo or "").strip()[:24]
        if not pseudo:
            return {"ok": False, "error": "Choisis un pseudo."}
        try:
            goal = int(daily_goal)
        except (TypeError, ValueError):
            return {"ok": False, "error": "L'objectif doit être un nombre de cartes."}
        if not 10 <= goal <= 5000:
            return {"ok": False, "error": "Objectif entre 10 et 5 000 cartes par jour."}
        self.cache["profile"] = self.server.save_profile(pseudo, avatar if avatar in AVATARS else "🙂", goal,
                                                         (program or "").strip()[:40])
        self.store["first_sync_done"] = False  # re-send the history with the new goal
        self.sync()
        return {}

    def do_create_group(self, name):
        name = (name or "").strip()[:40]
        if not name:
            return {"ok": False, "error": "Donne un nom au groupe."}
        code = self.server.create_group(name)
        self.sync()
        return {"code": code}

    def do_join_group(self, code):
        code = (code or "").strip().upper()
        if len(code) != 6:
            return {"ok": False, "error": "Le code d'un groupe a 6 caractères."}
        name = self.server.join_group(code)
        self.sync()
        return {"name": name}

    def do_leave_group(self):
        self.server.leave_group()
        for key in ("group", "members", "days", "events", "reactions"):
            self.cache[key] = None if key == "group" else []
        self.sync()
        return {}

    def do_react(self, event_id, emoji, on=True):
        self.server.react(event_id, emoji, bool(on))
        self.sync()
        return {}
