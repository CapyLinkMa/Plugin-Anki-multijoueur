"""Talking to the group's Supabase server with the standard library only
(Anki has no pip). Qt-free: the HTTP opener can be replaced in tests.

Each player is an anonymous Supabase user: the first launch creates one,
and its tokens live in user_files/session.json on this computer only. The
publishable key in config.json is public by design; the server's rules
(supabase/schema.sql) decide what each player may read and write.
"""

import datetime
import json
import os
import time
import urllib.error
import urllib.request

TIMEOUT = 10


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


LOGIN_DOMAIN = "joueurs.anki-multijoueur.app"   # never emailed: Supabase just needs an address-shaped login


def login_address(username):
    return f"{username.lower()}@{LOGIN_DOMAIN}"


def username_of(address):
    if address and address.endswith("@" + LOGIN_DOMAIN):
        return address.split("@")[0]
    return address


class ServerError(Exception):
    """A request that failed, with a message fit for the player."""


def _message(status, body):
    try:
        data = json.loads(body)
    except ValueError:
        data = {}
    text = data.get("message") or data.get("msg") or data.get("error_description") or data.get("error") or ""
    if status in (0, None):
        return "Pas de connexion au serveur : vérifie internet. Tes chiffres seront envoyés plus tard."
    if "anonymous" in str(text).lower() and "disabled" in str(text).lower():
        return "Le serveur n'autorise pas encore les comptes anonymes (réglage Supabase à activer)."
    if text:
        return str(text)
    return f"Erreur du serveur ({status})."


def default_opener(method, url, headers, body):
    """-> (status, text). Network errors come back as status 0."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, TimeoutError):
        return 0, ""


class Server:
    def __init__(self, url, key, session_path, opener=default_opener, clock=time.time):
        self.url = url.rstrip("/")
        self.key = key
        self.session_path = session_path
        self.opener = opener
        self.clock = clock
        self.session = self._load()

    # -- session ------------------------------------------------------------------------
    def _load(self):
        try:
            with open(self.session_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def _save(self):
        os.makedirs(os.path.dirname(self.session_path), exist_ok=True)
        tmp = self.session_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.session, f)
        os.replace(tmp, self.session_path)

    @property
    def user_id(self):
        return (self.session or {}).get("user_id")

    def _store(self, data):
        user = data.get("user") or {}
        old = self.session or {}
        self.session = {"access_token": data["access_token"], "refresh_token": data["refresh_token"],
                        "expires_at": self.clock() + int(data.get("expires_in") or 3600),
                        "user_id": user.get("id") or old.get("user_id"),
                        "email": user.get("email") or (old.get("email") if not user else None) or None}
        self._save()

    @property
    def username(self):
        """The login once the account is secured with a password (None = anonymous)."""
        return username_of((self.session or {}).get("email"))

    def _raw(self, method, path, body=None, token=None, extra=None):
        headers = {"apikey": self.key, "Content-Type": "application/json",
                   "Authorization": f"Bearer {token or self.key}"}
        headers.update(extra or {})
        data = json.dumps(body).encode("utf-8") if body is not None else None
        status, text = self.opener(method, self.url + path, headers, data)
        if status == 0 or status >= 400:
            raise ServerError(_message(status, text))
        return json.loads(text) if text.strip() else None

    def ensure_session(self):
        """A valid access token: the first time an anonymous account is
        created; later the saved one is refreshed when it expires."""
        if self.session and self.session.get("expires_at", 0) > self.clock() + 60:
            return self.session["access_token"]
        if self.session and self.session.get("refresh_token"):
            try:
                self._store(self._raw("POST", "/auth/v1/token?grant_type=refresh_token",
                                      {"refresh_token": self.session["refresh_token"]}))
                return self.session["access_token"]
            except ServerError as exc:
                if "connexion" in str(exc):
                    raise
                # a refresh token that no longer works: the account is lost, start a new one
        self._store(self._raw("POST", "/auth/v1/signup", {"data": {}}))
        return self.session["access_token"]

    def request(self, method, path, body=None, prefer=None):
        token = self.ensure_session()
        extra = {"Prefer": prefer} if prefer else None
        return self._raw(method, path, body, token, extra)

    # -- account: anonymous at first, secured with an email + password when wanted --------------------
    def secure_account(self, username, password):
        """Adds a username and a password to this (anonymous) account: same
        player, same history, now recoverable on another computer."""
        email = login_address(username)
        token = self.ensure_session()
        try:
            user = self._raw("PUT", "/auth/v1/user", {"email": email, "password": password}, token)
        except ServerError as exc:
            if "already" in str(exc).lower():
                raise ServerError("Ce nom d'utilisateur est déjà pris.")
            raise
        if ((user or {}).get("email") or "").lower() != email:
            raise ServerError("Le serveur demande une confirmation par courriel : désactive « Confirm email » dans Supabase.")
        self.session["email"] = user["email"]
        self._save()
        # a fresh token that carries the new identity
        self._store(self._raw("POST", "/auth/v1/token?grant_type=refresh_token",
                              {"refresh_token": self.session["refresh_token"]}))

    def sign_in(self, username, password):
        """Takes over a secured account on this computer (replaces the current one)."""
        try:
            data = self._raw("POST", "/auth/v1/token?grant_type=password",
                             {"email": login_address(username), "password": password})
        except ServerError as exc:
            if "invalid" in str(exc).lower() or "credentials" in str(exc).lower():
                raise ServerError("Nom d'utilisateur ou mot de passe incorrect.")
            raise
        self._store(data)

    def sign_out(self):
        self.session = None
        try:
            os.remove(self.session_path)
        except OSError:
            pass

    # -- the calls the add-on makes -------------------------------------------------------------
    def my_profile(self):
        rows = self.request("GET", f"/rest/v1/profiles?id=eq.{self.user_id_or_session()}&select=*")
        return rows[0] if rows else None

    def user_id_or_session(self):
        self.ensure_session()
        return self.user_id

    def save_profile(self, pseudo, avatar, daily_goal, program=None):
        body = {"id": self.user_id_or_session(), "pseudo": pseudo, "avatar": avatar, "daily_goal": int(daily_goal),
                "program": program or None}
        if self.my_profile() is None:
            return self.request("POST", "/rest/v1/profiles", body, prefer="return=representation")[0]
        body.pop("id")
        body["updated_at"] = now_iso()
        return self.request("PATCH", f"/rest/v1/profiles?id=eq.{self.user_id}", body, prefer="return=representation")[0]

    def set_status(self, status):
        self.request("PATCH", f"/rest/v1/profiles?id=eq.{self.user_id_or_session()}",
                     {"status": status, "status_at": now_iso()})

    def create_group(self, name):
        return self.request("POST", "/rest/v1/rpc/create_group", {"p_name": name})

    def join_group(self, code):
        return self.request("POST", "/rest/v1/rpc/join_group", {"p_code": code})

    def leave_group(self):
        return self.request("POST", "/rest/v1/rpc/leave_group", {})

    def push_days(self, rows):
        if rows:
            self.request("POST", "/rest/v1/days?on_conflict=user_id,day",
                         [dict(r, user_id=self.user_id_or_session()) for r in rows],
                         prefer="resolution=merge-duplicates")

    def group(self):
        rows = self.request("GET", "/rest/v1/groups?select=id,code,name")
        return rows[0] if rows else None

    def members(self):
        return self.request("GET", "/rest/v1/profiles?select=*&order=pseudo") or []

    def days_since(self, iso):
        return self.request("GET", f"/rest/v1/days?select=*&day=gte.{iso}&order=day") or []

    def events(self, limit=60):
        return self.request("GET", f"/rest/v1/events?select=*&order=id.desc&limit={int(limit)}") or []

    def reactions(self, event_ids):
        if not event_ids:
            return []
        ids = ",".join(str(int(i)) for i in event_ids)
        return self.request("GET", f"/rest/v1/reactions?select=*&event_id=in.({ids})") or []

    def post_event(self, group_id, kind, payload):
        self.request("POST", "/rest/v1/events", {"group_id": group_id, "kind": kind, "payload": payload})

    def react(self, event_id, emoji, on=True):
        if on:
            self.request("POST", "/rest/v1/reactions", {"event_id": int(event_id), "emoji": emoji},
                         prefer="resolution=ignore-duplicates")
        else:
            self.request("DELETE", f"/rest/v1/reactions?event_id=eq.{int(event_id)}&user_id=eq.{self.user_id}"
                                   f"&emoji=eq.{urllib.request.quote(emoji)}")
