"""Opens the group window in a normal browser with a fake server and two
fake players (nothing goes online): python tools/dev_server.py [--port=8790] [--empty] [--update] [--pomo]"""
import datetime
import json
import os
import random
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tests"))
from helpers import load  # noqa: E402
from fake_supabase import FakeSupabase  # noqa: E402

M = load()

PORT = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--port=")), "8790"))
tmp = tempfile.mkdtemp()
fake = FakeSupabase()


def player(name):
    srv = M["server"].Server("https://fake", "k", os.path.join(tmp, name, "s.json"), opener=fake)
    return M["api"].MultiAPI(srv, lambda: None, os.path.join(tmp, name, "state.json"))


me = player("moi")
if "--empty" not in sys.argv:
    today = datetime.date.today()

    def days(goal, skip):
        rng = random.Random(goal)   # the same days at every sync
        return [{"day": (today - datetime.timedelta(days=i)).isoformat(), "cards": 0 if rng.random() < skip else int(goal * rng.uniform(0.6, 1.4)),
                 "minutes": rng.randint(20, 90), "new_cards": rng.randint(5, 40), "review_count": rng.randint(50, 200),
                 "retention": round(rng.uniform(0.75, 0.93), 3), "overdue": None} for i in range(200, -1, -1)]
    friend = player("ami")
    friend.collect = lambda: days(60, 0.15)
    me.collect = lambda: days(300, 0.1)
    me.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300, "program": "Médecine"})
    friend.call("save_profile", {"pseudo": "Xyroob", "avatar": "🧬", "daily_goal": 60, "program": "Bac biologie"})
    code = me.call("create_group", {"name": "Les rats de bibliothèque"})["code"]
    friend.call("join_group", {"code": code})
    friend.server.set_status("study")
    # the group started 5 weeks ago: past duels, a finished boss and a settled bet to look at
    started = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=35)
    for g in fake.groups.values():
        g["created_at"] = started.isoformat()
    for e in fake.events:
        e["created_at"] = started.isoformat()
    past = lambda n: (today - datetime.timedelta(days=n)).isoformat()
    at = lambda n: (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=n)).isoformat()
    gid = next(iter(fake.groups))
    fake.events.append({"id": next(fake.ids), "group_id": gid, "user_id": me.server.user_id, "kind": "challenge",
                        "payload": {"type": "boss", "target": 150, "start": past(20), "end": past(14)}, "created_at": at(20)})
    bet_id = next(fake.ids)
    fake.events.append({"id": bet_id, "group_id": gid, "user_id": friend.server.user_id, "kind": "bet",
                        "payload": {"type": "duel", "opponent": me.server.user_id, "stake": 20, "start": past(12), "end": past(9)},
                        "created_at": at(13)})
    fake.events.append({"id": next(fake.ids), "group_id": gid, "user_id": me.server.user_id, "kind": "bet_accept",
                        "payload": {"ref": bet_id}, "created_at": at(13)})
    friend.sync()
    me.sync()
    # a few défis, a bet and messages to look at
    t = today.isoformat()
    sun = (today + datetime.timedelta(days=(6 - today.weekday()) or 7)).isoformat()
    me.call("create_challenge", {"type": "boss", "target": 400, "start": t, "end": sun})
    friend.sync()
    friend.call("create_challenge", {"type": "zero", "target": 3, "start": t, "end": sun})
    friend.call("create_bet", {"type": "duel", "opponent": me.server.user_id, "stake": 10, "start": t, "end": sun})
    friend.call("send_message", {"code": "pomo"})
    if "--pomo" in sys.argv:
        friend.call("start_pomodoro", {"work": 25, "rest": 5, "rounds": 4})
    me.sync()
else:
    me.collect = lambda: []
if "--update" in sys.argv:
    me.update = {"version": 99, "nouveautes": "Exemple de nouveautés."}

def presence_page():
    read = M["page"]._read
    start = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=3)).isoformat()
    data = {"corner": me.settings()["corner"], "sound": False, "live": [{"pseudo": "Xyroob", "avatar": "🧬"}],
            "pomo": {"id": 1, "start": start, "work": 25, "rest": 5, "rounds": 4},
            "messages": [{"pseudo": "Xyroob", "avatar": "🧬", "text": "Courage, tu peux le faire 💪", "verb": False, "click": "open"},
                         {"pseudo": "Xyroob", "avatar": "🧬", "text": "lance un pomodoro 🍅 (clique pour le rejoindre)",
                          "verb": True, "click": "pomo:1"}]}
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{read('presence.css')}"
            "body{font:20px system-ui;text-align:center;padding-top:200px;background:#fafafa}"
            ".casino{position:fixed;top:10px;right:10px;width:220px;height:300px;background:#2a1a3a;color:#fff;"
            "border-radius:12px;padding:10px;font-size:13px}</style>"
            f"<script>{read('presence.js')}</script></head><body><div class='casino'>(ton casino, à droite)</div>"
            "<div>Recto de la carte : ...</div><script>window.pycmd=function(c){document.title=c;};"
            f"setTimeout(function(){{mjLive({json.dumps(data, ensure_ascii=False)});}},300);</script></body></html>")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/revision"):   # the review screen with the little overlay
            body = presence_page().encode("utf-8")
        else:
            body = M["page"].build_page(me.snapshot()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        out = json.dumps(me.call(req["name"], req.get("payload")), ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)


print(f"http://localhost:{PORT}")
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
