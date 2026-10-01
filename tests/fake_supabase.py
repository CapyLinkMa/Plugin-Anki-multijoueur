"""An in-memory stand-in for the group's Supabase server: the same URLs the
add-on calls, and the same visibility rules as supabase/schema.sql (you
only see your group). Used by the tests and tools/dev_server.py."""

import datetime
import itertools
import json
import urllib.parse
import uuid


class FakeSupabase:
    def __init__(self, anonymous_enabled=True):
        self.anonymous_enabled = anonymous_enabled
        self.users = {}       # token -> user id
        self.refresh = {}     # refresh token -> user id
        self.groups = {}      # id -> row
        self.profiles = {}    # id -> row
        self.days = {}        # (user, day) -> row
        self.events = []
        self.reactions = set()
        self.ids = itertools.count(1)
        self.online = True
        self.calls = []
        self.accounts = {}    # email -> (password, user id)
        self.confirm_email = False
        self.clock = None     # tests can fix the time events are posted at

    # -- helpers -------------------------------------------------------------------------
    def _group_of(self, uid):
        return (self.profiles.get(uid) or {}).get("group_id")

    def _visible(self, uid, other):
        g = self._group_of(uid)
        return other == uid or (g is not None and self._group_of(other) == g)

    def _event(self, group_id, uid, kind, payload=None):
        at = self.clock() if self.clock else datetime.datetime.now(datetime.timezone.utc)
        self.events.append({"id": next(self.ids), "group_id": group_id, "user_id": uid, "kind": kind,
                            "payload": payload or {}, "created_at": at.isoformat()})

    def sign_up(self):
        uid = str(uuid.uuid4())
        token, refresh = f"tok-{uid}", f"ref-{uid}"
        self.users[token] = uid
        self.refresh[refresh] = uid
        return uid, token

    # -- the opener the add-on uses ------------------------------------------------------------
    def __call__(self, method, url, headers, body):
        self.calls.append((method, url))
        if not self.online:
            return 0, ""
        parsed = urllib.parse.urlparse(url)
        path, query = parsed.path, urllib.parse.parse_qs(parsed.query)
        data = json.loads(body) if body else None
        if path == "/auth/v1/signup":
            if not self.anonymous_enabled:
                return 422, json.dumps({"msg": "Anonymous sign-ins are disabled"})
            uid, token = self.sign_up()
            return 200, json.dumps({"access_token": token, "refresh_token": f"ref-{uid}", "expires_in": 3600,
                                    "user": {"id": uid}})
        if path == "/auth/v1/token" and query.get("grant_type") == ["password"]:
            acc = self.accounts.get(data["email"].lower())
            if not acc or acc[0] != data["password"]:
                return 400, json.dumps({"error": "invalid_grant", "error_description": "Invalid login credentials"})
            uid = acc[1]
            token = f"tokp-{uid}"
            self.users[token] = uid
            self.refresh[f"ref-{uid}"] = uid
            return 200, json.dumps({"access_token": token, "refresh_token": f"ref-{uid}", "expires_in": 3600,
                                    "user": {"id": uid, "email": data["email"].lower()}})
        if path == "/auth/v1/user" and method == "PUT":
            uid = self.users.get(headers.get("Authorization", "").replace("Bearer ", ""))
            if uid is None:
                return 401, json.dumps({"message": "JWT expired"})
            email = data["email"].lower()
            if email in self.accounts:
                return 422, json.dumps({"msg": "A user with this email address has already been registered"})
            self.accounts[email] = (data["password"], uid)
            return 200, json.dumps({"id": uid, "email": None if self.confirm_email else email,
                                    "new_email": email if self.confirm_email else None})
        if path == "/auth/v1/token":
            uid = self.refresh.get(data.get("refresh_token"))
            if not uid:
                return 400, json.dumps({"error_description": "Invalid Refresh Token"})
            token = f"tok2-{uid}"
            self.users[token] = uid
            email = next((e for e, (_p, u) in self.accounts.items() if u == uid), None)
            return 200, json.dumps({"access_token": token, "refresh_token": data["refresh_token"], "expires_in": 3600,
                                    "user": {"id": uid, "email": email}})
        uid = self.users.get(headers.get("Authorization", "").replace("Bearer ", ""))
        if uid is None:
            return 401, json.dumps({"message": "JWT expired"})
        table = path.split("/")[-1]
        eq = {k: v[0].split(".", 1)[1] for k, v in query.items() if v and v[0].startswith("eq.")}
        if path.startswith("/rest/v1/rpc/"):
            return self._rpc(table, uid, data)
        if table == "profiles":
            if method == "GET":
                rows = [p for p in self.profiles.values() if self._visible(uid, p["id"])]
                if "id" in eq:
                    rows = [p for p in rows if p["id"] == eq["id"]]
                return 200, json.dumps(rows)
            if method == "POST":
                if data["id"] != uid:
                    return 403, json.dumps({"message": "row-level security"})
                row = {"avatar": "🙂", "daily_goal": 100, "program": None, "group_id": None, "status": None,
                       "status_at": None}
                row.update(data)
                self.profiles[uid] = row
                return 201, json.dumps([row])
            if method == "PATCH":
                if eq.get("id") != uid or "group_id" in data:
                    return 403, json.dumps({"message": "row-level security"})
                self.profiles[uid].update(data)
                return 200, json.dumps([self.profiles[uid]])
        if table == "groups" and method == "GET":
            g = self._group_of(uid)
            return 200, json.dumps([self.groups[g]] if g else [])
        if table == "days":
            if method == "POST":
                for r in data:
                    if r["user_id"] != uid:
                        return 403, json.dumps({"message": "row-level security"})
                    self.days[(uid, r["day"])] = dict(r)
                return 201, ""
            since = query["day"][0].split(".", 1)[1]
            rows = sorted((r for (u, day), r in self.days.items() if self._visible(uid, u) and day >= since),
                          key=lambda r: r["day"])
            return 200, json.dumps(rows)
        if table == "events":
            if method == "POST":
                if data["group_id"] != self._group_of(uid):
                    return 403, json.dumps({"message": "row-level security"})
                self._event(data["group_id"], uid, data["kind"], data.get("payload"))
                return 201, ""
            g = self._group_of(uid)
            rows = [e for e in self.events if e["group_id"] == g]
            if "kind" in query:
                kinds = query["kind"][0][4:-1].split(",")
                rows = [e for e in rows if e["kind"] in kinds]
            if "created_at" in query:
                since = query["created_at"][0].split(".", 1)[1]
                rows = [e for e in rows if e["created_at"][:10] >= since[:10]]
            if query.get("order") != ["id.asc"]:
                rows = rows[::-1]
            return 200, json.dumps(rows[: int(query.get("limit", ["60"])[0])])
        if table == "reactions":
            if method == "POST":
                self.reactions.add((data["event_id"], uid, data["emoji"]))
                return 201, ""
            if method == "DELETE":
                self.reactions.discard((int(eq["event_id"]), uid, eq["emoji"]))
                return 204, ""
            ids = query["event_id"][0][4:-1].split(",")
            return 200, json.dumps([{"event_id": e, "user_id": u, "emoji": em} for e, u, em in self.reactions
                                    if str(e) in ids])
        return 404, json.dumps({"message": f"unknown {method} {path}"})

    def _rpc(self, name, uid, data):
        if uid not in self.profiles:
            return 400, json.dumps({"message": "Crée ton profil avant de rejoindre un groupe."})
        if name == "create_group":
            gid = str(uuid.uuid4())
            code = gid.replace("-", "")[:6].upper()
            self.groups[gid] = {"id": gid, "code": code, "name": data["p_name"],
                               "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            self.profiles[uid]["group_id"] = gid
            self._event(gid, uid, "joined")
            return 200, json.dumps(code)
        if name == "join_group":
            g = next((g for g in self.groups.values() if g["code"] == data["p_code"].upper()), None)
            if g is None:
                return 400, json.dumps({"message": "Aucun groupe avec ce code."})
            self.profiles[uid]["group_id"] = g["id"]
            self._event(g["id"], uid, "joined")
            return 200, json.dumps(g["name"])
        if name == "leave_group":
            self.profiles[uid]["group_id"] = None
            return 204, ""
        return 404, ""
