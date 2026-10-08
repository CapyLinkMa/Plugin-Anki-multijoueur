"""Fair points (automatic goal = what Anki asks) and updates from GitHub.
Run: python -m unittest discover tests"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers import load  # noqa: E402

M = load()
group, api_mod, updater = M["group"], M["api"], M["updater"]


def row(cards, goal, **kw):
    r = {"day": "2026-10-01", "cards": cards, "goal": goal, "review_count": 0, "retention": None, "overdue": None}
    r.update(kw)
    return r


class Points(unittest.TestCase):
    member = {"id": "a", "daily_goal": 100}

    def test_a_small_and_a_big_program_earn_the_same_for_a_full_day(self):
        med = group.day_points(row(700, 700, overdue=0, review_count=500, retention=0.9), self.member,
                               row(700, 700))
        bio = group.day_points(row(120, 120, overdue=0, review_count=80, retention=0.9), self.member,
                               row(120, 120))
        self.assertEqual(med["total"], bio["total"])
        self.assertEqual(med["total"], 10 + 3 + 3 + 2)

    def test_extra_is_small_and_capped(self):
        self.assertEqual(group.day_points(row(150, 100), self.member)["extra"], 3)
        self.assertEqual(group.day_points(row(5000, 100), self.member)["extra"], 3)
        self.assertEqual(group.day_points(row(100, 100), self.member)["extra"], 0)

    def test_half_a_day_and_no_bonus(self):
        p = group.day_points(row(50, 100, overdue=0), self.member, row(100, 100))
        self.assertEqual(p, {"day": 5, "extra": 0, "regular": 0, "no_backlog": 0, "retention": 0, "total": 5})
        self.assertEqual(group.day_points(None, self.member)["total"], 0)

    def test_backlog_bonus_for_zero_or_a_clear_drop(self):
        full = lambda od: row(100, 100, overdue=od)
        self.assertEqual(group.day_points(full(0), self.member)["no_backlog"], 3)
        self.assertEqual(group.day_points(full(180), self.member, full(200))["no_backlog"], 3)   # -10 %
        self.assertEqual(group.day_points(full(196), self.member, full(196))["no_backlog"], 0)   # forgotten deck
        self.assertEqual(group.day_points(full(198), self.member, full(200))["no_backlog"], 0)   # -1 % only
        self.assertEqual(group.day_points(row(50, 100, overdue=0), self.member)["no_backlog"], 0)   # day not finished

    def test_retention_compares_with_ones_own_average(self):
        history = {f"2026-09-{i:02d}": {"day": f"2026-09-{i:02d}", "review_count": 100, "retention": 0.76}
                   for i in range(10, 30)}
        day = row(100, 100, review_count=100, retention=0.78, day="2026-09-30")
        self.assertEqual(group.day_points(day, self.member, None, history)["retention"], 2)   # above own 76 %
        self.assertEqual(group.day_points(day, self.member)["retention"], 0)                   # no history: 85 %
        low = row(100, 100, review_count=100, retention=0.70, day="2026-09-30")
        self.assertEqual(group.day_points(low, self.member, None, history)["retention"], 0)
        good = {k: dict(v, retention=0.95) for k, v in history.items()}
        self.assertEqual(group.day_points(row(100, 100, review_count=100, retention=0.86, day="2026-09-30"),
                                          self.member, None, good)["retention"], 2)            # 85 % is enough

    def test_retention_needs_enough_reviews(self):
        self.assertEqual(group.day_points(row(10, 100, review_count=10, retention=1.0), self.member)["retention"], 0)
        self.assertEqual(group.day_points(row(30, 100, review_count=25, retention=0.85), self.member)["retention"], 2)

    def test_ranking_and_duel_use_points(self):
        members = [{"id": "a", "pseudo": "Med", "daily_goal": 300}, {"id": "b", "pseudo": "Bio", "daily_goal": 60}]
        rows = []
        for day in ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]:
            # Med: 140 % of a heavy day but always a backlog; Bio: exactly the day, nothing left behind
            rows.append({"user_id": "a", "day": day, "cards": 840, "goal": 600, "overdue": 50,
                         "review_count": 600, "retention": 0.8})
            rows.append({"user_id": "b", "day": day, "cards": 100, "goal": 100, "overdue": 0,
                         "review_count": 80, "retention": 0.9})
        v = group.build(members, rows, "2026-10-01", "a")
        pts = {p["id"]: p["week"]["points"] for p in v["players"]}
        self.assertEqual(v["ranking"], ["b", "a"])     # more cards, but Bio did their day better
        self.assertEqual(v["duel"], ["b", "a"])
        self.assertEqual(pts["b"], 4 * 10 + 3 * 3 + 4 * 3 + 4 * 2)


class AutomaticGoal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.api = api_mod.MultiAPI(None, lambda: None, os.path.join(self.tmp, "state.json"))

    def test_goal_gives_the_share_of_distinct_cards_done(self):
        today = {"day": "2026-10-01", "cards": 390, "done": 300, "rev_done": 300, "overdue": 0}
        self.api.note_target(today, 200, 0, 200)          # 300 reviews done + 200 still due = 500 asked
        out = self.api.server_row(today, 100)
        self.assertNotIn("done", out)
        self.assertNotIn("rev_done", out)
        self.assertAlmostEqual(out["cards"] / out["goal"], 300 / 500, places=2)   # "À revoir" presses don't count twice

    def test_finishing_the_day_validates_it(self):
        today = {"day": "2026-10-01", "cards": 650, "done": 500, "rev_done": 400, "overdue": 0}
        self.api.note_target(today, 0, 0, 0, pace=100)
        out = self.api.server_row(today, 100)
        self.assertTrue(group.validated(out, {"daily_goal": 100}))

    def test_an_old_backlog_is_not_part_of_the_day(self):
        # a forgotten deck: 200 overdue cards that Anki still lists every day
        today = {"day": "2026-10-01", "cards": 300, "done": 250, "rev_done": 150, "overdue": 200}
        self.api.note_target(today, 200, 0, 0, pace=100)   # today's 150 reviews all done, 100 new cards done
        out = self.api.server_row(today, 100)
        self.assertTrue(group.validated(out, {"daily_goal": 100}))
        self.assertLess(out["cards"] / out["goal"], 1.01)

    def test_overdue_cards_caught_up_go_beyond_100(self):
        start = {"day": "2026-10-01", "cards": 0, "done": 0, "rev_done": 0, "overdue": 200}
        self.api.note_target(start, 300, 50, 100, pace=50)     # morning: 100 due today + 200 overdue, 50 new
        end = {"day": "2026-10-01", "cards": 260, "done": 250, "rev_done": 200, "overdue": 100}
        self.api.note_target(end, 100, 0, 0, pace=50)          # evening: today's 100 + 100 overdue, 50 new
        self.assertEqual(self.api.store["targets"]["2026-10-01"]["goal"], 150)
        out = self.api.server_row(end, 100)
        self.assertAlmostEqual(group.pct(out, {}), 1.5, places=2)
        self.assertEqual(group.day_points(out, {})["extra"], 3)

    def test_new_cards_count_at_ones_own_pace(self):
        # Anki offers 900 new cards (20 a deck, many decks): only the usual 60 are asked
        today = {"day": "2026-10-01", "cards": 160, "done": 160, "rev_done": 100, "overdue": 0}
        self.api.note_target(today, 0, 840, 0, pace=60)
        self.assertEqual(self.api.store["targets"]["2026-10-01"]["goal"], 160)
        days = [{"day": f"2026-09-{i:02d}", "cards": 50 if i % 2 else 0, "new_cards": 30 if i % 2 else 0} for i in range(10, 30)]
        days.append({"day": "2026-09-30", "cards": 999, "new_cards": 999})   # today is left out
        self.assertEqual(self.api.new_card_pace(days), 30)
        self.assertIsNone(self.api.new_card_pace([{"day": "2026-09-30", "cards": 5, "new_cards": 5}]))

    def test_past_day_keeps_its_target_and_backlog(self):
        self.api.note_target({"day": "2026-09-30", "cards": 100, "done": 100, "rev_done": 100, "overdue": 0}, 300, 0, 300)
        # later, on the phone, the rest was done: the review log knows it, the target stays
        past = {"day": "2026-09-30", "cards": 520, "done": 400, "overdue": None}
        out = self.api.server_row(past, 100)
        self.assertEqual(out["overdue"], 0)
        self.assertTrue(group.validated(out, {"daily_goal": 100}))
        reloaded = api_mod.MultiAPI(None, lambda: None, os.path.join(self.tmp, "state.json"))
        self.assertEqual(reloaded.server_row(past, 100)["goal"], out["goal"])

    def test_targets_from_before_v9_leave_the_backlog_out(self):
        self.api.store["targets"]["2026-10-01"] = {"total": 877, "overdue": 196}
        out = self.api.server_row({"day": "2026-10-01", "cards": 681, "done": 681}, 100)
        self.assertEqual(out["goal"], 681)

    def test_days_never_seen_use_the_usual_goal_or_the_profile_goal(self):
        self.assertEqual(self.api.server_row({"day": "2026-01-01", "cards": 50, "done": 40}, 80)["goal"], 80)
        for day, goal in (("2026-09-28", 200), ("2026-09-29", 300), ("2026-09-30", 250)):
            self.api.store["targets"][day] = {"total": 999, "overdue": 0, "goal": goal}
        out = self.api.server_row({"day": "2026-10-01", "cards": 300, "done": 250}, 80)   # phone only
        self.assertAlmostEqual(out["cards"] / out["goal"], 1.0, places=2)

    def test_goal_stays_in_the_servers_limits(self):
        self.api.note_target({"day": "2026-10-01", "cards": 0, "done": 0, "rev_done": 0}, 3, 0, 3)
        self.assertEqual(self.api.server_row({"day": "2026-10-01", "cards": 0, "done": 0}, 100)["goal"], 10)


def repo_zip(files, top="Plugin-Anki-multijoueur-main"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(f"{top}/{name}", content)
    return buf.getvalue()


class Updates(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        for name, content in {"__init__.py": "old", "version.json": '{"version": 2}', "meta.json": '{"config": 1}',
                              "user_files/session.json": "secret"}.items():
            os.makedirs(os.path.dirname(os.path.join(self.dir, name)), exist_ok=True)
            with open(os.path.join(self.dir, name), "w") as f:
                f.write(content)
        self.remote = {"multijoueur/__init__.py": "new", "multijoueur/web/page.js": "js",
                       "multijoueur/version.json": json.dumps({"version": 3, "nouveautes": "Des trucs"}),
                       "multijoueur/user_files/session.json": "not mine", "multijoueur/meta.json": "no",
                       "README.md": "not the add-on"}

    def get(self, url):
        if url.startswith("https://raw.githubusercontent.com/me/repo/main/multijoueur/version.json"):
            return self.remote["multijoueur/version.json"].encode()
        if url == "https://codeload.github.com/me/repo/zip/refs/heads/main":
            return repo_zip(self.remote)
        raise updater.UpdateError("404")

    def read(self, name):
        with open(os.path.join(self.dir, name)) as f:
            return f.read()

    def test_newer_version_is_offered_then_installed(self):
        info = updater.available(self.dir, "me/repo", get=self.get)
        self.assertEqual(info["version"], 3)
        self.assertEqual(updater.install(self.dir, "me/repo", get=self.get)["version"], 3)
        self.assertEqual(self.read("__init__.py"), "new")
        self.assertEqual(self.read("web/page.js"), "js")
        self.assertEqual(self.read("user_files/session.json"), "secret")   # account kept
        self.assertEqual(self.read("meta.json"), '{"config": 1}')         # settings kept
        self.assertFalse(os.path.exists(os.path.join(self.dir, "README.md")))
        self.assertIsNone(updater.available(self.dir, "me/repo", get=self.get))

    def test_same_version_or_no_repo_offers_nothing(self):
        self.remote["multijoueur/version.json"] = '{"version": 2}'
        self.assertIsNone(updater.available(self.dir, "me/repo", get=self.get))
        self.assertIsNone(updater.available(self.dir, "", get=self.get))

    def test_a_bad_download_changes_nothing(self):
        bad = lambda url: b"<html>oops</html>"
        with self.assertRaises(updater.UpdateError):
            updater.install(self.dir, "me/repo", get=bad)
        del self.remote["multijoueur/version.json"]
        with self.assertRaises(updater.UpdateError):
            updater.install(self.dir, "me/repo", get=lambda url: repo_zip(self.remote))
        self.assertEqual(self.read("__init__.py"), "old")

    def test_the_repo_file_is_a_valid_update(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "multijoueur", "version.json"), encoding="utf-8") as f:
            info = json.load(f)
        self.assertIsInstance(info["version"], int)


if __name__ == "__main__":
    unittest.main()
