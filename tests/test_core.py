"""Tests without Anki's GUI: the group rules, the server client (against an
in-memory fake server) and a full sync between two players.
Run: python -m unittest discover tests"""

import datetime
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers import load  # noqa: E402
from fake_supabase import FakeSupabase  # noqa: E402

M = load()
group, server_mod, api_mod = M["group"], M["server"], M["api"]


def row(uid, day, cards, goal=100, **kw):
    r = {"user_id": uid, "day": day, "cards": cards, "minutes": cards // 4, "new_cards": cards // 10,
         "review_count": cards // 2, "retention": 0.9, "overdue": None, "goal": goal}
    r.update(kw)
    return r


class GroupRules(unittest.TestCase):
    def setUp(self):
        # médecine: 300 cards/day goal; biologie: 60/day
        self.members = [{"id": "a", "pseudo": "Med", "daily_goal": 300}, {"id": "b", "pseudo": "Bio", "daily_goal": 60}]
        self.today = "2026-10-01"   # a Thursday

    def test_fair_ranking_uses_own_goal(self):
        rows = []
        for i, day in enumerate(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]):
            rows.append(row("a", day, 300, goal=300))          # 100 % every day, 1 200 cards
            rows.append(row("b", day, 75 if i < 3 else 0, goal=60))  # 125 % x3 then nothing
        v = group.build(self.members, rows, self.today, "a")
        players = {p["id"]: p for p in v["players"]}
        self.assertEqual(players["a"]["week"]["pct"], 100)
        self.assertEqual(players["b"]["week"]["pct"], round(100 * 3 * 1.25 / 4))   # 94
        self.assertEqual(v["ranking"], ["a", "b"])
        self.assertEqual(players["a"]["week"]["cards"], 1200)
        self.assertEqual(players["b"]["week"]["cards"], 225)

    def test_one_huge_day_is_capped(self):
        rows = [row("b", "2026-09-28", 6000, goal=60)]    # 100x the goal in a day
        v = group.build(self.members, rows, self.today, "a")
        b = next(p for p in v["players"] if p["id"] == "b")
        self.assertEqual(b["week"]["pct"], round(100 * group.PCT_CAP / 4))

    def test_streaks_group_streak_and_week_goal(self):
        rows = []
        for day in ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]:
            rows += [row("a", day, 310, goal=300), row("b", day, 60, goal=60)]
        rows.append(row("a", "2026-09-26", 300, goal=300))
        v = group.build(self.members, rows, self.today, "a")      # today not done yet: streak still counts
        players = {p["id"]: p for p in v["players"]}
        self.assertEqual((players["a"]["streak"], players["b"]["streak"]), (5, 4))
        self.assertEqual(v["group_streak"], 4)
        self.assertEqual(v["regularity"], ["a", "b"])
        self.assertFalse(v["week_goal"]["done"])                  # 3 days so far this week
        self.assertEqual(players["a"]["records"]["longest_streak"], 5)
        rows.append(row("b", "2026-10-01", 10, goal=60))
        self.assertEqual(group.build(self.members, rows, self.today, "a")["group_streak"], 4)

    def test_milestones_fire_once(self):
        m = {"id": "a", "daily_goal": 100}
        rows = {d: row("a", d, 120) for d in ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28",
                                               "2026-09-29", "2026-09-30"]}
        rows["2026-10-01"] = row("a", "2026-10-01", 400)
        events = group.milestones(rows, m, "2026-10-01", set())
        self.assertEqual([e[1] for e in events], ["goal", "record", "streak"])
        self.assertEqual(group.milestones(rows, m, "2026-10-01", {e[0] for e in events}), [])

    def test_live_status(self):
        now = datetime.datetime(2026, 10, 1, 12, 0, tzinfo=datetime.timezone.utc)
        self.assertTrue(group.is_live({"status": "study", "status_at": "2026-10-01T11:55:00+00:00"}, now))
        self.assertFalse(group.is_live({"status": "study", "status_at": "2026-10-01T11:00:00+00:00"}, now))
        self.assertFalse(group.is_live({"status": "study", "status_at": "2026-10-01T11:54:00+00:00"}, now, minutes=5))
        self.assertFalse(group.is_live({"status": "idle", "status_at": "2026-10-01T11:59:00+00:00"}, now))


class TwoPlayers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fake = FakeSupabase()

    def player(self, name, days):
        srv = server_mod.Server("https://x.supabase.co", "sb_publishable_test", os.path.join(self.tmp, name, "session.json"),
                                opener=self.fake)
        api = api_mod.MultiAPI(srv, lambda: None, os.path.join(self.tmp, name, "state.json"))
        api.collect = lambda: days   # no Anki collection here
        return api

    def test_presence_dot_and_message_bubbles(self):
        """Pendant les révisions : le point « il/elle révise » et les bulles de messages."""
        med, bio = self.player("med", []), self.player("bio", [])
        med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        bio.call("save_profile", {"pseudo": "Ami", "avatar": "🧬", "daily_goal": 60})
        code = med.call("create_group", {"name": "Duo"})["code"]
        bio.call("join_group", {"code": code})
        med.sync(), bio.sync()
        bio.call("send_message", {"code": "go"})          # written before the first check: never shown
        seen = []
        self.assertTrue(med.live_check(seen.append))
        self.assertEqual(seen[-1], {"live": [], "messages": []})
        bio.set_studying()
        bio.call("send_message", {"code": "courage"})
        med.call("send_message", {"code": "bravo"})       # my own message: no bubble for me
        bio.call("encourage", {"player_id": med.server.user_id})
        med.live_check(seen.append)
        self.assertEqual(seen[-1]["live"], [{"pseudo": "Ami", "avatar": "🧬"}])
        self.assertEqual([m["text"] for m in seen[-1]["messages"]], ["Courage, tu peux le faire 💪", "t'encourage ! 💪"])
        self.assertEqual(seen[-1]["messages"][0]["pseudo"], "Ami")
        med.live_check(seen.append)                       # each message is shown only once
        self.assertEqual(seen[-1]["messages"], [])
        again = self.player("med", [])                    # Anki restarted: still remembered
        again.cache["profile"] = med.cache["profile"]
        again.live_check(seen.append)
        self.assertEqual(seen[-1]["messages"], [])
        bio.set_idle()                                    # left the reviews: the dot goes away
        med.live_check(seen.append)
        self.assertEqual(seen[-1]["live"], [])
        old = {"id": 10 ** 6, "user_id": bio.server.user_id, "kind": "msg", "payload": {"code": "go"},
               "created_at": "2020-01-01T00:00:00+00:00"}     # Anki was closed for ages: not shown
        self.assertEqual(med.live_view(med.cache["members"], [old], 1)["messages"], [])

    def test_create_join_sync_and_react(self):
        today = datetime.date.today()
        mk = lambda n, c: [{"day": (today - datetime.timedelta(days=i)).isoformat(), "cards": c, "minutes": 30,
                            "new_cards": 10, "review_count": 50, "retention": 0.9, "overdue": None}
                           for i in range(n - 1, -1, -1)]
        med, bio = self.player("med", mk(10, 320)), self.player("bio", mk(10, 70))
        self.assertIsNone(med.snapshot()["profile"])
        self.assertTrue(med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})["ok"])
        self.assertTrue(bio.call("save_profile", {"pseudo": "Ami", "avatar": "🧬", "daily_goal": 60})["ok"])
        code = med.call("create_group", {"name": "Les rats de bibliothèque"})["code"]
        self.assertEqual(bio.call("join_group", {"code": code.lower()})["name"], "Les rats de bibliothèque")
        med.sync()
        snap = med.snapshot()
        self.assertEqual(snap["group"]["code"], code)
        self.assertEqual({p["pseudo"] for p in snap["view"]["players"]}, {"Slava", "Ami"})
        self.assertEqual(snap["view"]["group_streak"], 10)
        kinds = [e["kind"] for e in snap["feed"]]
        self.assertIn("goal", kinds)
        self.assertEqual(kinds.count("joined"), 2)
        goal_event = next(e for e in bio.snapshot()["feed"] if e["kind"] == "goal" and e["who"]["pseudo"] == "Slava")
        bio.call("react", {"event_id": goal_event["id"], "emoji": "🔥"})
        med.sync()
        mine = next(e for e in med.snapshot()["feed"] if e["id"] == goal_event["id"])
        self.assertEqual(mine["reactions"], {"🔥": ["Ami"]})
        before = len(self.fake.events)
        med.sync()
        self.assertEqual(len(self.fake.events), before)      # milestones post only once
        # encourage (feature 17): once a day, shown in the feed with the friend's name
        bio_id = bio.server.user_id
        self.assertTrue(med.call("encourage", {"player_id": bio_id})["ok"])
        self.assertFalse(med.call("encourage", {"player_id": bio_id})["ok"])
        self.assertFalse(med.call("encourage", {"player_id": "stranger"})["ok"])
        nudge = next(e for e in med.snapshot()["feed"] if e["kind"] == "encourage")
        self.assertEqual((nudge["who"]["pseudo"], nudge["to"]), ("Slava", "Ami"))
        ami = next(p for p in med.snapshot()["view"]["players"] if p["id"] == bio_id)
        self.assertTrue(ami["encouraged"])
        self.assertIsNotNone(ami["goal_event"])               # "Féliciter" reacts to today's goal

    def test_a_stranger_sees_nothing(self):
        med = self.player("med", [])
        med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        med.call("create_group", {"name": "G"})
        other = self.player("other", [])
        other.call("save_profile", {"pseudo": "Inconnu", "avatar": "🙂", "daily_goal": 100})
        other.sync()
        self.assertIsNone(other.snapshot()["group"])
        self.assertEqual(other.server.members(), [other.server.my_profile()])

    def test_offline_and_errors_are_explained(self):
        med = self.player("med", [])
        self.fake.online = False
        res = med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        self.assertFalse(res["ok"])
        self.assertIn("connexion", res["error"])
        self.fake.online = True
        self.fake.anonymous_enabled = False
        res = med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        self.assertIn("anonymes", res["error"])
        self.assertFalse(med.call("join_group", {"code": "AB"})["ok"])
        self.assertFalse(med.call("save_profile", {"pseudo": "x", "avatar": "🦫", "daily_goal": 5})["ok"])

    def test_secure_account_then_sign_in_on_another_computer(self):
        today = datetime.date.today().isoformat()
        med = self.player("med", [{"day": today, "cards": 350, "minutes": 60, "new_cards": 20, "review_count": 200,
                                   "retention": 0.9, "overdue": 0}])
        med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        med.call("create_group", {"name": "G"})
        self.assertFalse(med.snapshot()["account"]["secured"])
        self.assertFalse(med.call("secure_account", {"username": "é!", "password": "12345678"})["ok"])
        self.assertFalse(med.call("secure_account", {"username": "slava", "password": "court"})["ok"])
        self.assertTrue(med.call("secure_account", {"username": "Slava_M", "password": "motdepasse1"})["ok"])
        self.assertEqual(med.snapshot()["account"]["username"], "slava_m")
        other = self.player("other", [])
        other.call("save_profile", {"pseudo": "X", "avatar": "🦫", "daily_goal": 100})
        self.assertEqual(other.call("secure_account", {"username": "slava_m", "password": "autrechose"})["error"], "Ce nom d'utilisateur est déjà pris.")
        uid = med.server.user_id
        laptop = self.player("laptop", [])
        res = laptop.call("sign_in", {"username": "slava_m", "password": "mauvais!!"})
        self.assertEqual(res["error"], "Nom d'utilisateur ou mot de passe incorrect.")
        self.assertTrue(laptop.call("sign_in", {"username": "SLAVA_M", "password": "motdepasse1"})["ok"])
        snap = laptop.snapshot()
        self.assertEqual(laptop.server.user_id, uid)          # same player, same history
        self.assertEqual(snap["profile"]["pseudo"], "Slava")
        self.assertEqual(snap["group"]["name"], "G")
        me = next(p for p in snap["view"]["players"] if p["me"])
        self.assertEqual(me["today_cards"], 350)

    def test_confirmation_email_setting_is_explained(self):
        self.fake.confirm_email = True
        med = self.player("med", [])
        med.call("save_profile", {"pseudo": "Slava", "avatar": "🦫", "daily_goal": 300})
        res = med.call("secure_account", {"username": "slava", "password": "motdepasse1"})
        self.assertIn("Confirm email", res["error"])

    def test_catch_up_window_after_a_break(self):
        med = self.player("med", [])
        self.assertEqual(med.days_to_send(), api_mod.FIRST_SYNC_DAYS)
        med.store["first_sync_done"] = True
        med.store["last_push_day"] = datetime.date.today().isoformat()
        self.assertEqual(med.days_to_send(), api_mod.SYNC_DAYS)
        med.store["last_push_day"] = (datetime.date.today() - datetime.timedelta(days=40)).isoformat()
        self.assertEqual(med.days_to_send(), 42)

    def test_session_is_kept_and_refreshed(self):
        clock = [1000.0]
        path = os.path.join(self.tmp, "s", "session.json")
        srv = server_mod.Server("https://x", "k", path, opener=self.fake, clock=lambda: clock[0])
        uid = srv.user_id_or_session()
        clock[0] += 7200   # token expired: refreshed, same player
        again = server_mod.Server("https://x", "k", path, opener=self.fake, clock=lambda: clock[0])
        again.ensure_session()
        self.assertEqual(again.user_id, uid)
        self.assertEqual(sum(1 for m, u in self.fake.calls if u.endswith("/auth/v1/signup")), 1)


if __name__ == "__main__":
    unittest.main()
