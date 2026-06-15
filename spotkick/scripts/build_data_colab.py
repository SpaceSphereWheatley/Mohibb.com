# build_data_colab.py
# Spotkick data builder for Google Colab.
#
# Fetches StatsBomb open data directly from GitHub (raw.githubusercontent.com,
# no zip download needed), extracts every penalty, computes scoreline context
# + a Pressure Index (0-100), and writes a flat penalties.json you can download
# and commit to spotkick/data/penalties.json.
#
# Usage in Colab:
#   1. Paste this whole file into a cell and run it.
#   2. It writes penalties.json in the Colab working directory.
#   3. Download it (left sidebar -> Files -> right-click penalties.json ->
#      Download), then copy it into spotkick/data/penalties.json in the repo.
#
# Laget av Mohibb Malik, 2025

import json
import math
import time
import urllib.request

RAW_BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data'

# Competitions to include. Identified by competition_id.
# Set to None to process ALL available competitions (slow, large output).
COMPETITION_ALLOWLIST = [
    43,  # FIFA World Cup
    55,  # UEFA Euro
    11,  # La Liga
    2,   # Premier League
    9,   # Bundesliga (1. Bundesliga)
    12,  # Serie A
    7,   # Ligue 1
    16,  # Champions League
]

OUT_PATH = 'penalties.json'


# -- FETCH HELPERS --

def fetch_json(path, retries=3):
    url = f'{RAW_BASE}/{path}'
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as res:
                return json.load(res)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1)


# -- PRESSURE INDEX (ported from src/js/pressureIndex.js) --

W = {
    'scoreline':   0.20,
    'minute':      0.12,
    'competition': 0.16,
    'shootout':    0.18,
    'interaction': 0.16,  # scoreline x minute
    'league':      0.18,
}


def pressure_index(minute_, score_situation, stage, is_shootout, shootout_kick, shootout_delta, league_context):
    S = scoreline(score_situation)
    M = minute_component(minute_)
    C = competition(stage)
    P = shootout(is_shootout, shootout_kick, shootout_delta)
    L = league(league_context)

    league_applies = league_context != 'na' and league_context is not None

    terms = [
        (W['scoreline'], S),
        (W['minute'], M),
        (W['competition'], C),
        (W['interaction'], S * M),
    ]
    if is_shootout:
        terms.append((W['shootout'], P))
    if league_applies:
        terms.append((W['league'], L))

    active_weight = sum(w for w, _ in terms)
    raw = sum((w / active_weight) * v for w, v in terms)

    return round(min(100, max(0, raw * 100)))


def scoreline(situation):
    return {
        'winning2+': 0.10,
        'winning1':  0.30,
        'level':     0.70,
        'losing1':   0.90,
        'losing2+':  0.40,
    }.get(situation, 0.50)


def minute_component(t):
    # Sigmoid: flat until ~60', accelerates toward 90'
    return 1 / (1 + math.exp(-0.08 * (t - 75)))


def competition(stage):
    return {
        'group':         0.30,
        'cup_early':     0.35,
        'league_run_in': 0.55,
        'round_of_16':   0.55,
        'quarter_final': 0.70,
        'semi_final':    0.80,
        'cup_final':     0.85,
        'major_final':   1.00,
    }.get(stage, 0.30)


def shootout(is_shootout, kick_number, delta):
    if not is_shootout:
        return 0
    if kick_number > 5:
        return 0.90  # sudden death
    base = kick_number / 5
    pressure = max(0, 1 - abs(delta) * 0.2)
    return min(1, base * pressure)


def league(context):
    return {
        'early':      0.20,
        'title':      0.75,
        'promotion':  0.75,
        'relegation': 0.80,
        'finalday':   1.00,
        'na':         0.00,
    }.get(context, 0.20)


# -- MATCH INDEX --

def build_match_index(competitions):
    index = {}
    for comp in competitions:
        if COMPETITION_ALLOWLIST and comp['competition_id'] not in COMPETITION_ALLOWLIST:
            continue
        matches = fetch_json(f"matches/{comp['competition_id']}/{comp['season_id']}.json")
        if not matches:
            continue
        for m in matches:
            index[m['match_id']] = {
                'competitionName': comp['competition_name'],
                'seasonName': comp['season_name'],
                'date': m.get('match_date'),
                'homeTeam': (m.get('home_team') or {}).get('home_team_name'),
                'awayTeam': (m.get('away_team') or {}).get('away_team_name'),
                'stage': map_stage(comp['competition_name'], m),
                'leagueContext': map_league_context(comp['competition_name'], m),
            }
    return index


def map_stage(comp_name, match):
    stage = ((match.get('competition_stage') or {}).get('name') or '').lower()
    is_league = any(k in comp_name.lower() for k in ('liga', 'premier', 'bundesliga', 'serie', 'ligue'))

    if 'final' in stage and 'semi' not in stage and 'quarter' not in stage:
        if any(k in comp_name.lower() for k in ('world cup', 'euro', 'champions')):
            return 'major_final'
        return 'cup_final'
    if 'semi' in stage:
        return 'semi_final'
    if 'quarter' in stage:
        return 'quarter_final'
    if '16' in stage or 'last 16' in stage:
        return 'round_of_16'
    if 'group' in stage:
        return 'group'
    if is_league:
        return 'group'  # regular league match, refined by leagueContext
    return 'group'


def map_league_context(comp_name, match):
    is_league = any(k in comp_name.lower() for k in ('liga', 'premier', 'bundesliga', 'serie', 'ligue'))
    if not is_league:
        return 'na'
    # TODO: join external standings (football-data.org) to set
    # title/relegation/promotion/finalday based on week + table position.
    return 'early'


# -- PENALTY EXTRACTION --

def extract_penalties(events, match_id, meta, out):
    home_goals, away_goals = 0, 0
    shootout_kicks = {}  # team -> count

    for e in events:
        shot = e.get('shot') or {}
        is_shot = (e.get('type') or {}).get('name') == 'Shot'
        is_penalty_shot = is_shot and (shot.get('type') or {}).get('name') == 'Penalty'
        is_period_5 = e.get('period') == 5
        is_penalty_method = is_penalty_shot or (is_period_5 and is_shot)

        if is_shot and (shot.get('outcome') or {}).get('name') == 'Goal' and not is_period_5:
            if (e.get('team') or {}).get('name') == meta['homeTeam']:
                home_goals += 1
            else:
                away_goals += 1

        if not is_penalty_method:
            continue

        taker_team = (e.get('team') or {}).get('name')
        is_home = taker_team == meta['homeTeam']
        outcome = map_outcome((shot.get('outcome') or {}).get('name'))
        minute_ = e.get('minute') or 0
        is_shootout = is_period_5

        shootout_kick, shootout_delta = 0, 0
        if is_shootout:
            n = shootout_kicks.get(taker_team, 0) + 1
            shootout_kicks[taker_team] = n
            shootout_kick = n
            other_team = meta['awayTeam'] if is_home else meta['homeTeam']
            shootout_delta = shootout_kicks.get(taker_team, 0) - shootout_kicks.get(other_team, 0)

        score_situation = map_score_situation(is_home, home_goals, away_goals)

        pi = pressure_index(
            120 if is_shootout else minute_,
            score_situation,
            meta['stage'],
            is_shootout,
            shootout_kick,
            shootout_delta,
            meta['leagueContext'],
        )

        out.append({
            'matchId': match_id,
            'date': meta['date'],
            'competition': meta['competitionName'],
            'season': meta['seasonName'],
            'taker': (e.get('player') or {}).get('name') or 'Unknown',
            'takerId': (e.get('player') or {}).get('id'),
            'keeper': find_keeper(e),
            'team': taker_team,
            'opponent': meta['awayTeam'] if is_home else meta['homeTeam'],
            'minute': minute_,
            'placement': map_placement(e),
            'outcome': outcome,
            'isShootout': is_shootout,
            'pressureIndex': pi,
        })


def map_outcome(name):
    if not name:
        return 'missed'
    if name == 'Goal':
        return 'goal'
    if name in ('Saved', 'Saved To Post'):
        return 'saved'
    return 'missed'  # Off T, Wayward, Post, Blocked


def map_score_situation(is_home, home_goals, away_goals):
    diff = (home_goals - away_goals) if is_home else (away_goals - home_goals)
    if diff >= 2:
        return 'winning2+'
    if diff == 1:
        return 'winning1'
    if diff == 0:
        return 'level'
    if diff == -1:
        return 'losing1'
    return 'losing2+'


def map_placement(e):
    loc = ((e.get('shot') or {}).get('end_location')) or []
    if len(loc) < 2:
        return 'MC'
    y = loc[1]
    z = loc[2] if len(loc) >= 3 else 0

    if y < 37.5:
        col = 'R'
    elif y > 42.5:
        col = 'L'
    else:
        col = 'C'

    if z > 1.8:
        row = 'T'
    elif z > 0.7:
        row = 'M'
    else:
        row = 'B'

    if row == 'M' and col == 'C':
        return 'MC'
    return row + ('C' if col == 'C' else col)


def find_keeper(e):
    ff = (e.get('shot') or {}).get('freeze_frame')
    if not ff:
        return 'Unknown'
    for p in ff:
        if (p.get('position') or {}).get('name') == 'Goalkeeper' and not p.get('teammate'):
            return (p.get('player') or {}).get('name') or 'Unknown'
    return 'Unknown'


# -- SUMMARY --

def summarise(penalties):
    total = len(penalties)
    if not total:
        return
    goals = sum(1 for p in penalties if p['outcome'] == 'goal')
    saved = sum(1 for p in penalties if p['outcome'] == 'saved')
    missed = sum(1 for p in penalties if p['outcome'] == 'missed')
    avg_pi = sum(p['pressureIndex'] for p in penalties) / total
    print('\nSummary:')
    print(f'  Conversion: {goals / total * 100:.1f}%')
    print(f'  Saved: {saved}  Missed: {missed}')
    print(f'  Avg pressure index: {avg_pi:.1f}')


# -- MAIN --

def main():
    print('Fetching competitions...')
    competitions = fetch_json('competitions.json')

    print('Building match index...')
    match_index = build_match_index(competitions)
    print(f'  {len(match_index)} matches in scope')

    penalties = []
    processed = 0
    for i, (match_id, meta) in enumerate(match_index.items(), start=1):
        events = fetch_json(f'events/{match_id}.json')
        if events is None:
            continue
        extract_penalties(events, match_id, meta, penalties)
        processed += 1
        if processed % 50 == 0:
            print(f'  ...processed {processed}/{len(match_index)} matches')

    penalties.sort(key=lambda p: p['date'] or '', reverse=True)  # newest first

    with open(OUT_PATH, 'w') as f:
        json.dump(penalties, f, separators=(',', ':'))

    print(f'\nDone. {len(penalties)} penalties from {processed} matches.')
    print(f'Written to {OUT_PATH}')
    summarise(penalties)


if __name__ == '__main__':
    main()
