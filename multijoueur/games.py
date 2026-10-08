"""Défis, paris, saisons, badges, points multijoueur, pomodoro et messages.
Pure and Qt-free (unit-tested).

Everything here is computed from two things every player already has: the
members' daily rows (`days`) and the group's "game" events. Nothing is
stored as a result on the server, so every computer computes the same
scores, and a new schema isn't needed (events take any JSON payload; the
server's rules already make sure a player only posts as themselves).

Game events (kind -> payload):
  challenge   {type, metric?, target, start, end, solo?, title?}  - a défi (types below)
  bet         {opponent, stake, type, start, end}                 - a friendly bet
  bet_accept / bet_decline {ref}                                  - the opponent's answer
  cancel      {ref}                                               - the author takes back a défi or a bet
  pomo        {work, rest, rounds}  (starts at created_at)        - a shared pomodoro
  pomo_join / pomo_stop {ref}
  frame       {frame}                                             - the profile frame a player picked
  msg         {code} or {text}                                    - a ready-made message, or one written freely

Fairness (CLAUDE.md): group défis and bets use the fair daily points of
group.day_points or "days finished", never raw card counts; a card target
is only allowed for a défi a player sets for themselves ("solo").
"""

import calendar
import datetime

from . import group as G

GAME_KINDS = ("challenge", "bet", "bet_accept", "bet_decline", "cancel", "pomo", "pomo_join", "pomo_stop", "frame")
HIDDEN_IN_FEED = ("bet_accept", "bet_decline", "cancel", "pomo_join", "pomo_stop", "frame")

CHALLENGE_TYPES = ("custom", "zero", "race", "boss")
METRICS = {"points": "points", "days": "journées finies", "cards": "cartes"}
MAX_ACTIVE = 4            # défis running at once in a group: more are ignored (no reward farming)
MAX_DAYS = 31
RACE_DAYS = 30            # a race without a winner stops after 30 days
BET_TYPES = ("duel", "objectif")
STAKE_MIN, STAKE_MAX = 5, 200
START_WALLET = 50         # everyone starts with 50 points to bet with (they don't count for the titles)
POMO_LIMITS = {"work": (10, 60), "rest": (3, 30), "rounds": (1, 8)}

# rewards in multiplayer points: proportional to the effort asked, so a tiny
# target pays almost nothing
REWARD = {"points": 0.15, "days": 3, "zero": 3, "race": 0.2, "boss": 0.05}

LEVELS = [(0, "Recrue", "🌱"), (100, "Apprenti·e", "📘"), (300, "Studieux·se", "✏️"), (700, "Assidu·e", "🎯"),
          (1500, "Expert·e", "🧠"), (3000, "Maître", "🏛️"), (6000, "Légende", "🌟"), (10000, "Immortel·le", "👑")]
FRAMES = [("aucun", "Aucun", 0), ("bronze", "Bronze", 100), ("argent", "Argent", 700), ("or", "Or", 1500),
          ("diamant", "Diamant", 3000), ("arcenciel", "Arc-en-ciel", 6000)]
CHAMPION_FRAME = ("champion", "Champion·ne de saison")   # any 🥇 season trophy unlocks it

MESSAGES = [
    ("go", "On s'y met ? 📚"), ("start", "Je commence ! 🚀"), ("pomo", "Un pomodoro ensemble ? 🍅"),
    ("pause", "Petite pause ☕"), ("almost", "Presque fini ! 🏁"), ("done", "Fini pour aujourd'hui ✅"),
    ("courage", "Courage, tu peux le faire 💪"), ("bravo", "Bien joué ! 👏"), ("tired", "Je suis crevé·e 😴"),
    ("exam", "Examen bientôt 😬"), ("morning", "Demain matin, on s'y remet ☀️"), ("night", "Bonne nuit 🌙"),
]
MESSAGE_TEXT = dict(MESSAGES)
MESSAGES_PER_DAY = 150    # only against a stuck key: a real conversation never gets there
MESSAGE_MAX = 300         # characters in a message written freely


def message_text(payload):
    """What a `msg` event says: the text written freely, or the ready-made message's text."""
    payload = payload or {}
    text = payload.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()[:MESSAGE_MAX]
    return MESSAGE_TEXT.get(payload.get("code"))


def clean_message(text):
    """-> (the message to send, None) or (None, the reason it can't be sent)."""
    lines = [" ".join(line.split()) for line in str(text or "").splitlines()]
    text = "\n".join(lines).strip()
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    if not text:
        return None, "Écris d'abord ton message."
    if len(text) > MESSAGE_MAX:
        return None, f"Message trop long ({len(text)} caractères, {MESSAGE_MAX} au plus)."
    return text, None

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]


# -- small helpers ---------------------------------------------------------------------------
def local_day(created_at):
    """The local date an event was posted (both players live in the same time zone)."""
    try:
        t = datetime.datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is not None:
        t = t.astimezone()
    return t.date()


def parse_time(created_at):
    try:
        t = datetime.datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)


def _day(value):
    try:
        return datetime.date.fromisoformat(str(value))
    except ValueError:
        return None


def _int(value, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def days_between(start, end):
    n = (end - start).days + 1
    return [start + datetime.timedelta(days=i) for i in range(max(0, n))]


def month_key(day):
    return f"{day.year:04d}-{day.month:02d}"


def month_name(key):
    y, m = key.split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def month_bounds(key):
    y, m = (int(x) for x in key.split("-"))
    return datetime.date(y, m, 1), datetime.date(y, m, calendar.monthrange(y, m)[1])


class Days:
    """A player's days, with the fair daily points cached."""

    def __init__(self, member, rows):
        self.m = member
        self.rows = rows
        self._pts = {}

    def row(self, day):
        return self.rows.get(day.isoformat())

    def points(self, day):
        if day not in self._pts:
            self._pts[day] = G.day_points(self.row(day), self.m, self.row(day - datetime.timedelta(days=1)), self.rows)
        return self._pts[day]

    def finished(self, day):
        return G.validated(self.row(day), self.m)

    def zero(self, day):
        return self.points(day)["no_backlog"] > 0

    def cards(self, day):
        return (self.row(day) or {}).get("cards") or 0

    def metric(self, metric, day):
        if metric == "points":
            return self.points(day)["total"]
        if metric == "days":
            return 1 if self.finished(day) else 0
        if metric == "zero":
            return 1 if self.zero(day) else 0
        return self.cards(day)


# -- validation (the add-on checks before posting, and ignores bad events when computing) -----------
def check_challenge(p, created):
    """-> (clean payload, None) or (None, message in French)."""
    p = dict(p or {})
    kind = p.get("type")
    if kind not in CHALLENGE_TYPES:
        return None, "Type de défi inconnu."
    start, end = _day(p.get("start")), _day(p.get("end"))
    if start is None:
        return None, "Choisis une date de début."
    if kind == "race" and end is None:
        end = start + datetime.timedelta(days=RACE_DAYS - 1)
    if end is None:
        return None, "Choisis une date de fin."
    if start < created:
        return None, "Le défi ne peut pas commencer dans le passé."
    if end < start:
        return None, "La fin doit être après le début."
    if (end - start).days + 1 > MAX_DAYS:
        return None, f"Un défi dure au plus {MAX_DAYS} jours."
    if (start - created).days > 14:
        return None, "Un défi commence au plus tard dans 2 semaines."
    n = (end - start).days + 1
    out = {"type": kind, "start": start.isoformat(), "end": end.isoformat()}
    if kind == "custom":
        metric = p.get("metric")
        if metric not in METRICS:
            return None, "Choisis ce qu'il faut atteindre."
        solo = bool(p.get("solo"))
        if metric == "cards" and not solo:
            return None, "Programmes différents : un défi en cartes, c'est seulement pour toi (« juste moi »)."
        limit = {"points": 30 * n, "days": n, "cards": 100000}[metric]
        target = _int(p.get("target"), 1, limit)
        if target is None:
            return None, f"Objectif entre 1 et {limit}."
        out.update(metric=metric, target=target, solo=solo)
    elif kind == "zero":
        target = _int(p.get("target"), 1, n)
        if target is None:
            return None, f"Nombre de jours sans retard entre 1 et {n}."
        out.update(metric="zero", target=target)
    elif kind == "race":
        target = _int(p.get("target"), 20, 30 * n)
        if target is None:
            return None, "La course se joue entre 20 et beaucoup de points."
        out.update(metric="points", target=target)
    elif kind == "boss":
        target = _int(p.get("target"), 50, 30 * n * 20)
        if target is None:
            return None, "Les points de vie du boss : au moins 50."
        out.update(metric="points", target=target)
    title = str(p.get("title") or "").strip()[:40]
    if title:
        out["title"] = title
    return out, None


def check_bet(p, created, me, member_ids):
    p = dict(p or {})
    if p.get("type") not in BET_TYPES:
        return None, "Type de pari inconnu."
    if p.get("opponent") not in member_ids or p.get("opponent") == me:
        return None, "Choisis contre qui tu paries."
    stake = _int(p.get("stake"), STAKE_MIN, STAKE_MAX)
    if stake is None:
        return None, f"Mise entre {STAKE_MIN} et {STAKE_MAX} points."
    start, end = _day(p.get("start")), _day(p.get("end"))
    if start is None or end is None or end < start:
        return None, "Choisis des dates valides."
    if start < created or (start - created).days > 7:
        return None, "Le pari commence aujourd'hui ou dans la semaine."
    if (end - start).days + 1 > 14:
        return None, "Un pari dure au plus 14 jours."
    return {"type": p["type"], "opponent": p["opponent"], "stake": stake, "start": start.isoformat(),
            "end": end.isoformat()}, None


def check_pomo(p):
    out = {}
    for key, (lo, hi) in POMO_LIMITS.items():
        n = _int((p or {}).get(key), lo, hi)
        if n is None:
            return None, f"Pomodoro : {key} entre {lo} et {hi}."
        out[key] = n
    return out, None


# -- the computation -----------------------------------------------------------------------------
class Game:
    def __init__(self, members, day_rows, events, today, me, start=None, now=None):
        self.members = members
        self.ids = [m["id"] for m in members]
        self.names = {m["id"]: m["pseudo"] for m in members}
        by = G.by_user(day_rows)
        self.days = {m["id"]: Days(m, by.get(m["id"], {})) for m in members}
        self.today = today
        self.me = me
        self.now = now or datetime.datetime.now(datetime.timezone.utc)
        self.events = sorted(events or [], key=lambda e: e["id"])
        self.start = start or min((local_day(e["created_at"]) for e in self.events if local_day(e["created_at"])),
                                  default=today)
        self.start = min(self.start, today)
        self.by_ref = {}
        for e in self.events:
            ref = (e.get("payload") or {}).get("ref")
            if ref is not None:
                self.by_ref.setdefault(ref, []).append(e)
        self.challenges = self._challenges()
        self.bets = self._bets()

    # -- défis --------------------------------------------------------------------------------
    def _answers(self, e, kind, who=None, until=None):
        for a in self.by_ref.get(e["id"], []):
            if a["kind"] == kind and (who is None or a["user_id"] == who):
                if until is None or (local_day(a["created_at"]) or until) <= until:
                    return a
        return None

    def _challenges(self):
        out = []
        for e in self.events:
            if e["kind"] != "challenge" or e["user_id"] not in self.ids:
                continue
            created = local_day(e["created_at"]) or self.today
            p, err = check_challenge(e.get("payload"), created)
            if err:
                continue
            start, end = _day(p["start"]), _day(p["end"])
            if self._answers(e, "cancel", e["user_id"], max(start, created)):
                continue
            running = [c for c in out if _day(c["end"]) >= created and c["created"] <= created.isoformat()]
            if len(running) >= MAX_ACTIVE:
                continue
            out.append(self._challenge(e, p, created, start, end))
        return out

    def _challenge(self, e, p, created, start, end):
        kind = p["type"]
        players = [e["user_id"]] if p.get("solo") else list(self.ids)
        last = min(end, self.today)
        span = days_between(start, last)
        status = "upcoming" if self.today < start else ("active" if self.today <= end else "over")
        c = {"id": e["id"], "by": e["user_id"], "type": kind, "metric": p["metric"], "target": p["target"],
             "start": p["start"], "end": p["end"], "solo": bool(p.get("solo")), "title": p.get("title"),
             "created": created.isoformat(), "status": status, "days_left": max(0, (end - self.today).days + 1),
             "players": [], "rewards": {}}
        if kind == "boss":
            dmg = {uid: sum(self.days[uid].metric("points", x) for x in span) for uid in players}
            total = sum(dmg.values())
            won_day = None
            run = 0
            for x in span:
                run += sum(self.days[uid].metric("points", x) for uid in players)
                if run >= p["target"]:
                    won_day = x
                    break
            c.update(damage=total, hp_left=max(0, p["target"] - total), won=won_day is not None,
                     won_day=won_day.isoformat() if won_day else None)
            c["players"] = [{"id": uid, "value": dmg[uid]} for uid in players]
            if won_day:
                c["rewards"] = {uid: round(REWARD["boss"] * p["target"]) for uid in players}
                c["status"] = "won"
            elif status == "over":
                c["status"] = "lost"
            return c
        if kind == "race":
            totals = {uid: 0 for uid in players}
            winners, win_day = [], None
            for x in span:
                for uid in players:
                    totals[uid] += self.days[uid].metric("points", x)
                over = [uid for uid in players if totals[uid] >= p["target"]]
                if over:
                    best = max(totals[uid] for uid in over)
                    winners = [uid for uid in over if totals[uid] == best]
                    win_day = x
                    break
            c["players"] = [{"id": uid, "value": totals[uid], "done": uid in winners} for uid in players]
            c["winners"] = winners
            c["won_day"] = win_day.isoformat() if win_day else None
            if winners:
                c["status"] = "won"
                c["rewards"] = {uid: round(REWARD["race"] * p["target"]) for uid in winners}
            elif status == "over":
                c["status"] = "lost"
            return c
        metric = p["metric"]
        reward = round(REWARD["zero"] * p["target"]) if kind == "zero" else (
            0 if p.get("solo") else round(REWARD.get(metric, 0) * p["target"]))
        for uid in players:
            value, done_day = 0, None
            for x in span:
                value += self.days[uid].metric(metric, x)
                if done_day is None and value >= p["target"]:
                    done_day = x
            c["players"].append({"id": uid, "value": value, "done": done_day is not None,
                                 "done_day": done_day.isoformat() if done_day else None})
            if done_day is not None and reward:
                c["rewards"][uid] = reward
        c["reward"] = reward
        if c["players"] and all(pl["done"] for pl in c["players"]):
            c["status"] = "won"
        elif status == "over":
            c["status"] = "over"
        return c

    # -- paris ---------------------------------------------------------------------------------
    def _bets(self):
        out = []
        for e in self.events:
            if e["kind"] != "bet" or e["user_id"] not in self.ids:
                continue
            created = local_day(e["created_at"]) or self.today
            p, err = check_bet(e.get("payload"), created, e["user_id"], self.ids)
            if err:
                continue
            start, end = _day(p["start"]), _day(p["end"])
            b = {"id": e["id"], "by": e["user_id"], "opponent": p["opponent"], "type": p["type"], "stake": p["stake"],
                 "start": p["start"], "end": p["end"], "created": created.isoformat(), "net": {}}
            accept = self._answers(e, "bet_accept", p["opponent"], start)
            decline = self._answers(e, "bet_decline", p["opponent"])
            cancel = self._answers(e, "cancel", e["user_id"])
            if accept and not (cancel and cancel["id"] < accept["id"]) and not (decline and decline["id"] < accept["id"]):
                b["status"] = "active" if self.today <= end else "settled"
            elif cancel:
                b["status"] = "canceled"
            elif decline:
                b["status"] = "declined"
            elif self.today > start:
                b["status"] = "expired"
            else:
                b["status"] = "pending"
            if b["status"] in ("active", "settled"):
                self._score_bet(b, start, end)
            out.append(b)
        return out

    def _score_bet(self, b, start, end):
        span = days_between(start, min(end, self.today))
        a, o = self.days[b["by"]], self.days[b["opponent"]]
        if b["type"] == "duel":
            b["score"] = {b["by"]: sum(a.metric("points", x) for x in span),
                          b["opponent"]: sum(o.metric("points", x) for x in span)}
            lead = b["score"][b["by"]] - b["score"][b["opponent"]]
            b["winner"] = None if lead == 0 else (b["by"] if lead > 0 else b["opponent"])
        else:   # "objectif": the author finishes every day of the bet
            done = sum(1 for x in span if a.finished(x))
            missed = sum(1 for x in span if x < self.today and not a.finished(x))
            b["score"] = {"done": done, "days": len(days_between(start, end)), "missed": missed}
            if missed:
                b["winner"] = b["opponent"]
            elif self.today > end:
                b["winner"] = b["by"]
            else:
                b["winner"] = None
        if b["status"] == "settled" or (b["type"] == "objectif" and b.get("winner") == b["opponent"]):
            b["status"] = "settled"
            if b["winner"]:
                loser = b["opponent"] if b["winner"] == b["by"] else b["by"]
                b["net"] = {b["winner"]: b["stake"], loser: -b["stake"]}

    # -- points multijoueur, titres, cadres -------------------------------------------------------
    def earned(self, uid, until=None):
        """Points gagnés depuis le début du groupe (journées + défis): never goes down."""
        until = until or self.today
        days = sum(self.days[uid].points(x)["total"] for x in days_between(self.start, until))
        bonus = sum(c["rewards"].get(uid, 0) for c in self.challenges)
        return days + bonus

    def wallet(self, uid):
        """What can be bet: the starting 50 + earned points + bets won - bets lost."""
        return START_WALLET + self.earned(uid) + sum(b["net"].get(uid, 0) for b in self.bets)

    @staticmethod
    def level(xp):
        i = max(i for i, (lo, _n, _i) in enumerate(LEVELS) if xp >= lo)
        lo, title, icon = LEVELS[i]
        nxt = LEVELS[i + 1][0] if i + 1 < len(LEVELS) else None
        return {"rank": i + 1, "title": title, "icon": icon, "xp": xp, "from": lo, "next": nxt,
                "pct": 100 if nxt is None else round(100 * (xp - lo) / (nxt - lo))}

    def frames_for(self, uid, xp, trophies):
        out = [{"id": f, "name": n, "need": need, "open": xp >= need} for f, n, need in FRAMES]
        out.append({"id": CHAMPION_FRAME[0], "name": CHAMPION_FRAME[1], "need": None,
                    "open": any(t["medal"] == "🥇" for t in trophies)})
        return out

    def chosen_frame(self, uid, frames):
        pick = "aucun"
        for e in self.events:
            if e["kind"] == "frame" and e["user_id"] == uid:
                pick = (e.get("payload") or {}).get("frame") or "aucun"
        return pick if any(f["id"] == pick and f["open"] for f in frames) else "aucun"

    # -- saisons, trophées, bilan ---------------------------------------------------------------
    def month_days(self, key):
        first, last = month_bounds(key)
        return days_between(max(first, self.start), min(last, self.today))

    def season(self, key):
        span = self.month_days(key)
        rows = []
        for uid in self.ids:
            dd = self.days[uid]
            reviews = sum((dd.row(x) or {}).get("review_count") or 0 for x in span)
            kept = sum(((dd.row(x) or {}).get("retention") or 0) * ((dd.row(x) or {}).get("review_count") or 0)
                       for x in span)
            best = max(span, key=dd.cards, default=None)
            rows.append({"id": uid, "points": sum(dd.points(x)["total"] for x in span),
                         "finished": sum(1 for x in span if dd.finished(x)),
                         "active": sum(1 for x in span if dd.cards(x) > 0),
                         "cards": sum(dd.cards(x) for x in span),
                         "minutes": sum((dd.row(x) or {}).get("minutes") or 0 for x in span),
                         "reviews": reviews, "retention": round(100 * kept / reviews, 1) if reviews else None,
                         "best_day": {"day": best.isoformat(), "cards": dd.cards(best)} if best and dd.cards(best) else None})
        rows.sort(key=lambda r: (-r["points"], -r["finished"], self.names[r["id"]].lower()))
        return rows

    def report(self, key):
        """Bilan mensuel du groupe."""
        span = self.month_days(key)
        rows = self.season(key)
        all_done = sum(1 for x in span if self.ids and all(self.days[u].finished(x) for u in self.ids))
        def best(field, minimum=None, need=None):
            ok = [r for r in rows if r[field] is not None and (need is None or r[need] >= minimum)]
            top = max(ok, key=lambda r: r[field], default=None)
            return top["id"] if top and top[field] else None
        first, last = month_bounds(key)
        return {"month": key, "name": month_name(key), "days": len(span), "complete": self.today > last,
                "players": rows, "cards": sum(r["cards"] for r in rows), "minutes": sum(r["minutes"] for r in rows),
                "all_done_days": all_done,
                "mvp": rows[0]["id"] if rows and rows[0]["points"] else None,
                "most_regular": best("finished"), "best_retention": best("retention", 100, "reviews"),
                "challenges_won": sum(1 for c in self.challenges if c["status"] == "won"
                                      and first.isoformat() <= (c.get("won_day") or c["end"]) <= last.isoformat())}

    def months(self):
        keys, x = [], datetime.date(self.start.year, self.start.month, 1)
        while x <= self.today:
            keys.append(month_key(x))
            x = (x + datetime.timedelta(days=32)).replace(day=1)
        return keys

    def trophies(self):
        """{uid: [trophy]}: the podium of every finished season, plus two specials."""
        out = {uid: [] for uid in self.ids}
        for key in self.months():
            if month_bounds(key)[1] >= self.today:
                continue
            rep = self.report(key)
            for rank, r in enumerate(rep["players"][:3]):
                if r["points"]:
                    medal = "🥇🥈🥉"[rank]
                    out[r["id"]].append({"month": key, "medal": medal,
                                         "label": f"{['Champion·ne', '2e place', '3e place'][rank]} de {rep['name']}"})
            if len(self.ids) > 1:
                if rep["most_regular"]:
                    out[rep["most_regular"]].append({"month": key, "medal": "📅", "label": f"Le plus régulier de {rep['name']}"})
                if rep["best_retention"]:
                    out[rep["best_retention"]].append({"month": key, "medal": "🧠", "label": f"Meilleure rétention de {rep['name']}"})
        return out

    # -- badges de groupe ------------------------------------------------------------------------------
    def group_badges(self, pomos):
        span = days_between(self.start, self.today)
        all_done = [x for x in span if self.ids and all(self.days[u].finished(x) for u in self.ids)]
        best_run = run = 0
        prev = None
        for x in all_done:
            run = run + 1 if prev and (x - prev).days == 1 else 1
            prev, best_run = x, max(best_run, run)
        zero_all = sum(1 for x in span if self.ids and all(self.days[u].zero(x) for u in self.ids))
        cards = sum(self.days[u].cards(x) for u in self.ids for x in span)
        weeks = 0
        monday = G.monday(self.start)
        while monday + datetime.timedelta(days=6) <= self.today:
            week = days_between(monday, monday + datetime.timedelta(days=6))
            if self.ids and all(sum(1 for x in week if self.days[u].finished(x)) >= G.WEEK_GOAL_DAYS for u in self.ids):
                weeks += 1
            monday += datetime.timedelta(days=7)
        bosses = sum(1 for c in self.challenges if c["type"] == "boss" and c["status"] == "won")
        shared = sum(1 for p in pomos if not p["active"] and len(p["players"]) >= 2 and not p["stopped"])
        defs = [
            ("serie", "🔥", "Série de groupe", "jours d'affilée où tout le monde finit sa journée", best_run, (3, 7, 30, 100)),
            ("ensemble", "🤝", "Tous au rendez-vous", "journées finies par tout le monde", len(all_done), (1, 10, 50, 150)),
            ("cartes", "🃏", "Montagne de cartes", "cartes faites ensemble", cards, (1000, 10000, 50000, 200000)),
            ("semaines", "📆", "Objectif commun", "semaines réussies (5 jours chacun)", weeks, (1, 4, 12, 40)),
            ("zero", "🧹", "Zéro retard ensemble", "jours sans retard pour tout le monde", zero_all, (1, 7, 30, 100)),
            ("boss", "🐉", "Chasseurs de boss", "boss d'équipe vaincus", bosses, (1, 3, 10, 25)),
            ("pomo", "🍅", "Pomodoros à plusieurs", "pomodoros finis à au moins 2", shared, (1, 10, 50, 150)),
        ]
        out = []
        for bid, icon, name, desc, value, tiers in defs:
            level = sum(1 for t in tiers if value >= t)
            nxt = tiers[level] if level < len(tiers) else None
            out.append({"id": bid, "icon": icon, "name": name, "desc": desc, "value": value, "level": level,
                        "tiers": list(tiers), "next": nxt,
                        "pct": 100 if nxt is None else round(100 * value / nxt)})
        return out

    # -- pomodoro ------------------------------------------------------------------------------------
    def pomodoros(self):
        out = []
        for e in self.events:
            if e["kind"] != "pomo" or e["user_id"] not in self.ids:
                continue
            p, err = check_pomo(e.get("payload"))
            start = parse_time(e["created_at"])
            if err or start is None:
                continue
            length = datetime.timedelta(minutes=p["rounds"] * (p["work"] + p["rest"]))
            stop = self._answers(e, "pomo_stop", e["user_id"])
            players = [e["user_id"]] + [a["user_id"] for a in self.by_ref.get(e["id"], [])
                                        if a["kind"] == "pomo_join" and a["user_id"] in self.ids
                                        and a["user_id"] != e["user_id"]]
            end = start + length
            stopped_at = parse_time(stop["created_at"]) if stop else None
            if any(parse_time(o["start"]) <= start < parse_time(o["stopped_at"] or o["end"]) for o in out):
                continue   # started while another one was running (two clicks at once): everyone follows the first
            out.append({"id": e["id"], "by": e["user_id"], "start": start.isoformat(), "end": end.isoformat(),
                        "work": p["work"], "rest": p["rest"], "rounds": p["rounds"],
                        "players": list(dict.fromkeys(players)), "stopped": bool(stop),
                        "active": not stop and self.now < end and self.now >= start - datetime.timedelta(minutes=1),
                        "stopped_at": stopped_at.isoformat() if stopped_at else None})
        return out

    # -- duels de la semaine (historique) --------------------------------------------------------------
    def duel_history(self):
        """Every finished week since the group started: who made the most points.
        -> {"weeks": [{monday, scores, winner}] newest first, "wins": {uid: n}}"""
        weeks, wins = [], {uid: 0 for uid in self.ids}
        monday = G.monday(self.start)
        while monday + datetime.timedelta(days=6) < self.today:
            span = [x for x in days_between(monday, monday + datetime.timedelta(days=6)) if x >= self.start]
            scores = {uid: sum(self.days[uid].points(x)["total"] for x in span) for uid in self.ids}
            best = max(scores.values(), default=0)
            top = [uid for uid, v in scores.items() if v == best]
            winner = top[0] if best and len(top) == 1 and len(self.ids) > 1 else None
            if winner:
                wins[winner] += 1
            weeks.append({"monday": monday.isoformat(), "scores": scores, "winner": winner})
            monday += datetime.timedelta(days=7)
        return {"weeks": weeks[::-1][:12], "wins": wins}

    # -- moments: results nobody posts, shown in the feed ---------------------------------------------
    def moments(self, duels, trophies):
        """Computed news for the feed (same on every computer): défis finished,
        bets settled, weekly duels, season podiums. Newest first."""
        out = []
        for c in self.challenges:
            if c["status"] in ("won", "lost", "over"):
                day = c.get("won_day") or c["end"]
                if c["status"] == "over" and not any(p.get("done") for p in c["players"]):
                    status = "lost"
                else:
                    status = c["status"]
                done = [p["id"] for p in c["players"] if p.get("done")] if c["type"] != "boss" else []
                out.append({"type": "challenge", "day": day, "ref": c["id"], "challenge": c["type"],
                            "title": c.get("title"), "target": c["target"], "metric": c["metric"],
                            "status": status, "winners": c.get("winners") or done, "solo": c["solo"], "by": c["by"]})
        for b in self.bets:
            if b["status"] == "settled":
                out.append({"type": "bet", "day": min(b["end"], self.today.isoformat()), "ref": b["id"],
                            "winner": b["winner"], "stake": b["stake"], "players": [b["by"], b["opponent"]]})
        for w in duels["weeks"]:
            if w["winner"]:
                sunday = (datetime.date.fromisoformat(w["monday"]) + datetime.timedelta(days=6)).isoformat()
                out.append({"type": "duel", "day": sunday, "winner": w["winner"], "scores": w["scores"]})
        for uid, items in trophies.items():
            for t in items:
                if t["medal"] == "🥇":
                    last = month_bounds(t["month"])[1].isoformat()
                    out.append({"type": "season", "day": last, "winner": uid, "label": t["label"]})
        out.sort(key=lambda m: m["day"], reverse=True)
        return out[:30]

    # -- all of it for the window ----------------------------------------------------------------------
    def build(self):
        pomos = self.pomodoros()
        trophies = self.trophies()
        players = {}
        for uid in self.ids:
            xp = self.earned(uid)
            frames = self.frames_for(uid, xp, trophies[uid])
            players[uid] = {"xp": xp, "wallet": self.wallet(uid), "level": self.level(xp), "frames": frames,
                            "frame": self.chosen_frame(uid, frames), "trophies": trophies[uid]}
        key = month_key(self.today)
        prev = month_key(datetime.date(self.today.year, self.today.month, 1) - datetime.timedelta(days=1))
        _first, last = month_bounds(key)
        reports = {k: self.report(k) for k in self.months()[-6:]}
        if prev not in reports and prev >= month_key(self.start):
            reports[prev] = self.report(prev)
        live = [p for p in pomos if p["active"]]
        duels = self.duel_history()
        return {
            "start": self.start.isoformat(),
            "players": players,
            "challenges": sorted(self.challenges, key=lambda c: (c["status"] not in ("active", "upcoming"), -c["id"])),
            "bets": sorted(self.bets, key=lambda b: (b["status"] not in ("pending", "active"), -b["id"])),
            "season": {"month": key, "name": month_name(key), "days_left": (last - self.today).days + 1,
                       "ranking": self.season(key)},
            "reports": reports, "months": sorted(reports),
            "badges": self.group_badges(pomos),
            "pomodoro": live[0] if live else None,
            "pomodoros_done": sum(1 for p in pomos if not p["active"] and not p["stopped"]),
            "duels": duels,
            "moments": self.moments(duels, trophies),
        }


def build(members, day_rows, events, today_iso, me, start_iso=None, now=None):
    start = _day(start_iso) if start_iso else None
    return Game(members, day_rows, events, G.d(today_iso), me, start, now).build()


def pomo_phase(pomo, now):
    """("work"|"rest"|"over", round number, seconds left in the phase) at `now`."""
    start = parse_time(pomo["start"])
    elapsed = (now - start).total_seconds()
    cycle = (pomo["work"] + pomo["rest"]) * 60
    if elapsed < 0:
        return "work", 1, int(-elapsed)
    if pomo.get("stopped") or elapsed >= cycle * pomo["rounds"]:
        return "over", pomo["rounds"], 0
    n, into = divmod(elapsed, cycle)
    if into < pomo["work"] * 60:
        return "work", int(n) + 1, int(pomo["work"] * 60 - into)
    return "rest", int(n) + 1, int(cycle - into)
