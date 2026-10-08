"""Study numbers read from Anki's own review log - the same for everyone,
whatever other add-on they use. Read-only and Qt-free (tested on a real
throwaway collection).

One row per Anki day (Anki's own day cutoff): cards answered, minutes,
new cards, review answers, retention on those reviews, distinct cards done
(reviews + new cards introduced: what "finishing the day" is measured in),
and for today the overdue backlog.
"""

import datetime

REAL_ANSWER = "ease between 1 and 4 and type < 4"   # manual reschedules write ease 0 / type >= 4
QUEUE_REV = 2


def _day_start_ms(col, day_number):
    """Start of an Anki day in ms (day_cutoff is the end of today)."""
    cutoff = col.sched.day_cutoff
    return (cutoff - 86400 * (col.sched.today - day_number + 1)) * 1000


def day_date(col, day_number):
    start = _day_start_ms(col, day_number) / 1000
    # the calendar date the day mostly falls on (a 4 am cutoff belongs to the day before)
    return datetime.date.fromtimestamp(start + 43200).isoformat()


def overdue_count(col):
    return col.db.scalar(f"select count() from cards where queue = {QUEUE_REV} and due < ?", col.sched.today) or 0


def due_today(col):
    """Review cards due exactly today and not done yet (the backlog, due
    before today, is counted apart by overdue_count)."""
    return col.db.scalar(f"select count() from cards where queue = {QUEUE_REV} and due = ?", col.sched.today) or 0


def due_parts(col):
    """(reviews, new cards) Anki still asks for today, all decks (its own
    daily limits applied). Learning steps are left out, like in `done`."""
    rev = new = 0
    for node in col.sched.deck_due_tree().children:
        rev += node.review_count
        new += node.new_count
    return rev, new


def due_left(col):
    return sum(due_parts(col))


def recent_days(col, num_days):
    """[{day, cards, minutes, new_cards, review_count, retention, done, rev_done, overdue}]
    for the last `num_days` Anki days, today included, oldest first."""
    today = col.sched.today
    first = today - num_days + 1
    start_ms = _day_start_ms(col, first)
    end_ms = col.sched.day_cutoff * 1000
    rows = {d: [] for d in range(first, today + 1)}
    for rid, cid, ease, ms, rtype, last_ivl in col.db.all(
            f"select id, cid, ease, time, type, lastIvl from revlog where id >= ? and id < ? and {REAL_ANSWER}",
            start_ms, end_ms):
        d = first + int((rid - start_ms) // 86_400_000)
        if d in rows:
            rows[d].append((ease, ms, rtype, last_ivl, cid))
    out = []
    for d in range(first, today + 1):
        r = rows[d]
        reviews = [x for x in r if x[2] == 1]
        out.append({
            "day": day_date(col, d),
            "cards": len(r),
            "minutes": min(1440, round(sum(x[1] for x in r) / 60000)),
            "new_cards": sum(1 for x in r if x[2] == 0 and x[3] == 0),
            "review_count": len(reviews),
            "retention": round(sum(1 for x in reviews if x[0] > 1) / len(reviews), 4) if reviews else None,
            # a review card or a new card counts once, however many times it was pressed "À revoir"
            "done": len({x[4] for x in r if x[2] == 1 or (x[2] == 0 and x[3] == 0)}),
            "rev_done": len({x[4] for x in r if x[2] == 1}),
            "overdue": overdue_count(col) if d == today else None,
        })
    return out
