"""Study numbers read from Anki's own review log - the same for everyone,
whatever other add-on they use. Read-only and Qt-free (tested on a real
throwaway collection).

One row per Anki day (Anki's own day cutoff): cards answered, minutes,
new cards, review answers, retention on those reviews, distinct cards done
(reviews + new cards introduced: what "finishing the day" is measured in),
and for today the overdue backlog.
"""

import datetime

REAL_ANSWER = "r.ease between 1 and 4 and r.type < 4"   # manual reschedules write ease 0 / type >= 4
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


def deck_progress(col):
    """The deck being studied now (with its subdecks): {"pct", "done", "left"}.
    done = distinct cards finished in it today (reviews + new cards started),
    left = what Anki still shows today in it (reviews + new, learning steps left
    out, like everywhere). For the live race during reviews."""
    dids = col.decks.deck_and_child_ids(col.decks.get_current_id())
    marks = ",".join(str(int(x)) for x in dids)
    start_ms = _day_start_ms(col, col.sched.today)
    done = col.db.scalar(
        f"select count(distinct r.cid) from revlog r join cards c on c.id = r.cid where r.id >= ? and {REAL_ANSWER}"
        f" and (c.did in ({marks}) or c.odid in ({marks})) and (r.type = 1 or (r.type = 0 and r.lastIvl = 0))",
        start_ms) or 0
    new, _learn, rev = col.sched.counts()
    left = new + rev
    return {"pct": round(100 * done / (done + left)) if done + left else 100, "done": done, "left": left}


# -- when will I finish the deck I'm doing? (the estimate during reviews) ------------------------
BREAK_MS = 180_000     # more than 3 min between two answers: a break, not the card's time
HISTORY_DAYS = 14      # one's usual habits (passes per card, speed), today left out
PRIOR = {"new": 3.0, "lapse": 3.0, "fail": 0.1, "s_learn": 10.0, "s_rev": 8.0}   # before any history
PRIOR_WEIGHT = 15      # how many cards/answers the usual habits weigh against today's
LIVE_ANSWERS = 60      # "en direct": the speed of the last 60 answers today


def _durations(rows):
    """[(answer id ms, revlog time ms, type)] sorted -> [(type, seconds)]: the real time between two
    answers (thinking + reading the back + the button), or Anki's own timer after a break."""
    out, prev = [], None
    for rid, ms, rtype in rows:
        gap = rid - prev if prev is not None else None
        out.append((rtype, (gap if gap is not None and 0 < gap <= BREAK_MS else min(ms or 0, 60_000)) / 1000))
        prev = rid
    return out


def _trimmed(values):
    """Mean without the 10 % slowest and 10 % fastest: one card left on screen doesn't move it."""
    v = sorted(x for x in values if x > 0)
    if not v:
        return None
    cut = len(v) // 10
    v = v[cut:len(v) - cut] or v
    return sum(v) / len(v)


def _shrink(live, n, usual, weight=PRIOR_WEIGHT):
    return usual if live is None or n == 0 else (live * n + usual * weight) / (n + weight)


def study_habits(col):
    """From the last 14 days (today left out, its cards aren't finished): how many times a new card
    is seen on its first day, how many times a forgotten card comes back, how often a review is
    forgotten, and the usual seconds per answer. Quite heavy: computed once a day by the caller."""
    today = col.sched.today
    start = _day_start_ms(col, today - HISTORY_DAYS)
    end = _day_start_ms(col, today)
    rows = col.db.all(f"select r.id, r.cid, r.ease, r.time, r.type, r.lastIvl from revlog r where id >= ? and id < ?"
                      f" and {REAL_ANSWER} order by r.id", start, end)
    per_day = {}   # (day, cid) -> [types...]
    first_kind = {}
    for rid, cid, ease, _ms, rtype, last_ivl in rows:
        key = (int((rid - start) // 86_400_000), cid)
        per_day.setdefault(key, []).append((rtype, ease))
        if key not in first_kind:
            first_kind[key] = "new" if rtype == 0 and last_ivl == 0 else ("rev" if rtype == 1 else None)
    new_n = new_a = rev_n = fails = lapse_a = 0
    for key, answers in per_day.items():
        kind = first_kind[key]
        if kind == "new":
            new_n += 1
            new_a += len(answers)
        elif kind == "rev":
            rev_n += 1
            if answers[0][1] == 1:
                fails += 1
                lapse_a += len(answers)
    times = _durations([(r[0], r[3], r[4]) for r in rows])
    s_learn = _trimmed([s for t, s in times if t in (0, 3)])
    s_rev = _trimmed([s for t, s in times if t == 1])
    p = PRIOR
    return {
        "new": _shrink(new_a / new_n if new_n else None, new_n, p["new"], 10),
        "lapse": _shrink(lapse_a / fails if fails else None, fails, p["lapse"], 10),
        "fail": _shrink(fails / rev_n if rev_n else None, rev_n, p["fail"], 30),
        "s_learn": s_learn or p["s_learn"],
        "s_rev": s_rev or p["s_rev"],
    }


def deck_eta(col, habits=None):
    """How long the deck being studied still takes (with its subdecks), in seconds, and why.
    Remaining answers, not just cards: a new card comes back ~3 times on its first day (once
    « À revoir », twice « Correct », one's own habit measured), a forgotten review comes back too.
    The speed is today's (the last 60 answers, the real time between two answers, breaks left out),
    leaning on one's usual speed while there are few answers: it doesn't jump around."""
    h = habits or study_habits(col)
    dids = col.decks.deck_and_child_ids(col.decks.get_current_id())
    marks = ",".join(str(int(x)) for x in dids)
    today = col.sched.today
    start_ms = _day_start_ms(col, today)
    new, _learn, rev = col.sched.counts()
    # cards in learning now: what's left for each, given how many times it was already seen today
    learn_answers = 0.0
    learning = col.db.all(
        f"select c.id, c.type, (select count() from revlog r where r.cid = c.id and r.id >= ? and {REAL_ANSWER})"
        f" from cards c where (c.did in ({marks}) or c.odid in ({marks}))"
        f" and (c.queue = 1 or (c.queue = 3 and c.due <= ?))", start_ms, today)
    for _cid, ctype, seen in learning:
        usual = h["lapse"] if ctype == 3 else h["new"]
        learn_answers += max(1.0, usual - (seen or 0))
    rev_answers = rev * (1 + h["fail"] * (h["lapse"] - 1))
    new_answers = new * h["new"]
    # live speed: today's last answers (any deck: it's me, now)
    rows = col.db.all(f"select r.id, r.time, r.type from revlog r where id >= ? and {REAL_ANSWER} order by r.id desc limit ?",
                      start_ms, LIVE_ANSWERS)
    times = _durations(sorted(rows))
    live_l = [s for t, s in times if t in (0, 3)]
    live_r = [s for t, s in times if t == 1]
    s_learn = _shrink(_trimmed(live_l), len(live_l), h["s_learn"])
    s_rev = _shrink(_trimmed(live_r), len(live_r), h["s_rev"])
    # a review that is forgotten comes back as learning steps
    rev_secs = rev * s_rev + rev * h["fail"] * (h["lapse"] - 1) * s_learn
    secs = (new_answers + learn_answers) * s_learn + rev_secs
    answers = new_answers + learn_answers + rev_answers
    return {"secs": round(secs), "new": new, "rev": rev, "learn": len(learning), "answers": round(answers),
            "per_new": round(h["new"], 1), "speed": round(secs / answers, 1) if answers else round(s_rev, 1),
            "deck": int(col.decks.get_current_id())}


def recent_days(col, num_days):
    """[{day, cards, minutes, new_cards, review_count, retention, done, rev_done, overdue}]
    for the last `num_days` Anki days, today included, oldest first."""
    today = col.sched.today
    first = today - num_days + 1
    start_ms = _day_start_ms(col, first)
    end_ms = col.sched.day_cutoff * 1000
    rows = {d: [] for d in range(first, today + 1)}
    for rid, cid, ease, ms, rtype, last_ivl in col.db.all(
            f"select id, cid, ease, time, type, lastIvl from revlog r where id >= ? and id < ? and {REAL_ANSWER}",
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
