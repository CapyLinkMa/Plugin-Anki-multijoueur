"""Opens the group window in a normal browser with a fake server and two
fake players (nothing goes online): python tools/dev_server.py [--port=8790] [--empty]"""
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
    rng = random.Random(4)
    today = datetime.date.today()

    def days(goal, skip):
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
    friend.sync()
    me.sync()
else:
    me.collect = lambda: []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
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
