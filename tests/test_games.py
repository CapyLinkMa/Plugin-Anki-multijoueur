"""Défis, paris, saisons, badges, points multijoueur, pomodoro et messages.
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
games, server_mod, api_mod = M["games"], M["server"], M["api"]

D0 = datetime.date(2026, 10, 1)
MEMBERS = [{"id": "med", "pseudo": "Med", "daily_goal": 300}, {"id": "bio", "pseudo": "Bio", "daily_goal": 60}]


def day(n):
    return (D0 + datetime.timedelta(days=n)).isoformat()


def full_day(uid, n, goal, overdue=0, retention=0.9, factor=1.0):
    return {"user_id": uid, "day": day(n), "cards": int(goal * factor), "goal": goal, "overdue": overdue,
            "review_count": goal // 2, "retention": retention, "minutes": 30, "new_cards": 5}


class Ev:
    def __init__(self):
        self.list = []

    def add(self, uid, kind, payload, n=0, hour=12):
        at = datetime.datetime.combine(D0 + datetime.timedelta(days=n), datetime.time(hour)).astimezone()
        self.list.append({"id": len(self.list) + 1, "user_id": uid, "kind": kind, "payload": payload,
                          "created_at": at.isoformat()})
        return len(self.list)


def build(rows, ev, today_n, me="med", now=None):
    return games.build(MEMBERS, rows, ev.list, day(today_n), me, day(0), now)


class Challenges(unittest.TestCase):
    def test_custom_group_challenge_in_days_rewards_everyone_who_makes_it(self):
        ev = Ev()
        ev.add("med", "challenge", {"type": "custom", "metric": "days", "target": 3, "start": day(0), "end": day(4)})
        rows = [full_day("med", n, 300) for n in range(3)] + [full_day("bio", n, 60) for n in (0, 2)]
        g = build(rows, ev, 2)
        c = g["challenges"][0]
        self.assertEqual(c["status"], "active")
        self.assertEqual({p["id"]: p["done"] for p in c["players"]}, {"med": True, "bio": False})
        self.assertEqual(c["rewards"], {"med": 9})
        self.assertEqual(build(rows, ev, 6)["challenges"][0]["status"], "over")

    def test_cards_challenge_only_for_yourself(self):
        clean, err = games.check_challenge({"type": "custom", "metric": "cards", "target": 500,
                                            "start": day(0), "end": day(4)}, D0)
        self.assertIn("seulement pour toi", err)
        clean, err = games.check_challenge({"type": "custom", "metric": "cards", "target": 500, "solo": True,
                                            "start": day(0), "end": day(4)}, D0)
        self.assertIsNone(err)
        ev = Ev()
        ev.add("bio", "challenge", clean)
        g = build([full_day("bio", 0, 300), full_day("bio", 1, 300)], ev, 1)
        c = g["challenges"][0]
        self.assertEqual([p["id"] for p in c["players"]], ["bio"])
        self.assertEqual(c["status"], "won")
        self.assertEqual(c["rewards"], {})       # a target you set yourself pays no points

    def test_zero_backlog(self):
        ev = Ev()
        ev.add("bio", "challenge", {"type": "zero", "target": 2, "start": day(0), "end": day(2)})
        rows = [full_day("med", 0, 300, overdue=40), full_day("med", 1, 300, overdue=0),
                full_day("bio", 0, 60), full_day("bio", 1, 60)]
        c = build(rows, ev, 1)["challenges"][0]
        self.assertEqual({p["id"]: p["value"] for p in c["players"]}, {"med": 1, "bio": 2})
        self.assertEqual(c["rewards"], {"bio": 6})

    def test_race_is_won_by_the_first_to_the_target(self):
        ev = Ev()
        ev.add("med", "challenge", {"type": "race", "target": 40, "start": day(0)})
        rows = [full_day("med", n, 300, overdue=50) for n in range(5)] + [full_day("bio", n, 60) for n in range(5)]
        c = build(rows, ev, 4)["challenges"][0]
        self.assertEqual(c["winners"], ["bio"])    # finished days with no backlog: more points a day
        self.assertEqual(c["status"], "won")
        self.assertEqual(c["end"], day(29))

    def test_team_boss(self):
        ev = Ev()
        ev.add("med", "challenge", {"type": "boss", "target": 100, "start": day(0), "end": day(6)})
        rows = [full_day("med", n, 300) for n in range(3)] + [full_day("bio", n, 60) for n in range(3)]
        g = build(rows, ev, 1)
        boss = g["challenges"][0]
        self.assertEqual(boss["status"], "active")
        self.assertGreater(boss["hp_left"], 0)
        boss = build(rows, ev, 2)["challenges"][0]
        self.assertEqual(boss["status"], "won")
        self.assertEqual(boss["rewards"], {"med": 5, "bio": 5})
        self.assertEqual(build([], ev, 7)["challenges"][0]["status"], "lost")

    def test_no_farming_and_cancel(self):
        ev = Ev()
        for _ in range(games.MAX_ACTIVE + 2):
            ev.add("med", "challenge", {"type": "custom", "metric": "points", "target": 10, "start": day(0), "end": day(2)})
        self.assertEqual(len(build([], ev, 0)["challenges"]), games.MAX_ACTIVE)
        ev2 = Ev()
        cid = ev2.add("med", "challenge", {"type": "custom", "metric": "points", "target": 10, "start": day(1), "end": day(2)})
        ev2.add("bio", "cancel", {"ref": cid})     # not theirs: ignored
        self.assertEqual(len(build([], ev2, 0)["challenges"]), 1)
        ev2.add("med", "cancel", {"ref": cid})
        self.assertEqual(build([], ev2, 0)["challenges"], [])

    def test_bad_challenges_are_refused(self):
        bad = [{"type": "custom", "metric": "days", "target": 9, "start": day(0), "end": day(2)},
               {"type": "custom", "metric": "points", "target": 10, "start": day(-1), "end": day(2)},
               {"type": "boss", "target": 10, "start": day(0), "end": day(2)},
               {"type": "custom", "metric": "points", "target": 10, "start": day(0), "end": day(60)},
               {"type": "nope"}]
        for p in bad:
            self.assertIsNotNone(games.check_challenge(p, D0)[1], p)


class Bets(unittest.TestCase):
    def rows(self):
        return [full_day("med", n, 300, overdue=50) for n in range(7)] + [full_day("bio", n, 60) for n in range(7)]

    def test_duel_bet_moves_points_once_settled(self):
        ev = Ev()
        bid = ev.add("med", "bet", {"type": "duel", "opponent": "bio", "stake": 20, "start": day(0), "end": day(2)})
        g = build(self.rows(), ev, 0)
        self.assertEqual(g["bets"][0]["status"], "pending")
        ev.add("bio", "bet_accept", {"ref": bid})
        g = build(self.rows(), ev, 1)
        self.assertEqual(g["bets"][0]["status"], "active")
        self.assertEqual(g["bets"][0]["net"], {})
        g = build(self.rows(), ev, 3)
        b = g["bets"][0]
        self.assertEqual((b["status"], b["winner"]), ("settled", "bio"))
        start = games.START_WALLET
        self.assertEqual(g["players"]["bio"]["wallet"], start + g["players"]["bio"]["xp"] + 20)
        self.assertEqual(g["players"]["med"]["wallet"], start + g["players"]["med"]["xp"] - 20)

    def test_objectif_bet_lost_as_soon_as_a_day_is_missed(self):
        ev = Ev()
        bid = ev.add("bio", "bet", {"type": "objectif", "opponent": "med", "stake": 10, "start": day(0), "end": day(4)})
        ev.add("med", "bet_accept", {"ref": bid})
        rows = [full_day("bio", 0, 60), full_day("bio", 2, 60)]
        b = build(rows, ev, 1)["bets"][0]
        self.assertEqual(b["status"], "active")       # today (day 1) isn't over yet
        b = build(rows, ev, 2)["bets"][0]
        self.assertEqual((b["status"], b["winner"]), ("settled", "med"))

    def test_unanswered_declined_or_late_bets_change_nothing(self):
        ev = Ev()
        ev.add("med", "bet", {"type": "duel", "opponent": "bio", "stake": 20, "start": day(0), "end": day(1)})
        b2 = ev.add("med", "bet", {"type": "duel", "opponent": "bio", "stake": 20, "start": day(0), "end": day(1)})
        ev.add("bio", "bet_decline", {"ref": b2})
        b3 = ev.add("med", "bet", {"type": "duel", "opponent": "bio", "stake": 20, "start": day(0), "end": day(1)})
        ev.add("bio", "bet_accept", {"ref": b3}, n=1)   # too late: the bet had started
        ev.add("med", "bet_accept", {"ref": b2})        # only the opponent can accept
        g = build(self.rows(), ev, 3)
        self.assertEqual(sorted(b["status"] for b in g["bets"]), ["declined", "expired", "expired"])
        self.assertEqual(g["players"]["med"]["wallet"], games.START_WALLET + g["players"]["med"]["xp"])


class Seasons(unittest.TestCase):
    def test_trophies_for_finished_months_and_the_report(self):
        start = datetime.date(2026, 10, 1)
        rows = []
        for n in range(31):
            rows.append(full_day("bio", n, 60))
            if n % 2 == 0:
                rows.append(full_day("med", n, 300, overdue=10, retention=0.8))
        g = games.build(MEMBERS, rows, [], "2026-11-03", "med", start.isoformat())
        self.assertEqual(g["players"]["bio"]["trophies"][0]["medal"], "🥇")
        self.assertIn("octobre 2026", g["players"]["bio"]["trophies"][0]["label"])
        self.assertEqual(g["players"]["med"]["trophies"][0]["medal"], "🥈")
        rep = g["reports"]["2026-10"]
        self.assertTrue(rep["complete"])
        self.assertEqual(rep["mvp"], "bio")
        self.assertEqual(rep["most_regular"], "bio")
        self.assertEqual(rep["all_done_days"], 16)
        self.assertEqual(g["season"]["name"], "novembre 2026")
        self.assertTrue(any(f["id"] == "champion" and f["open"] for f in g["players"]["bio"]["frames"]))
        self.assertFalse(any(f["id"] == "champion" and f["open"] for f in g["players"]["med"]["frames"]))

    def test_days_before_the_group_dont_count(self):
        rows = [full_day("med", n, 300) for n in range(-30, 1)]
        g = build(rows, Ev(), 0)
        self.assertEqual(g["players"]["med"]["xp"], 18)    # only today: 10 + 3 + 3 + 2


class LevelsAndBadges(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(games.Game.level(0)["title"], "Recrue")
        lv = games.Game.level(400)
        self.assertEqual((lv["title"], lv["next"], lv["pct"]), ("Studieux·se", 700, 25))
        self.assertIsNone(games.Game.level(99999)["next"])

    def test_frames_follow_the_level_and_the_choice(self):
        rows = [full_day("med", n, 300) for n in range(8)]
        ev = Ev()
        ev.add("med", "frame", {"frame": "bronze"})
        g = build(rows, ev, 7)
        self.assertEqual(g["players"]["med"]["frame"], "bronze")      # 8 x 18 = 144 points
        ev.add("med", "frame", {"frame": "diamant"})                   # not unlocked: ignored
        self.assertEqual(build(rows, ev, 7)["players"]["med"]["frame"], "aucun")

    def test_group_badges(self):
        rows = [full_day(u, n, g) for n in range(8) for u, g in (("med", 300), ("bio", 60))]
        badges = {b["id"]: b for b in build(rows, Ev(), 7)["badges"]}
        self.assertEqual(badges["serie"]["value"], 8)
        self.assertEqual(badges["serie"]["level"], 2)
        self.assertEqual(badges["ensemble"]["level"], 1)
        self.assertEqual(badges["zero"]["value"], 8)
        self.assertEqual(badges["cartes"]["value"], 8 * 360)


class Pomodoro(unittest.TestCase):
    def test_shared_timer(self):
        ev = Ev()
        pid = ev.add("med", "pomo", {"work": 25, "rest": 5, "rounds": 2}, hour=14)
        ev.add("bio", "pomo_join", {"ref": pid}, hour=14)
        start = datetime.datetime.combine(D0, datetime.time(14)).astimezone()
        g = build([], ev, 0, now=start + datetime.timedelta(minutes=27))
        pomo = g["pomodoro"]
        self.assertEqual(pomo["players"], ["med", "bio"])
        self.assertEqual(games.pomo_phase(pomo, start + datetime.timedelta(minutes=27)), ("rest", 1, 180))
        self.assertEqual(games.pomo_phase(pomo, start + datetime.timedelta(minutes=31))[:2], ("work", 2))
        g = build([], ev, 0, now=start + datetime.timedelta(minutes=61))
        self.assertIsNone(g["pomodoro"])
        self.assertEqual({b["id"]: b["value"] for b in g["badges"]}["pomo"], 1)

    def test_stopped(self):
        ev = Ev()
        pid = ev.add("med", "pomo", {"work": 25, "rest": 5, "rounds": 4}, hour=14)
        ev.add("bio", "pomo_stop", {"ref": pid}, hour=14)        # not theirs
        start = datetime.datetime.combine(D0, datetime.time(14)).astimezone()
        self.assertIsNotNone(build([], ev, 0, now=start + datetime.timedelta(minutes=5))["pomodoro"])
        ev.add("med", "pomo_stop", {"ref": pid}, hour=14)
        self.assertIsNone(build([], ev, 0, now=start + datetime.timedelta(minutes=5))["pomodoro"])


class ThroughTheAddon(unittest.TestCase):
    """Two players on the fake server, using the window's actions."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fake = FakeSupabase()
        today = datetime.date.today()
        self.days = lambda goal: [{"day": (today - datetime.timedelta(days=i)).isoformat(), "cards": goal, "minutes": 30,
                                   "new_cards": 5, "review_count": goal // 2, "retention": 0.9, "overdue": 0}
                                  for i in range(5, -1, -1)]

    def player(self, name, goal):
        srv = server_mod.Server("https://x.supabase.co", "k", os.path.join(self.tmp, name, "s.json"), opener=self.fake)
        api = api_mod.MultiAPI(srv, lambda: None, os.path.join(self.tmp, name, "state.json"))
        api.collect = lambda: self.days(goal)
        return api

    def test_challenge_bet_pomodoro_message_frame(self):
        med, bio = self.player("med", 300), self.player("bio", 60)
        med.call("save_profile", {"pseudo": "Med", "avatar": "🫀", "daily_goal": 300})
        bio.call("save_profile", {"pseudo": "Bio", "avatar": "🧬", "daily_goal": 60})
        code = med.call("create_group", {"name": "G"})["code"]
        bio.call("join_group", {"code": code})
        med.sync()
        today = datetime.date.today()
        end = (today + datetime.timedelta(days=3)).isoformat()
        r = med.call("create_challenge", {"type": "boss", "target": 200, "start": today.isoformat(), "end": end})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["snapshot"]["game"]["challenges"][0]["type"], "boss")
        self.assertFalse(med.call("create_challenge", {"type": "custom", "metric": "cards", "target": 5,
                                                       "start": today.isoformat(), "end": end})["ok"])
        # bets need points in the wallet: 50 to start + today's points
        r = med.call("create_bet", {"type": "duel", "opponent": bio.server.user_id, "stake": 500,
                                    "start": today.isoformat(), "end": end})
        self.assertFalse(r["ok"])
        r = med.call("create_bet", {"type": "duel", "opponent": bio.server.user_id, "stake": 5,
                                    "start": today.isoformat(), "end": end})
        self.assertTrue(r["ok"], r)
        bio.sync()
        bet = bio.snapshot()["game"]["bets"][0]
        self.assertEqual(bet["status"], "pending")
        self.assertTrue(bio.call("answer_bet", {"ref": bet["id"], "accept": True})["ok"])
        self.assertFalse(med.call("answer_bet", {"ref": bet["id"], "accept": True})["ok"])
        med.sync()
        self.assertEqual(med.snapshot()["game"]["bets"][0]["status"], "active")
        self.assertTrue(med.call("start_pomodoro", {"work": 25, "rest": 5, "rounds": 4})["ok"])
        bio.call("start_pomodoro", {"work": 50, "rest": 10, "rounds": 2})   # at the same time, before seeing it
        bio.sync()
        pomo = bio.snapshot()["game"]["pomodoro"]
        self.assertEqual(pomo["by"], med.server.user_id)                    # everyone follows the first one
        self.assertTrue(bio.call("join_pomodoro", {"ref": pomo["id"]})["ok"])
        self.assertIsNone(bio.pomodoro_alert())                     # first look: nothing to say
        later = datetime.datetime.fromisoformat(pomo["start"]) + datetime.timedelta(minutes=26)
        bio.now = lambda: later
        self.assertEqual(bio.pomodoro_alert(), "🍅 Pause ! 5 min")
        self.assertIsNone(bio.pomodoro_alert())                     # said once
        bio.now = lambda: datetime.datetime.now(datetime.timezone.utc)
        med.sync()
        self.assertEqual(len(med.snapshot()["game"]["pomodoro"]["players"]), 2)
        self.assertFalse(bio.call("stop_pomodoro", {"ref": pomo["id"]})["ok"])
        self.assertTrue(med.call("stop_pomodoro", {"ref": pomo["id"]})["ok"])
        self.assertIsNone(med.snapshot()["game"]["pomodoro"])
        self.assertTrue(bio.call("send_message", {"code": "pomo"})["ok"])
        self.assertFalse(bio.call("send_message", {"code": "insulte"})["ok"])
        med.sync()
        feed = med.snapshot()["feed"]
        self.assertTrue(any(e["kind"] == "msg" and e["payload"]["code"] == "pomo" for e in feed))
        self.assertFalse(any(e["kind"] in games.HIDDEN_IN_FEED for e in feed))
        self.assertFalse(med.call("set_frame", {"frame": "diamant"})["ok"])
        self.assertTrue(med.call("set_frame", {"frame": "aucun"})["ok"])

    def test_poll_refreshes_without_reading_anki(self):
        med, bio = self.player("med", 300), self.player("bio", 60)
        med.call("save_profile", {"pseudo": "Med", "avatar": "🫀", "daily_goal": 300})
        bio.call("save_profile", {"pseudo": "Bio", "avatar": "🧬", "daily_goal": 60})
        bio.call("join_group", {"code": med.call("create_group", {"name": "G"})["code"]})
        med.sync()
        bio.call("send_message", {"code": "go"})
        med.collect = lambda: self.fail("poll must not read Anki")
        self.assertTrue(med.poll())
        self.assertTrue(any(e["kind"] == "msg" for e in med.snapshot()["feed"]))


if __name__ == "__main__":
    unittest.main()


class V6(unittest.TestCase):
    """Réglages, non-lus, bulles cliquables, minuteur, historique des duels, résultats."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fake = FakeSupabase()

    def player(self, name):
        srv = server_mod.Server("https://x.supabase.co", "k", os.path.join(self.tmp, name, "s.json"), opener=self.fake)
        api = api_mod.MultiAPI(srv, lambda: None, os.path.join(self.tmp, name, "state.json"))
        today = datetime.date.today()
        api.collect = lambda: [{"day": today.isoformat(), "cards": 100, "minutes": 30, "new_cards": 5,
                                "review_count": 50, "retention": 0.9, "overdue": 0}]
        return api

    def pair(self):
        med, bio = self.player("med"), self.player("bio")
        med.call("save_profile", {"pseudo": "Med", "avatar": "🫀", "daily_goal": 100})
        bio.call("save_profile", {"pseudo": "Bio", "avatar": "🧬", "daily_goal": 100})
        bio.call("join_group", {"code": med.call("create_group", {"name": "G"})["code"]})
        med.sync(), bio.sync()
        return med, bio

    def test_settings_default_left_kept_and_validated(self):
        med = self.player("med")
        self.assertEqual(med.settings()["corner"], "haut-gauche")
        changed = []
        med.on_settings = changed.append
        self.assertTrue(med.call("save_settings", {"corner": "bas-gauche", "sound": False})["ok"])
        self.assertFalse(med.call("save_settings", {"corner": "plafond"})["ok"])
        self.assertEqual((changed[-1]["corner"], changed[-1]["sound"]), ("bas-gauche", False))
        again = self.player("med")
        self.assertEqual(again.settings()["corner"], "bas-gauche")
        self.assertEqual(again.snapshot()["settings"]["sound"], False)

    def test_sign_in_keeps_this_computers_choices(self):
        med, _bio = self.pair()
        med.call("save_settings", {"corner": "bas-gauche"})
        med.call("secure_account", {"username": "med_v6", "password": "motdepasse1"})
        laptop = self.player("med")
        laptop.call("sign_in", {"username": "med_v6", "password": "motdepasse1"})
        self.assertEqual(laptop.settings()["corner"], "bas-gauche")

    def test_unread_feed(self):
        med, bio = self.pair()
        self.assertGreater(med.snapshot()["unread"], 0)        # Bio joined, finished a day...
        med.call("feed_seen")
        self.assertEqual(med.snapshot()["unread"], 0)
        bio.call("send_message", {"code": "go"})
        med.call("send_message", {"code": "bravo"})            # mine: not unread
        med.poll()
        self.assertEqual(med.snapshot()["unread"], 1)
        med.call("feed_seen")
        self.assertEqual(med.snapshot()["unread"], 0)

    def test_bubbles_for_bets_défis_and_pomodoros_with_a_click(self):
        med, bio = self.pair()
        got = []
        med.live_check(got.append)                              # first check: start point
        today = datetime.date.today().isoformat()
        end = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
        bio.call("create_bet", {"type": "duel", "opponent": med.server.user_id, "stake": 5, "start": today, "end": end})
        bio.call("create_challenge", {"type": "boss", "target": 100, "start": today, "end": end})
        bio.call("start_pomodoro", {"work": 25, "rest": 5, "rounds": 2})
        med.live_check(got.append)
        msgs = got[-1]["messages"]
        self.assertEqual([m["click"] for m in msgs][:2], ["accueil", "defis"])
        self.assertTrue(msgs[2]["click"].startswith("pomo:"))
        self.assertIn("pari de 5 pts", msgs[0]["text"])
        # the bubble made the game data fresh: joining works right away, then the timer shows
        self.assertTrue(med.call("join_pomodoro", {"ref": int(msgs[2]["click"].split(":")[1])})["ok"])
        med.live_check(got.append)
        self.assertEqual(got[-1]["pomo"]["work"], 25)
        med.call("save_settings", {"pomo_pill": False, "bubbles": False})
        bio.call("send_message", {"code": "go"})
        med.live_check(got.append)
        self.assertEqual((got[-1]["pomo"], got[-1]["messages"]), (None, []))

    def test_open_tab_is_used_once(self):
        med, _bio = self.pair()
        med.open_tab = "defis"
        self.assertEqual(med.snapshot()["open_tab"], "defis")
        self.assertIsNone(med.snapshot()["open_tab"])


class DuelsAndResults(unittest.TestCase):
    def test_weekly_duels_and_results(self):
        start = datetime.date(2026, 9, 28)   # a Monday
        rows = []
        for n in range(14):
            d = (start + datetime.timedelta(days=n)).isoformat()
            med_done = n < 7                   # med wins week 1, bio wins week 2
            rows.append({"user_id": "med", "day": d, "cards": 300 if med_done else 100, "goal": 300, "overdue": 0,
                         "review_count": 100, "retention": 0.9})
            rows.append({"user_id": "bio", "day": d, "cards": 30 if med_done else 60, "goal": 60, "overdue": 0,
                         "review_count": 30, "retention": 0.9})
        ev = Ev()
        g = games.build(MEMBERS, rows, ev.list, "2026-10-12", "med", start.isoformat())
        d = g["duels"]
        self.assertEqual([w["winner"] for w in d["weeks"]], ["bio", "med"])     # newest first
        self.assertEqual(d["wins"], {"med": 1, "bio": 1})
        self.assertEqual([m["type"] for m in g["moments"]][:2], ["duel", "duel"])

    def test_finished_challenge_and_bet_show_as_results(self):
        ev = Ev()
        ev.add("med", "challenge", {"type": "boss", "target": 50, "start": day(0), "end": day(2)})
        bid = ev.add("med", "bet", {"type": "duel", "opponent": "bio", "stake": 10, "start": day(0), "end": day(1)})
        ev.add("bio", "bet_accept", {"ref": bid})
        rows = [full_day(u, n, gl) for n in range(3) for u, gl in (("med", 300), ("bio", 60))]
        rows[1]["overdue"] = 5      # bio's first day isn't zero backlog: med wins the duel bet
        g = build(rows, ev, 5)
        kinds = {m["type"]: m for m in g["moments"]}
        self.assertEqual(kinds["challenge"]["status"], "won")
        self.assertEqual(kinds["bet"]["winner"], "med")
