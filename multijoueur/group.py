"""Everything the group screen shows, computed from the members' daily rows.
Pure and Qt-free (unit-tested).

Fairness rule (CLAUDE.md): the players don't study the same program, so
they don't have the same number of cards. Rankings and the duel compare
mostly **the share of one's own daily goal** (capped, so one huge day can't
buy the week), regularity and retention; raw card counts stay visible but
only as information.

Points (decided with Xyroob, 2026-10-01, made fairer in v9): the goal is
*today's* work in Anki (see api.note_target: reviews due today + new cards at
one's own pace; the old backlog is left out), and points reward doing *your*
day well, never the raw volume, so a lighter program can keep up with a
heavier one:
  - up to 10 for the share of the day done, +3 at most beyond 100 %
    (backlog cards caught up, more new cards than usual)
  - +3 regularity: goal reached today and yesterday
  - +3 backlog: goal reached and no overdue card left, or at least 5 % fewer
    than the day before (a forgotten deck no longer costs 3 points forever)
  - +2 retention ≥ 85 %, or ≥ one's own 4-week average when it is lower
    (harder material, e.g. médecine, keeps a fair chance) - 20 reviews min.
"""

import datetime

PCT_CAP = 1.5              # a day counts at most 150 % of its goal
WEEK_GOAL_DAYS = 5         # group weekly goal: everyone validates 5 days
LIVE_MINUTES = 10          # "en train d'étudier" if seen studying in the last 10 min
HEATMAP_WEEKS = 26
CHART_DAYS = 30
STREAK_STEPS = (7, 14, 30, 60, 100, 200, 365)
PTS_DAY = 10
PTS_EXTRA = 3              # beyond 100 %: +1 per ~17 %, up to the 150 % cap
PTS_REGULAR = 3
PTS_NO_BACKLOG = 3
PTS_RETENTION = 2
RETENTION_MIN = 0.85
RETENTION_REVIEWS = 20
RETENTION_WEEKS = 4        # one's own retention baseline: the 4 weeks before the day
RETENTION_BASE_REVIEWS = 100
BACKLOG_DROP = 0.05        # the backlog bonus also counts a drop of at least 5 %
RECENT_DAYS = 14           # the player sheet (Stats): the last 14 days in detail


def d(iso):
    return datetime.date.fromisoformat(iso)


def iso(date):
    return date.isoformat()


def monday(date):
    return date - datetime.timedelta(days=date.weekday())


def goal_of(row, member):
    return max(1, int((row or {}).get("goal") or member.get("daily_goal") or 100))


def pct(row, member):
    if not row:
        return 0.0
    return min(PCT_CAP, (row.get("cards") or 0) / goal_of(row, member))


def validated(row, member):
    return bool(row) and (row.get("cards") or 0) >= goal_of(row, member)


def backlog_ok(row, prev_row):
    """No overdue card left, or clearly fewer than the day before."""
    now = (row or {}).get("overdue")
    if now is None:
        return False
    if now == 0:
        return True
    before = (prev_row or {}).get("overdue")
    return bool(before) and before - now >= max(1, BACKLOG_DROP * before)


def retention_bar(rows, day_iso):
    """85 %, or one's own average of the 4 weeks before when it is lower:
    retention depends on the material and on Anki's settings, not only on
    effort, so each player is first compared with themselves."""
    if not rows or not day_iso:
        return RETENTION_MIN
    start = iso(d(day_iso) - datetime.timedelta(weeks=RETENTION_WEEKS))
    reviews = kept = 0
    for day, r in rows.items():
        if start <= day < day_iso and r.get("retention") is not None:
            reviews += r.get("review_count") or 0
            kept += (r.get("review_count") or 0) * r["retention"]
    if reviews < RETENTION_BASE_REVIEWS:
        return RETENTION_MIN
    return min(RETENTION_MIN, round(kept / reviews, 4))


def day_points(row, member, prev_row=None, rows=None):
    """{"total", "day", "extra", "regular", "no_backlog", "retention"} for one day.
    `rows` (all the player's days) gives their own retention baseline."""
    out = {"day": 0, "extra": 0, "regular": 0, "no_backlog": 0, "retention": 0}
    if row and (row.get("cards") or 0) > 0:
        p = pct(row, member)
        out["day"] = round(PTS_DAY * min(1.0, p))
        out["extra"] = round(PTS_EXTRA * max(0.0, p - 1) / (PCT_CAP - 1))
        done = validated(row, member)
        if done and validated(prev_row, member):
            out["regular"] = PTS_REGULAR
        if done and backlog_ok(row, prev_row):
            out["no_backlog"] = PTS_NO_BACKLOG
        if ((row.get("review_count") or 0) >= RETENTION_REVIEWS
                and (row.get("retention") or 0) >= retention_bar(rows, row.get("day"))):
            out["retention"] = PTS_RETENTION
    out["total"] = sum(out.values())
    return out


def _prev(rows, day):
    return rows.get(iso(day - datetime.timedelta(days=1)))


def by_user(day_rows):
    out = {}
    for r in day_rows:
        out.setdefault(r["user_id"], {})[r["day"]] = r
    return out


def streak(rows, member, today):
    """Validated days in a row up to today (today counts once done; an
    unfinished today doesn't break it)."""
    n = 0
    day = today
    if not validated(rows.get(iso(day)), member):
        day -= datetime.timedelta(days=1)
    while validated(rows.get(iso(day)), member):
        n += 1
        day -= datetime.timedelta(days=1)
    return n


def longest_streak(rows, member):
    best = run = 0
    prev = None
    for day in sorted(rows):
        if validated(rows[day], member):
            run = run + 1 if prev is not None and d(day) - prev == datetime.timedelta(days=1) else 1
            prev = d(day)
            best = max(best, run)
        else:
            run, prev = 0, None
    return best


def week_stats(rows, member, today):
    start = monday(today)
    days = [start + datetime.timedelta(days=i) for i in range((today - start).days + 1)]
    week = [rows.get(iso(x)) for x in days]
    pts = [day_points(rows.get(iso(x)), member, _prev(rows, x), rows) for x in days]
    reviews = sum((r or {}).get("review_count") or 0 for r in week)
    kept = sum(((r or {}).get("retention") or 0) * ((r or {}).get("review_count") or 0) for r in week)
    return {
        "points": sum(p["total"] for p in pts),
        "points_detail": {k: sum(p[k] for p in pts) for k in ("day", "extra", "regular", "no_backlog", "retention")},
        "pct": round(100 * sum(pct(r, member) for r in week) / len(days)),
        "cards": sum((r or {}).get("cards") or 0 for r in week),
        "minutes": sum((r or {}).get("minutes") or 0 for r in week),
        "new_cards": sum((r or {}).get("new_cards") or 0 for r in week),
        "validated": sum(1 for r in week if validated(r, member)),
        "retention": round(100 * kept / reviews, 1) if reviews else None,
    }


def records(rows, member):
    best_day = max(rows.values(), key=lambda r: r.get("cards") or 0, default=None)
    weeks = {}
    for day, r in rows.items():
        weeks[iso(monday(d(day)))] = weeks.get(iso(monday(d(day))), 0) + (r.get("cards") or 0)
    best_week = max(weeks.items(), key=lambda kv: kv[1], default=None)
    return {
        "best_day": {"day": best_day["day"], "cards": best_day.get("cards") or 0} if best_day and best_day.get("cards") else None,
        "best_week": {"monday": best_week[0], "cards": best_week[1]} if best_week and best_week[1] else None,
        "longest_streak": longest_streak(rows, member),
    }


def recent(rows, member, today, n=RECENT_DAYS):
    """The player sheet: each of the last `n` days in detail, newest first."""
    out = []
    for i in range(n):
        day = today - datetime.timedelta(days=i)
        r = rows.get(iso(day)) or {}
        pts = day_points(r or None, member, _prev(rows, day), rows)
        out.append({
            "day": iso(day), "cards": r.get("cards") or 0, "minutes": r.get("minutes") or 0,
            "new_cards": r.get("new_cards") or 0, "reviews": r.get("review_count") or 0,
            "retention": round(100 * r["retention"], 1) if r.get("retention") is not None else None,
            "overdue": r.get("overdue"), "pct": round(100 * pct(r or None, member)),
            "done": validated(r or None, member), "points": pts["total"], "detail": pts,
        })
    return out


def averages(rows, member, today, skip):
    """Per-day averages over 7 days, `skip` days back (0: the last 7 days
    with today, 7: the 7 days before, for the trend arrows)."""
    days = [today - datetime.timedelta(days=skip + i) for i in range(7)]
    week = [rows.get(iso(x)) or {} for x in days]
    studied = [r for r in week if (r.get("cards") or 0) > 0]
    cards = sum(r.get("cards") or 0 for r in week)
    minutes = sum(r.get("minutes") or 0 for r in week)
    reviews = sum(r.get("review_count") or 0 for r in week)
    kept = sum((r.get("retention") or 0) * (r.get("review_count") or 0) for r in week)
    return {
        "studied": len(studied),
        "cards": round(cards / 7), "minutes": round(minutes / 7), "new_cards": round(sum(r.get("new_cards") or 0 for r in week) / 7),
        "reviews": round(reviews / 7),
        "retention": round(100 * kept / reviews, 1) if reviews else None,
        "sec_per_card": round(60 * minutes / cards, 1) if cards else None,
        "pct": round(100 * sum(pct(r or None, member) for r in week) / 7),
        "points": round(sum(day_points(rows.get(iso(x)), member, _prev(rows, x), rows)["total"] for x in days) / 7, 1),
        "finished": sum(1 for r in week if validated(r or None, member)),
    }


def is_live(member, now, minutes=LIVE_MINUTES):
    at = member.get("status_at")
    if not at or member.get("status") != "study":
        return False
    try:
        seen = datetime.datetime.fromisoformat(at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return (now - seen).total_seconds() <= minutes * 60


def everyone_validated(day, members, rows_by_user):
    return bool(members) and all(validated(rows_by_user.get(m["id"], {}).get(iso(day)), m) for m in members)


def group_streak(members, rows_by_user, today):
    n = 0
    day = today
    if not everyone_validated(day, members, rows_by_user):
        day -= datetime.timedelta(days=1)
    while everyone_validated(day, members, rows_by_user):
        n += 1
        day -= datetime.timedelta(days=1)
    return n


def build(members, day_rows, today_iso, me, now=None):
    """The whole group screen as plain JSON."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    today = d(today_iso)
    rows_by_user = by_user(day_rows)
    players = []
    for m in members:
        rows = rows_by_user.get(m["id"], {})
        today_row = rows.get(today_iso)
        detail = day_points(today_row, m, _prev(rows, today), rows)
        players.append({
            "id": m["id"], "pseudo": m["pseudo"], "avatar": m.get("avatar") or "🙂", "me": m["id"] == me,
            "goal": int(m.get("daily_goal") or 100), "program": m.get("program"),
            "live": is_live(m, now), "today_cards": (today_row or {}).get("cards") or 0,
            "today_pct": round(100 * pct(today_row, m)), "today_done": validated(today_row, m),
            "today_points": detail["total"], "today_detail": detail,
            "yesterday_done": validated(rows.get(iso(today - datetime.timedelta(days=1))), m),
            "streak": streak(rows, m, today), "week": week_stats(rows, m, today), "records": records(rows, m),
            "last_seen": m.get("status_at"), "recent": recent(rows, m, today),
            "avg7": averages(rows, m, today, 0), "avg_prev7": averages(rows, m, today, 7),
        })
    ranked = sorted(players, key=lambda p: (-p["week"]["points"], -p["week"]["pct"], p["pseudo"].lower()))
    regular = sorted(players, key=lambda p: (-p["streak"], -p["week"]["validated"], p["pseudo"].lower()))
    week_start = monday(today)
    heat = []
    first = monday(today) - datetime.timedelta(weeks=HEATMAP_WEEKS - 1)
    day = first
    while day <= week_start + datetime.timedelta(days=6):
        done = sum(1 for m in members if validated(rows_by_user.get(m["id"], {}).get(iso(day)), m))
        heat.append({"day": iso(day), "done": done, "total": len(members), "future": day > today})
        day += datetime.timedelta(days=1)
    chart_days = [today - datetime.timedelta(days=i) for i in range(CHART_DAYS - 1, -1, -1)]
    chart = [{"id": m["id"], "pseudo": m["pseudo"], "avatar": m.get("avatar") or "🙂",
              "points": [round(100 * pct(rows_by_user.get(m["id"], {}).get(iso(x)), m)) for x in chart_days]}
             for m in members]
    group_records = {
        "best_day": max(((p["pseudo"], p["records"]["best_day"]) for p in players if p["records"]["best_day"]),
                        key=lambda t: t[1]["cards"], default=None),
        "longest_streak": max(((p["pseudo"], p["records"]["longest_streak"]) for p in players),
                              key=lambda t: t[1], default=None),
    }
    return {
        "today": today_iso, "week_start": iso(week_start),
        "players": players, "ranking": [p["id"] for p in ranked], "regularity": [p["id"] for p in regular],
        "duel": [p["id"] for p in ranked[:2]] if len(ranked) >= 2 else None,
        "week_goal": {"days": WEEK_GOAL_DAYS, "done": all(p["week"]["validated"] >= WEEK_GOAL_DAYS for p in players)
                      if players else False},
        "group_streak": group_streak(members, rows_by_user, today),
        "heatmap": heat, "chart": {"days": [iso(x) for x in chart_days], "series": chart},
        "group_records": group_records,
    }


def milestones(rows, member, today_iso, sent):
    """Events this player should post to the feed now: goal reached today,
    a new best day, a streak step. `sent` = keys already posted (kept on
    disk), so each fires once."""
    today = d(today_iso)
    out = []
    row = rows.get(today_iso)
    if validated(row, member) and f"goal:{today_iso}" not in sent:
        out.append((f"goal:{today_iso}", "goal", {"cards": row["cards"], "goal": goal_of(row, member)}))
    earlier = [r.get("cards") or 0 for day, r in rows.items() if day < today_iso]
    if row and earlier and (row.get("cards") or 0) > max(earlier) >= 50 and f"record:{today_iso}" not in sent:
        out.append((f"record:{today_iso}", "record", {"cards": row["cards"]}))
    n = streak(rows, member, today)
    if n in STREAK_STEPS and validated(row, member) and f"streak:{n}:{today_iso}" not in sent:
        out.append((f"streak:{n}:{today_iso}", "streak", {"days": n}))
    return out
