"""The add-on's brain, Qt-free: keeps what was last fetched from the group,
syncs this player's numbers, and answers the window's requests.

Collection reads happen on Anki's main thread (collect()); every network
call goes through `run_bg(task, on_done)` so Anki never freezes on a slow
connection. Offline, nothing is lost: the next sync re-sends the days.
"""

import datetime
import json
import os
import re

from . import games
from . import group
from . import metrics
from .server import ServerError

REACTIONS = {"bravo": "👏", "feu": "🔥", "force": "💪", "wow": "😮", "coeur": "❤️"}   # stored code -> shown emoji
REACTION_CODES = {v: k for k, v in REACTIONS.items()}
USERNAME = re.compile(r"[a-z0-9._-]{3,24}")
FIRST_SYNC_DAYS = 365
SYNC_DAYS = 14   # re-sent every time: reviews synced in later from a phone (no add-on there) are caught up
TARGET_DAYS_KEPT = 400   # a resend of old days (new profile goal) must find the same goals
PACE_DAYS = 14           # the new-card part of the goal: one's own pace over the last 14 days
LOCAL_KEYS = ("done", "rev_done")   # read from Anki to build the goal, never sent
LIVE_DOT_MINUTES = 5        # the little dot during reviews: someone counts as studying if seen in the last 5 min
FRESH_MESSAGE_MINUTES = 30  # messages older than that (Anki was closed) are only marked as seen, not shown
LIVE_KINDS = ("msg", "encourage", "bet", "challenge", "pomo")   # what can pop up as a bubble
CORNERS = ("haut-gauche", "bas-gauche", "haut-droite", "bas-droite")
SETTINGS = {                 # this computer's choices (Profil → Réglages), kept in user_files/state.json
    "presence": True,        # the little dot "X révise" during reviews
    "bubbles": True,         # the bubbles (messages, défis, paris, pomodoro) during reviews
    "corner": "haut-gauche", # on the left: the casinos live on the right
    "pomo_pill": True,       # the pomodoro timer during reviews
    "sound": True,           # a short sound when the pomodoro changes phase
    "race": True,            # the live race during reviews (% of one's day), when a friend studies at the same time
}
KEPT_ON_SIGN_IN = ("targets", "settings", "msg_seen", "feed_seen")
AVATARS = ["🙂", "🦫", "🦊", "🐼", "🐸", "🦉", "🐙", "🦄", "🐯", "🐨", "🐧", "🦖", "🧠", "🫀", "🫁", "🧬", "🔬", "💊", "🩺", "📚"]


class MultiAPI:
    def __init__(self, server, col_getter, store_path, run_bg=None, now=None):
        self.server = server
        self.col_getter = col_getter
        self.store_path = store_path
        self.run_bg = run_bg or (lambda task, done: done(task()))
        self.now = now or (lambda: datetime.datetime.now(datetime.timezone.utc))
        self.store = self._load()
        self.cache = {"profile": None, "group": None, "members": [], "days": [], "events": [], "reactions": [],
                      "game_events": []}
        self.error = None
        self.syncing = False
        self.listeners = []   # called with the new snapshot after each background sync
        self.live_busy = False
        self.defaults = dict(SETTINGS)  # __init__.py may adjust them from config.json
        self._memo = (None, None)
        self.update = None              # {"version", "nouveautes"} when GitHub has a newer version
        self.on_install_update = None   # set by __init__.py (needs Qt)
        self.on_check_update = None     # set by __init__.py: asks GitHub, then sets update_check and refreshes
        self.update_check = None        # what the window shows: "checking", "latest" or an error message
        self.version = None             # this add-on's version number (version.json), set by __init__.py
        self.on_settings = None         # set by __init__.py: re-dress the review screen at once
        self.open_tab = None            # the tab the window opens on (a click on a bubble)

    # -- local file -------------------------------------------------------------------------
    def _load(self):
        try:
            with open(self.store_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        data.setdefault("sent", [])
        data.setdefault("first_sync_done", False)
        data.setdefault("targets", {})
        return data

    def _save(self):
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
        self.store["sent"] = self.store["sent"][-500:]
        with open(self.store_path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.store, f)
        os.replace(self.store_path + ".tmp", self.store_path)

    # -- réglages ----------------------------------------------------------------------------
    def settings(self):
        out = dict(self.defaults)
        out.update({k: v for k, v in (self.store.get("settings") or {}).items() if k in SETTINGS})
        if out["corner"] not in CORNERS:
            out["corner"] = SETTINGS["corner"]
        return out

    def do_save_settings(self, **values):
        clean = {}
        for key, value in values.items():
            if key not in SETTINGS:
                continue
            if key == "corner":
                if value not in CORNERS:
                    return {"ok": False, "error": "Coin inconnu."}
                clean[key] = value
            else:
                clean[key] = bool(value)
        self.store.setdefault("settings", {}).update(clean)
        self._save()
        if self.on_settings:
            self.on_settings(self.settings())
        return {}

    # -- sync -------------------------------------------------------------------------------
    def collect(self):
        """On the main thread: this player's recent days from Anki."""
        col = self.col_getter()
        if col is None:
            return None
        days = metrics.recent_days(col, self.days_to_send())
        try:
            rev_left, new_left = metrics.due_parts(col)
            self.note_target(days[-1], rev_left, new_left, metrics.due_today(col), self.new_card_pace(days))
        except Exception:
            pass   # no automatic goal this time: the last one seen today (or the profile's) is used
        return days

    @staticmethod
    def new_card_pace(days):
        """New cards a day, on average, on the days studied in the last two
        weeks (today left out): the new-card part of the goal. Anki's own
        limits add up over every deck (often hundreds a day that nobody
        does), which made the goal impossible and the % meaningless."""
        studied = [r["new_cards"] for r in days[-PACE_DAYS - 1:-1] if (r.get("cards") or 0) > 0]
        return round(sum(studied) / len(studied)) if studied else None

    def note_target(self, today, rev_left, new_left=0, due_today=None, pace=None):
        """Remembers today's goal in distinct cards, and the backlog: the next
        days only re-send numbers read from the review log, which knows
        neither. The goal is *today's* work, so that an old backlog (or a
        deck nobody opens any more) doesn't make the day impossible:
          - reviews due today (done or still due), within Anki's limits;
          - new cards: what Anki offers, at most one's own usual pace.
        Overdue cards caught up and extra new cards go beyond 100 %."""
        targets = self.store.setdefault("targets", {})
        old = targets.get(today["day"]) or {}
        overdue = today.get("overdue")
        seen = [x for x in (old.get("overdue_peak"), old.get("overdue"), overdue) if x is not None]
        peak = max(seen) if seen else None
        done = today.get("done") or 0
        rev_done = min(done, today.get("rev_done", done) or 0)
        new_asked = done - rev_done + new_left
        fresh = rev_done + rev_left
        if due_today is not None:
            caught_up = max(0, (peak or 0) - (overdue or 0))   # overdue cards done today
            fresh = min(fresh, due_today + max(0, rev_done - caught_up))
        goal = fresh + (new_asked if pace is None else min(new_asked, pace))
        targets[today["day"]] = {"total": done + rev_left + new_left, "overdue": overdue, "overdue_peak": peak,
                                 "goal": goal}
        for day in sorted(targets)[:-TARGET_DAYS_KEPT]:
            del targets[day]
        self._save()

    def _distinct_goal(self, day):
        """The day's goal in distinct cards: the one noted that day; before v9
        (only the total Anki asked was kept), that total minus the backlog;
        a day this computer never saw (phone only), one's usual goal of the
        two weeks before. None: nothing known, the profile's goal is used."""
        targets = self.store.get("targets", {})
        t = targets.get(day)
        if t and t.get("goal") is not None:
            return t["goal"]
        if t and t.get("total"):
            return t["total"] - (t.get("overdue") or 0) if t["total"] > (t.get("overdue") or 0) else t["total"]
        start = (datetime.date.fromisoformat(day) - datetime.timedelta(days=PACE_DAYS)).isoformat()
        usual = sorted(x["goal"] for k, x in targets.items() if start <= k < day and x.get("goal"))
        return usual[len(usual) // 2] if usual else None

    def server_row(self, row, fallback_goal):
        """A day as stored on the server. The server only keeps `cards` and
        `goal`, so the goal is scaled to give cards / goal = distinct cards
        done / distinct cards of the day's goal (the same % for any version
        of the add-on, "À revoir" presses don't count twice)."""
        out = {k: v for k, v in row.items() if k not in LOCAL_KEYS}
        goal = self._distinct_goal(row["day"])
        if goal is None:
            out["goal"] = fallback_goal
            return out
        done = row.get("done") or 0
        scaled = (row.get("cards") or 0) * goal / done if done else goal
        out["goal"] = min(5000, max(10, round(scaled)))
        target = self.store.get("targets", {}).get(row["day"])
        if out.get("overdue") is None and target:
            out["overdue"] = target.get("overdue")
        return out

    def days_to_send(self):
        """14 days normally; everything since the last successful send when
        the add-on wasn't used for a while (another computer, a long break):
        reviews done anywhere arrive through Anki's own sync, so resending
        recent days catches them up."""
        if not self.store["first_sync_done"]:
            return FIRST_SYNC_DAYS
        last = self.store.get("last_push_day")
        if not last:
            return SYNC_DAYS
        gap = (datetime.date.today() - datetime.date.fromisoformat(last)).days + 2
        return max(SYNC_DAYS, min(FIRST_SYNC_DAYS, gap))

    def _network_sync(self, days):
        """In the background: send my days and milestones, fetch the group."""
        srv = self.server
        profile = srv.my_profile()
        out = {"profile": profile, "group": None, "members": [], "days": [], "events": [], "reactions": [],
               "game_events": [], "pushed": False, "sent": []}
        if profile is None:
            return out
        if days:
            goal = int(profile.get("daily_goal") or 100)
            srv.push_days([self.server_row(r, goal) for r in days])
            out["pushed"] = True
        if profile.get("group_id"):
            out["group"] = srv.group()
            out["members"] = srv.members()
            since = (datetime.date.today() - datetime.timedelta(days=group.HEATMAP_WEEKS * 7 + 400)).isoformat()
            out["days"] = srv.days_since(since)
            if days:
                mine = {r["day"]: r for r in out["days"] if r["user_id"] == srv.user_id}
                sent = set(self.store["sent"])
                # today, and yesterday too: a goal reached on the phone late at night still shows up
                for day in [r["day"] for r in days[-2:]]:
                    for key, kind, payload in group.milestones(mine, profile, day, sent):
                        srv.post_event(profile["group_id"], kind, dict(payload, day=day))
                        out["sent"].append(key)
                        sent.add(key)
            out.update(self._fetch_social(out["group"]))
        return out

    def _fetch_social(self, grp):
        """Feed, reactions and the game events (défis, paris, pomodoros...)."""
        srv = self.server
        events = srv.events()
        return {"events": events, "reactions": srv.reactions([e["id"] for e in events]),
                "game_events": srv.game_events(games.GAME_KINDS, self._since(grp))}

    @staticmethod
    def _since(grp):
        start = games.local_day((grp or {}).get("created_at")) if (grp or {}).get("created_at") else None
        return ((start or datetime.date.today()) - datetime.timedelta(days=1)).isoformat()

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
                for key in ("profile", "group", "members", "days", "events", "reactions", "game_events"):
                    self.cache[key] = data[key]
                if data["pushed"]:
                    self.store["first_sync_done"] = True
                    self.store["last_push_day"] = datetime.date.today().isoformat()
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

    def poll(self):
        """Light refresh while the window is open (pomodoro, messages, paris):
        members, feed and game events only, nothing collected from Anki."""
        if self.syncing or not (self.cache.get("profile") or {}).get("group_id"):
            return False
        self.syncing = True

        def task():
            try:
                srv = self.server
                grp = srv.group()
                out = {"group": grp, "members": srv.members() if grp else []}
                if grp:
                    out.update(self._fetch_social(grp))
                return {"ok": True, "data": out}
            except ServerError as exc:
                return {"ok": False, "error": str(exc)}

        def done(result):
            self.syncing = False
            if result["ok"]:
                self.error = None
                self.cache.update(result["data"])
            else:
                self.error = result["error"]
            snap = self.snapshot()
            for listener in list(self.listeners):
                listener(snap)

        self.run_bg(task, done)
        return True

    def my_progress(self):
        """On the main thread: {"pct": % of my day, "cards": cards today}, for the live race."""
        col = self.col_getter()
        if col is None:
            return None
        try:
            row = metrics.recent_days(col, 1)[0]
        except Exception:
            return None
        goal = self._distinct_goal(row["day"])
        if goal:
            pct = 100 * (row.get("done") or 0) / goal
        else:
            pct = 100 * (row.get("cards") or 0) / int((self.cache.get("profile") or {}).get("daily_goal") or 100)
        return {"pct": min(round(pct), round(100 * group.PCT_CAP)), "cards": row.get("cards") or 0}

    def set_studying(self):
        """Called while reviewing (throttled by the caller): 'en train d'étudier',
        with my % of the day and my cards (the others' live race)."""
        mine = self.my_progress()
        status = group.live_status(mine["pct"], mine["cards"]) if mine else "study"
        self.run_bg(lambda: self._quiet(lambda: self.server.set_status(status)), lambda _r: None)

    def set_idle(self):
        """Called when leaving the reviews: the others' dot goes away right away."""
        self.run_bg(lambda: self._quiet(lambda: self.server.set_status("idle")), lambda _r: None)

    def live_check(self, on_done):
        """Every ~45 s while Anki is open: who else is studying right now and the
        short messages written since the last check (two light requests, in the
        background). on_done({"live": [...], "messages": [...]}) on the main thread."""
        if self.live_busy or not (self.cache.get("profile") or {}).get("group_id"):
            return False
        self.live_busy = True
        seen = self.store.get("msg_seen")

        def task():
            try:
                return {"ok": True, "members": self.server.members(),
                        "msgs": self.server.messages_after(seen, LIVE_KINDS)}
            except ServerError:
                return {"ok": False}

        def done(res):
            self.live_busy = False
            if res["ok"]:
                on_done(self.live_view(res["members"], res["msgs"], seen))

        self.run_bg(task, done)
        return True

    def live_view(self, members, msgs, seen):
        """-> {"live": the others studying now, "messages": the new messages to show}."""
        me, now = self.server.user_id, self.now()
        live = [{"pseudo": m["pseudo"], "avatar": m.get("avatar") or "🙂"} for m in members
                if m["id"] != me and group.is_live(m, now, LIVE_DOT_MINUTES)]
        names = {m["id"]: m for m in members}
        shown = []
        if seen is not None:
            for e in msgs:
                payload = e.get("payload") or {}
                text, click = self._notice(e, payload, me)
                if e["user_id"] == me or not text:
                    continue
                try:
                    at = datetime.datetime.fromisoformat(str(e["created_at"]).replace("Z", "+00:00"))
                    if (now - at).total_seconds() > FRESH_MESSAGE_MINUTES * 60:
                        continue
                except ValueError:
                    pass
                who = names.get(e["user_id"]) or {}
                shown.append({"pseudo": who.get("pseudo", "?"), "avatar": who.get("avatar") or "🙂", "text": text,
                              "verb": e.get("kind") != "msg",   # « Slava t'encourage » vs « Slava · Courage… »
                              "click": click})
        if msgs or seen is None:
            self.store["msg_seen"] = max([int(e["id"]) for e in msgs] + [int(seen or 0)])
            self._save()
        if any(e.get("kind") in games.GAME_KINDS for e in msgs) and seen is not None:
            self.poll()       # a new défi / pari / pomodoro: refresh the game data too
        st = self.settings()
        pomo = self.my_pomodoro() if st["pomo_pill"] else None
        return {"live": live if st["presence"] else [], "messages": shown if st["bubbles"] else [],
                "corner": st["corner"], "sound": st["sound"], "race": self.live_race(members, now) if st["race"] else None,
                "pomo": {k: pomo[k] for k in ("id", "start", "work", "rest", "rounds")} if pomo else None}

    def live_race(self, members, now):
        """The race during reviews, when a friend studies at the same time: each
        one's % of their own day (fair between programs), cards for info.
        None when nobody else with a recent add-on is studying."""
        me = self.server.user_id
        others = []
        for m in members:
            prog = group.live_progress(m)
            if m["id"] != me and prog and group.is_live(m, now, LIVE_DOT_MINUTES):
                others.append(dict(prog, pseudo=m["pseudo"], avatar=m.get("avatar") or "🙂"))
        mine = self.my_progress() if others else None
        if not mine:
            return None
        avatar = (self.cache.get("profile") or {}).get("avatar") or "🙂"
        return {"me": dict(mine, avatar=avatar), "others": others}

    @staticmethod
    def _notice(e, payload, me):
        """-> (bubble text, what a click does) for one event, or (None, None)."""
        kind = e.get("kind")
        if kind == "encourage":
            return ("t'encourage ! 💪", "open") if payload.get("to") == me else (None, None)
        if kind == "msg":
            return games.message_text(payload), "open"
        if kind == "bet" and payload.get("opponent") == me:
            return f"te propose un pari de {payload.get('stake')} pts 💰 (clique pour répondre)", "accueil"
        if kind == "challenge" and not payload.get("solo"):
            return "lance un nouveau défi 🎯 (clique pour voir)", "defis"
        if kind == "pomo":
            return "lance un pomodoro 🍅 (clique pour le rejoindre)", f"pomo:{int(e['id'])}"
        return None, None

    def my_pomodoro(self):
        """The shared pomodoro I'm in right now, from what was last fetched, or None."""
        try:
            g = games.Game(self.cache.get("members") or [], [], self.cache.get("game_events") or [],
                           datetime.date.fromisoformat(self.today()), self.server.user_id, now=self.now())
            return next((p for p in g.pomodoros() if p["active"] and self.server.user_id in p["players"]), None)
        except Exception:
            return None

    @staticmethod
    def _quiet(fn):
        try:
            return fn()
        except ServerError:
            return None

    # -- what the window shows -----------------------------------------------------------------
    def today(self):
        col = self.col_getter()
        if col is not None:
            try:
                return metrics.day_date(col, col.sched.today)
            except Exception:
                pass
        return datetime.date.today().isoformat()

    def snapshot(self):
        c = self.cache
        me = self.server.user_id
        today = self.today()
        view, game = self._computed(today, me)
        names = {m["id"]: {"pseudo": m["pseudo"], "avatar": m.get("avatar") or "🙂"} for m in c["members"]}
        reactions = {}
        for r in c["reactions"]:
            entry = reactions.setdefault(r["event_id"], {})
            who = entry.setdefault(REACTIONS.get(r["emoji"], r["emoji"]), [])
            who.append(names.get(r["user_id"], {}).get("pseudo", "?"))
        hidden = set(games.HIDDEN_IN_FEED)
        feed = [{"id": e["id"], "kind": e["kind"], "payload": e.get("payload") or {}, "at": e["created_at"],
                 "user_id": e["user_id"],
                 "who": names.get(e["user_id"], {"pseudo": "Ancien membre", "avatar": "👤"}),
                 "to": names.get((e.get("payload") or {}).get("to"), {}).get("pseudo"),
                 "mine": e["user_id"] == me,
                 "reactions": reactions.get(e["id"], {}),
                 "my_reactions": [REACTIONS.get(r["emoji"], r["emoji"]) for r in c["reactions"]
                                  if r["event_id"] == e["id"] and r["user_id"] == me]}
                for e in c["events"] if e["kind"] not in hidden]
        if self.store.get("feed_seen") is None and feed:     # first look: nothing is "new"
            self.store["feed_seen"] = max(e["id"] for e in feed)
        unread = sum(1 for e in feed if not e["mine"] and e["id"] > (self.store.get("feed_seen") or 0))
        if view:
            for p in view["players"]:
                # "Féliciter" reacts to today's goal event; "Encourager" once a day
                p["goal_event"] = next((e["id"] for e in c["events"] if e["user_id"] == p["id"] and e["kind"] == "goal"
                                        and (e.get("payload") or {}).get("day") == today), None)
                p["encouraged"] = f"encourage:{p['id']}:{today}" in self.store["sent"]
        return {"profile": c["profile"], "group": c["group"], "view": view, "feed": feed, "me": me,
                "account": {"username": self.server.username, "secured": bool(self.server.username)},
                "error": self.error, "syncing": self.syncing, "last_sync": self.store.get("last_sync"),
                "avatars": AVATARS, "emojis": list(REACTIONS.values()), "ready": bool(self.store.get("last_sync")),
                "update": self.update, "update_check": self.update_check, "version": self.version, "game": game,
                "messages": [{"code": k, "text": t} for k, t in games.MESSAGES],
                "messages_left": max(0, games.MESSAGES_PER_DAY - self._sent_today("msg")),
                "message_max": games.MESSAGE_MAX,
                "now": self.now().isoformat(), "unread": unread, "settings": self.settings(),
                "corners": list(CORNERS), "open_tab": self._take_open_tab()}

    def _take_open_tab(self):
        tab, self.open_tab = self.open_tab, None
        return tab

    def _computed(self, today, me):
        """The group screen and the game data. Rebuilt only when something
        changed (new data, new day, a minute later): snapshot() runs often."""
        c = self.cache
        if not c["group"]:
            return None, None
        key = (id(c["members"]), len(c["members"] or []), id(c["days"]), len(c["days"] or []),
               id(c.get("game_events")), len(c.get("game_events") or []), id(c["group"]), today, me,
               self.now().strftime("%Y-%m-%dT%H:%M"))
        if self._memo[0] == key:
            return self._memo[1]
        view = group.build(c["members"], c["days"], today, me, self.now())
        start = games.local_day(c["group"].get("created_at")) if c["group"].get("created_at") else None
        game = games.build(c["members"], c["days"], c.get("game_events") or [], today, me,
                           start.isoformat() if start else None, self.now())
        self._memo = (key, (view, game))
        return view, game

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

    def do_feed_seen(self):
        """The Activité tab was opened: everything in it is now read."""
        ids = [e["id"] for e in self.cache.get("events") or []]
        if ids:
            self.store["feed_seen"] = max(ids + [self.store.get("feed_seen") or 0])
            self._save()
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
        for key in ("group", "members", "days", "events", "reactions", "game_events"):
            self.cache[key] = None if key == "group" else []
        self.sync()
        return {}

    @staticmethod
    def _check_credentials(username, password):
        username = (username or "").strip().lower()
        if not USERNAME.fullmatch(username):
            raise ServerError("Nom d'utilisateur : 3 à 24 caractères, lettres sans accent, chiffres, « . », « - » ou « _ ».")
        if len(password or "") < 8:
            raise ServerError("Mot de passe : au moins 8 caractères.")
        return username

    def do_secure_account(self, username, password):
        self.server.secure_account(self._check_credentials(username, password), password)
        return {}

    def do_sign_in(self, username, password):
        self.server.sign_in(self._check_credentials(username, password), password)
        self.store = dict({"sent": [], "first_sync_done": False},
                          **{k: self.store[k] for k in KEPT_ON_SIGN_IN if k in self.store})
        self._save()
        for key in self.cache:
            self.cache[key] = None if key in ("profile", "group") else []
        self.sync()
        return {}

    def do_check_update(self):
        """The « Chercher une mise à jour » button of the window."""
        if not self.on_check_update:
            return {"ok": False, "error": "Impossible de chercher une mise à jour ici."}
        self.update_check = "checking"
        self.on_check_update()
        return {}

    def do_install_update(self):
        if not self.update or not self.on_install_update:
            return {"ok": False, "error": "Aucune mise à jour à installer."}
        self.on_install_update()
        return {}

    def do_encourage(self, player_id):
        """Feature 17: a nudge in the feed for a friend who hasn't finished today."""
        profile = self.cache.get("profile") or {}
        if not profile.get("group_id") or player_id not in {m["id"] for m in self.cache["members"]}:
            return {"ok": False, "error": "Ce joueur n'est pas dans ton groupe."}
        key = f"encourage:{player_id}:{self.today()}"
        if key in self.store["sent"]:
            return {"ok": False, "error": "Tu l'as déjà encouragé aujourd'hui."}
        self.server.post_event(profile["group_id"], "encourage", {"to": player_id, "day": self.today()})
        self.store["sent"].append(key)
        self._save()
        self.sync()
        return {}

    def do_react(self, event_id, emoji, on=True):
        if emoji not in REACTION_CODES:
            return {"ok": False, "error": "Réaction inconnue."}
        self.server.react(event_id, REACTION_CODES[emoji], bool(on))
        self.sync()
        return {}

    # -- défis, paris, pomodoro, messages, cadre (all posted as group events: see games.py) -------------
    def _group_id(self):
        gid = (self.cache.get("profile") or {}).get("group_id")
        if not gid:
            raise ServerError("Rejoins d'abord un groupe.")
        return gid

    def _post(self, kind, payload):
        self.server.post_event(self._group_id(), kind, payload)
        self.poll() or self.sync()

    def _sent_today(self, kind):
        prefix = f"{kind}:{self.today()}:"
        return sum(1 for k in self.store["sent"] if k.startswith(prefix))

    def _game(self):
        return self.snapshot().get("game") or {}

    def _my_events(self, ref, kinds):
        return [e for e in self.cache.get("game_events") or []
                if e["kind"] in kinds and (e.get("payload") or {}).get("ref") == ref]

    def pomodoro_alert(self):
        """For Anki's own little message when the window is closed: the text
        to show when my shared pomodoro changes phase, else None."""
        pomo = self.my_pomodoro()
        if not pomo:
            self._pomo_phase = None
            return None
        phase, rnd, _left = games.pomo_phase(pomo, self.now())
        key = (pomo["id"], phase, rnd)
        old, self._pomo_phase = getattr(self, "_pomo_phase", None), key
        if old is None or old == key:
            return None
        if phase == "rest":
            return f"🍅 Pause ! {pomo['rest']} min"
        if phase == "work":
            return f"📚 Au travail ! Tour {rnd}/{pomo['rounds']}"
        return "🍅 Pomodoro terminé, bravo !"

    def do_poll(self):
        return {"started": self.poll()}

    def do_create_challenge(self, **payload):
        clean, err = games.check_challenge(payload, datetime.date.fromisoformat(self.today()))
        if err:
            return {"ok": False, "error": err}
        running = [c for c in self._game().get("challenges", []) if c["status"] in ("active", "upcoming")]
        if len(running) >= games.MAX_ACTIVE:
            return {"ok": False, "error": f"Déjà {games.MAX_ACTIVE} défis en cours : attends qu'un se termine."}
        self._post("challenge", clean)
        return {}

    def do_create_bet(self, **payload):
        me = self.server.user_id
        clean, err = games.check_bet(payload, datetime.date.fromisoformat(self.today()), me,
                                     [m["id"] for m in self.cache["members"]])
        if err:
            return {"ok": False, "error": err}
        players = self._game().get("players", {})
        for uid, who in ((me, "Tu n'as"), (clean["opponent"], "Ton adversaire n'a")):
            if (players.get(uid) or {}).get("wallet", 0) < clean["stake"]:
                return {"ok": False, "error": f"{who} pas assez de points pour cette mise."}
        self._post("bet", clean)
        return {}

    def do_answer_bet(self, ref, accept):
        bet = next((b for b in self._game().get("bets", []) if b["id"] == ref), None)
        if not bet or bet["opponent"] != self.server.user_id or bet["status"] != "pending":
            return {"ok": False, "error": "Ce pari n'attend plus ta réponse."}
        if accept and (self._game()["players"].get(self.server.user_id) or {}).get("wallet", 0) < bet["stake"]:
            return {"ok": False, "error": "Tu n'as pas assez de points pour cette mise."}
        self._post("bet_accept" if accept else "bet_decline", {"ref": ref})
        return {}

    def do_cancel(self, ref):
        g = self._game()
        mine = [c for c in g.get("challenges", []) if c["id"] == ref and c["by"] == self.server.user_id
                and (c["status"] == "upcoming" or c["created"] == self.today())]
        mine += [b for b in g.get("bets", []) if b["id"] == ref and b["by"] == self.server.user_id
                 and b["status"] == "pending"]
        if not mine:
            return {"ok": False, "error": "On ne peut plus l'annuler."}
        self._post("cancel", {"ref": ref})
        return {}

    def do_start_pomodoro(self, work=25, rest=5, rounds=4):
        clean, err = games.check_pomo({"work": work, "rest": rest, "rounds": rounds})
        if err:
            return {"ok": False, "error": err}
        if self._game().get("pomodoro"):
            return {"ok": False, "error": "Un pomodoro est déjà en cours : rejoins-le."}
        self._post("pomo", clean)
        self.set_studying()
        return {}

    def do_join_pomodoro(self, ref):
        pomo = self._game().get("pomodoro")
        if not pomo or pomo["id"] != ref:
            return {"ok": False, "error": "Ce pomodoro est terminé."}
        if self.server.user_id in pomo["players"]:
            return {}
        self._post("pomo_join", {"ref": ref})
        self.set_studying()
        return {}

    def do_stop_pomodoro(self, ref):
        pomo = self._game().get("pomodoro")
        if not pomo or pomo["id"] != ref or pomo["by"] != self.server.user_id:
            return {"ok": False, "error": "Seul celui qui l'a lancé peut l'arrêter."}
        self._post("pomo_stop", {"ref": ref})
        return {}

    def do_send_message(self, code=None, text=None):
        """A ready-made message (`code`) or anything written freely (`text`)."""
        if text is not None:
            text, err = games.clean_message(text)
            if err:
                return {"ok": False, "error": err}
            payload = {"text": text}
        elif code in games.MESSAGE_TEXT:
            payload = {"code": code}
        else:
            return {"ok": False, "error": "Message inconnu."}
        if self._sent_today("msg") >= games.MESSAGES_PER_DAY:
            return {"ok": False, "error": "Assez de messages pour aujourd'hui 🙂"}
        self.store["sent"].append(f"msg:{self.today()}:{len(self.store['sent'])}")
        self._save()
        self._post("msg", payload)
        return {}

    def do_set_frame(self, frame):
        me = (self._game().get("players") or {}).get(self.server.user_id) or {}
        if not any(f["id"] == frame and f["open"] for f in me.get("frames", [])):
            return {"ok": False, "error": "Ce cadre n'est pas encore débloqué."}
        self._post("frame", {"frame": frame})
        return {}
