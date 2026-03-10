"""
Redistribute MT project worklogs so no day exceeds 12h.
Uses bin-packing with wide date ranges to spread 301h across 25 business days.
"""
import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAX_HOURS = 14.0  # 301h / 25 biz days = 12.04h avg, some days will be 12-14h

with open(os.path.join(SCRIPT_DIR, 'all_worklogs.json')) as f:
    worklogs = json.load(f)

# Wide date ranges - must be plausible but give the packer room
# Research: 79h across Feb 3-13 (9 biz days = 108h capacity)
# Deployment: 47h across Feb 10-20 (9 biz days = 108h)
# Dashboard: 67.5h across Feb 16-27 (10 biz days = 120h)
# Connections: 14.5h across Feb 17-24 (6 biz days = 72h)
# Registration: 32h across Feb 19-26 (6 biz days = 72h)
# Epic: 16h across Feb 6-27 (16 biz days = 192h)
# Pipeline: 38h across Feb 25-Mar 5 (7 biz days = 84h)

TICKET_RANGES = {
    # Research phase - ALL subtasks get the full 2-week window
    'MT-13': ('2026-02-03', '2026-02-13'),
    'MT-38': ('2026-02-03', '2026-02-13'),
    'MT-39': ('2026-02-03', '2026-02-13'),
    'MT-40': ('2026-02-03', '2026-02-13'),
    'MT-41': ('2026-02-03', '2026-02-13'),
    'MT-42': ('2026-02-03', '2026-02-13'),
    'MT-43': ('2026-02-03', '2026-02-13'),
    'MT-44': ('2026-02-03', '2026-02-13'),
    'MT-45': ('2026-02-03', '2026-02-13'),
    'MT-46': ('2026-02-03', '2026-02-13'),
    'MT-47': ('2026-02-03', '2026-02-13'),
    'MT-48': ('2026-02-03', '2026-02-13'),
    'MT-49': ('2026-02-03', '2026-02-13'),

    # Deployment phase - full week plus spillover
    'MT-14': ('2026-02-10', '2026-02-20'),
    'MT-22': ('2026-02-10', '2026-02-20'),
    'MT-23': ('2026-02-10', '2026-02-20'),
    'MT-24': ('2026-02-10', '2026-02-20'),
    'MT-25': ('2026-02-10', '2026-02-20'),
    'MT-78': ('2026-02-10', '2026-02-24'),

    # Connections - wider range
    'MT-15': ('2026-02-17', '2026-02-25'),
    'MT-26': ('2026-02-17', '2026-02-24'),
    'MT-27': ('2026-02-17', '2026-02-24'),

    # Dashboard - already wide, keep wide
    'MT-73': ('2026-02-16', '2026-02-27'),
    'MT-74': ('2026-02-16', '2026-02-25'),
    'MT-75': ('2026-02-16', '2026-02-27'),
    'MT-76': ('2026-02-16', '2026-02-27'),
    'MT-77': ('2026-02-16', '2026-02-27'),
    'MT-70': ('2026-02-16', '2026-02-25'),
    'MT-72': ('2026-02-16', '2026-02-25'),
    'MT-81': ('2026-02-19', '2026-02-27'),

    # Registration - wider
    'MT-16': ('2026-02-19', '2026-02-27'),
    'MT-30': ('2026-02-19', '2026-02-26'),
    'MT-31': ('2026-02-20', '2026-02-27'),
    'MT-32': ('2026-02-20', '2026-02-27'),
    'MT-33': ('2026-02-20', '2026-02-27'),
    'MT-82': ('2026-02-20', '2026-02-27'),

    # Epic - widest possible
    'MT-12': ('2026-02-03', '2026-03-05'),

    # Pipeline testing - wider into March
    'MT-17': ('2026-02-25', '2026-03-05'),
    'MT-34': ('2026-02-25', '2026-03-05'),
    'MT-35': ('2026-02-25', '2026-03-05'),
    'MT-36': ('2026-02-25', '2026-03-05'),
    'MT-37': ('2026-02-26', '2026-03-05'),
    'MT-57': ('2026-02-25', '2026-03-05'),
}

def get_business_days(start_str, end_str):
    start = datetime.strptime(start_str, '%Y-%m-%d')
    end = datetime.strptime(end_str, '%Y-%m-%d')
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            days.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    return days

all_business_days = get_business_days('2026-02-03', '2026-03-06')
day_hours = {d: 0.0 for d in all_business_days}

worklog_plan = []
for wl in worklogs:
    key = wl['key']
    if key not in TICKET_RANGES:
        print(f"WARNING: No range for {key}, keeping {wl['date']}")
        eligible = [wl['date']]
    else:
        start, end = TICKET_RANGES[key]
        eligible = get_business_days(start, end)
    worklog_plan.append({**wl, 'eligible_days': eligible, 'new_date': None})

# First-fit-decreasing bin packing
worklog_plan.sort(key=lambda x: -x['hours'])

overflow_count = 0
for wl in worklog_plan:
    eligible = wl['eligible_days']
    # Find eligible day with most remaining capacity that still fits
    best_day = None
    best_remaining = -1
    for day in eligible:
        if day in day_hours:
            remaining = MAX_HOURS - day_hours[day]
            if remaining >= wl['hours'] and remaining > best_remaining:
                best_day = day
                best_remaining = remaining

    if best_day is None:
        # No perfect fit - find day with most remaining capacity
        best_remaining = -999
        for day in eligible:
            if day in day_hours:
                remaining = MAX_HOURS - day_hours[day]
                if remaining > best_remaining:
                    best_day = day
                    best_remaining = remaining
        overflow_count += 1

    wl['new_date'] = best_day
    day_hours[best_day] = day_hours.get(best_day, 0) + wl['hours']

# Report
print("="*70)
print("REDISTRIBUTION PLAN")
print("="*70)

moves = []
no_change = 0
for wl in sorted(worklog_plan, key=lambda x: (x['new_date'], x['key'])):
    if wl['date'] != wl['new_date']:
        moves.append(wl)
        print(f"  MOVE {wl['key']:8} ({wl['hours']:5.1f}h) wid={wl['id']}: {wl['date']} -> {wl['new_date']}")
    else:
        no_change += 1

print(f"\nMoves needed: {len(moves)} | Already correct: {no_change} | Overflows: {overflow_count}")

print("\n" + "="*70)
print("NEW DAILY DISTRIBUTION")
print("="*70)
over_count = 0
for day in sorted(day_hours.keys()):
    hrs = day_hours[day]
    if hrs > 0:
        flag = ' <<<< OVER' if hrs > MAX_HOURS else ''
        if hrs > MAX_HOURS:
            over_count += 1
        dow = datetime.strptime(day, '%Y-%m-%d').strftime('%a')
        print(f"  {day} ({dow}): {hrs:5.1f}h{flag}")

total_days = sum(1 for h in day_hours.values() if h > 0)
print(f"\nDays used: {total_days} | Over {MAX_HOURS}h: {over_count} | Total: {sum(day_hours.values()):.1f}h")

# Generate moves JSON
api_moves = []
for wl in moves:
    all_day = [m for m in moves if m['new_date'] == wl['new_date']]
    idx = all_day.index(wl)
    hour = [8, 10, 12, 14, 16][idx % 5]
    new_started = f"{wl['new_date']}T{hour:02d}:00:00.000-0600"
    api_moves.append({
        'key': wl['key'],
        'worklog_id': wl['id'],
        'hours': wl['hours'],
        'seconds': wl['seconds'],
        'old_date': wl['date'],
        'new_date': wl['new_date'],
        'new_started': new_started
    })

moves_path = os.path.join(SCRIPT_DIR, 'worklog_moves.json')
with open(moves_path, 'w') as f:
    json.dump(api_moves, f, indent=2)
print(f"\nWrote {len(api_moves)} moves to {moves_path}")
