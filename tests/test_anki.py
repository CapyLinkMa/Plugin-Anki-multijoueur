"""metrics.py on a real throwaway Anki collection (skipped without Anki's
Python packages: PYTHONPATH=/Applications/Anki.app/Contents/Resources/app_packages)."""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers import load  # noqa: E402

try:
    from anki.collection import Collection
    from anki.scheduler.v3 import CardAnswer
except ImportError:  # pragma: no cover
    Collection = None

metrics = load()["metrics"]


@unittest.skipIf(Collection is None, "Anki n'est pas importable ici")
class Metrics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.col = Collection(os.path.join(self.tmp, "c.anki2"))
        model = self.col.models.by_name("Basic")
        for i in range(10):
            n = self.col.new_note(model)
            n["Front"], n["Back"] = f"q{i}", "a"
            self.col.add_note(n, 1)

    def tearDown(self):
        self.col.close()
        shutil.rmtree(self.tmp)

    def test_today_counts_real_answers(self):
        for rating in (CardAnswer.AGAIN, CardAnswer.GOOD, CardAnswer.EASY):
            q = self.col.sched.get_queued_cards()
            card = self.col.get_card(q.cards[0].card.id)
            card.start_timer()
            card.timer_started -= 30
            self.col.sched.answer_card(self.col.sched.build_answer(card=card, states=q.cards[0].states, rating=rating))
        days = metrics.recent_days(self.col, 7)
        self.assertEqual(len(days), 7)
        today = days[-1]
        self.assertEqual((today["cards"], today["new_cards"]), (3, 3))
        self.assertEqual(today["minutes"], 2)   # 3 x 30 s
        self.assertEqual(today["overdue"], 0)
        self.assertTrue(all(d["cards"] == 0 for d in days[:-1]))
        self.assertEqual(today["day"], metrics.day_date(self.col, self.col.sched.today))
        self.assertEqual(today["done"], 3)            # 3 distinct new cards
        self.assertEqual(today["rev_done"], 0)
        self.assertEqual(metrics.due_left(self.col), 7)   # 10 new cards, 3 started: 7 left
        self.assertEqual(metrics.due_parts(self.col), (0, 7))
        self.assertEqual(metrics.due_today(self.col), 0)

    def test_due_today_leaves_the_backlog_out(self):
        cids = list(self.col.find_cards(""))
        today = self.col.sched.today
        # 2 review cards due today, 3 overdue (due 5 days ago)
        for cid, due in zip(cids, [today, today, today - 5, today - 5, today - 5]):
            self.col.db.execute("update cards set type = 2, queue = 2, ivl = 10, due = ? where id = ?", due, cid)
        self.assertEqual(metrics.due_today(self.col), 2)
        self.assertEqual(metrics.overdue_count(self.col), 3)
        self.assertEqual(metrics.due_parts(self.col)[0], 5)


if __name__ == "__main__":
    unittest.main()
