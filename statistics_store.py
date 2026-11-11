"""Optional, consented analytics. No raw IP or capability is stored in events."""
import hashlib
import json
import math
import re
import time
from collections import Counter

KINDS = {'page_view', 'page_reload', 'game_start', 'hurry_up', 'game_complete',
         'game_abandoned', 'game_interrupted', 'score_qualified', 'score_saved',
         'replay_clicked', 'progress', 'visibility', 'visit_end'}
ID = re.compile(r'^[a-zA-Z0-9_-]{20,80}$')
EVENT_COLUMNS = ('event_id', 'visitor_id', 'visit_id', 'game_id', 'kind', 'occurred',
                 'received', 'elapsed', 'active', 'visit_active', 'score', 'best', 'name',
                 'score_id', 'visible', 'device', 'os', 'browser', 'geo_consent',
                 'country', 'region', 'city', 'geo_source', 'geo_accuracy')


def initialize(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS stats_owners(visitor_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stats_events(
        event_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, visit_id TEXT NOT NULL,
        game_id TEXT, kind TEXT NOT NULL, occurred REAL NOT NULL, received REAL NOT NULL,
        elapsed REAL NOT NULL, active REAL NOT NULL, visit_active REAL NOT NULL,
        score INTEGER, best INTEGER, name TEXT, score_id INTEGER, visible INTEGER NOT NULL,
        device TEXT NOT NULL, os TEXT NOT NULL, browser TEXT NOT NULL, geo_consent INTEGER NOT NULL,
        country TEXT NOT NULL, region TEXT NOT NULL, city TEXT NOT NULL,
        geo_source TEXT NOT NULL, geo_accuracy TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS stats_visitor_time ON stats_events(visitor_id, occurred);
      CREATE INDEX IF NOT EXISTS stats_visit ON stats_events(visit_id);
      CREATE INDEX IF NOT EXISTS stats_game ON stats_events(game_id);
      CREATE TABLE IF NOT EXISTS stats_export(
        id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 0,
        exported_version INTEGER NOT NULL DEFAULT -1, exported_at REAL NOT NULL DEFAULT 0,
        last_auto REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '');
      INSERT OR IGNORE INTO stats_export(id) VALUES(1);
    ''')
    # Score changes must also invalidate the complete export, even without analytics consent.
    for operation in ('INSERT', 'UPDATE', 'DELETE'):
        db.execute(f'''CREATE TRIGGER IF NOT EXISTS scores_export_{operation.lower()}
            AFTER {operation} ON scores BEGIN UPDATE stats_export SET version=version+1 WHERE id=1; END''')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identity(body):
    visitor, secret = body.get('visitor_id'), body.get('secret')
    if not isinstance(visitor, str) or not ID.fullmatch(visitor) or not isinstance(secret, str) or not ID.fullmatch(secret):
        raise ValueError('Invalid visitor capability.')
    return visitor, digest(secret)


def authorize(db, visitor, secret_hash, create=False):
    row = db.execute('SELECT secret_hash FROM stats_owners WHERE visitor_id=?', (visitor,)).fetchone()
    if row and row[0] != secret_hash:
        raise PermissionError('Visitor capability does not match.')
    if not row:
        if not create:
            return False
        db.execute('INSERT INTO stats_owners VALUES(?,?)', (visitor, secret_hash))
    return True


def validate(body, now):
    visitor, secret = identity(body)
    e = body.get('event')
    if body.get('consent') is not True or not isinstance(e, dict):
        raise ValueError('Explicit statistics consent is required.')
    if e.get('kind') not in KINDS:
        raise ValueError('Unknown event.')
    for key in ('event_id', 'visit_id', 'game_id'):
        value = e.get(key)
        if key == 'game_id' and value is None:
            continue
        if not isinstance(value, str) or not ID.fullmatch(value):
            raise ValueError('Invalid identifier.')
    def number(key, low, high, default=0):
        value = e.get(key, default)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('Invalid ' + key)
        return value
    occurred = number('occurred', now - 7*86400 - 60, now + 300)
    elapsed = number('elapsed', 0, 60)
    active = number('active', 0, elapsed)
    visit_active = number('visit_active', 0, 7*86400)
    values = dict(event_id=e['event_id'], visitor_id=visitor, visit_id=e['visit_id'],
                  game_id=e.get('game_id'), kind=e['kind'], occurred=occurred, received=now,
                  elapsed=elapsed, active=active, visit_active=visit_active)
    for key in ('score', 'best', 'score_id'):
        value = e.get(key)
        if value is not None and (type(value) is not int or not 0 <= value <= (2147483647 if key == 'score_id' else 165)):
            raise ValueError('Invalid ' + key)
        values[key] = value
    name = e.get('name')
    if name is not None and (not isinstance(name, str) or len(name) > 20 or any(ord(c) < 32 for c in name)):
        raise ValueError('Invalid name.')
    values['name'] = name
    for key in ('visible', 'geo_consent'):
        if type(e.get(key, False)) is not bool:
            raise ValueError('Invalid consent or visibility.')
        values[key] = int(e.get(key, False))
    for key, choices in [('device', {'smartphone','tablet','computer','unknown'}),
                         ('os', {'iOS','Android','Windows','macOS','Linux','unknown'}),
                         ('browser', {'Safari','Chrome','Firefox','Edge','unknown'})]:
        values[key] = e.get(key, 'unknown')
        if values[key] not in choices:
            raise ValueError('Invalid device description.')
    values.update(country='unknown', region='unknown', city='unknown', geo_source='unknown', geo_accuracy='unknown')
    return visitor, secret, values


def record(db, body, geo=None):
    now = time.time()
    visitor, secret, event = validate(body, now)
    authorize(db, visitor, secret, create=True)
    existing = db.execute('SELECT visitor_id FROM stats_events WHERE event_id=?', (event['event_id'],)).fetchone()
    if existing:
        if existing[0] != visitor:
            raise PermissionError('Event already belongs to another visitor.')
        return False
    if db.execute('SELECT COUNT(*) FROM stats_events WHERE visitor_id=? AND received>?', (visitor, now-3600)).fetchone()[0] >= 600:
        raise OverflowError('Statistics limit reached.')
    for key in ('visit_id', 'game_id'):
        if event[key]:
            owner = db.execute(f'SELECT visitor_id, visit_id FROM stats_events WHERE {key}=? LIMIT 1', (event[key],)).fetchone()
            if owner and (owner[0] != visitor or (key == 'game_id' and owner[1] != event['visit_id'])):
                raise PermissionError('Session identifier already used.')
    if event['geo_consent'] and geo:
        event.update(geo)
    db.execute(f"INSERT INTO stats_events({','.join(EVENT_COLUMNS)}) VALUES({','.join('?' for _ in EVENT_COLUMNS)})",
               [event[k] for k in EVENT_COLUMNS])
    db.execute('UPDATE stats_export SET version=version+1 WHERE id=1')
    return True


def purge(db, visitor=None):
    if visitor:
        count = db.execute('DELETE FROM stats_events WHERE visitor_id=?', (visitor,)).rowcount
        db.execute('DELETE FROM stats_owners WHERE visitor_id=?', (visitor,))
    else:
        count = db.execute('DELETE FROM stats_events WHERE occurred<?', (time.time()-90*86400,)).rowcount
        db.execute('DELETE FROM stats_owners WHERE visitor_id NOT IN (SELECT visitor_id FROM stats_events)')
    if count:
        db.execute('UPDATE stats_export SET version=version+1 WHERE id=1')
    return count


def snapshot(db, filters=None):
    """All raw fields and derived views share one SQLite read transaction."""
    events = [dict(r) for r in db.execute('SELECT * FROM stats_events ORDER BY occurred, event_id')]
    filters = filters or {}
    if filters.get('name'):
        game_ids = {e['game_id'] for e in events if filters['name'].casefold() in (e['name'] or '').casefold()}
        visits = {e['visit_id'] for e in events if e['game_id'] in game_ids}
        events = [e for e in events if e['visit_id'] in visits]
    events = [e for e in events if (not filters.get('visitor') or e['visitor_id'] == filters['visitor'])
              and e['occurred'] >= filters.get('from', 0) and e['occurred'] <= filters.get('to', float('inf'))]
    visits, games, visitors = {}, {}, {}
    for e in events:
        vid, sid, gid, at = e['visitor_id'], e['visit_id'], e['game_id'], e['occurred']
        v = visits.setdefault(sid, dict(visit_id=sid, visitor_id=vid, started=at, last_seen=at,
            duration=0, active=0, device=e['device'], os=e['os'], browser=e['browser'],
            geo_consent=e['geo_consent'], country=e['country'], region=e['region'], city=e['city'],
            geo_source=e['geo_source'], geo_accuracy=e['geo_accuracy']))
        if e['kind'] not in ('score_saved','score_qualified'):
            v.update(last_seen=at, duration=at-v['started'], active=max(v['active'], e['visit_active']))
        visitor = visitors.setdefault(vid, dict(visitor_id=vid, first_visit=at, last_visit=at,
                                               visits=0, games=0, names=[], scores=[]))
        visitor['last_visit'] = at
        if not gid:
            continue
        g = games.setdefault(gid, dict(game_id=gid, visit_id=sid, visitor_id=vid, started=None, ended=None,
            last_seen=at, elapsed=0, active=0, progress=0, status='unknown', score=None, best=None, name=None, score_id=None))
        g.update(last_seen=at, elapsed=max(g['elapsed'],e['elapsed']), active=max(g['active'],e['active']))
        g['progress'] = g['elapsed']/60
        if e['kind'] == 'game_start':
            g['started'] = at
        if e['kind'] == 'game_complete':
            g.update(status='complete', ended=at)
        elif e['kind'] in ('game_interrupted','game_abandoned') and g['status'] != 'complete':
            g['status'] = 'interrupted' if e['kind'] == 'game_interrupted' else 'abandoned'
        for key in ('score','best','name','score_id'):
            if e[key] is not None:
                g[key] = e[key]
    for v in visits.values():
        visitors[v['visitor_id']]['visits'] += 1
    for g in games.values():
        v = visitors[g['visitor_id']]
        v['games'] += int(g['started'] is not None)
        if g['name'] and g['name'] not in v['names']: v['names'].append(g['name'])
        if g['score'] is not None: v['scores'].append(g['score'])
    for v in visitors.values():
        v['names'] = json.dumps(v['names'], ensure_ascii=False)
        v['scores'] = json.dumps(v['scores'])
    completed = sum(g['status']=='complete' for g in games.values())
    starts = sum(g['started'] is not None for g in games.values())
    summary = dict(visits=len(visits), browsers=len(visitors), returning_browsers=sum(v['visits']>1 for v in visitors.values()),
        games_started=starts, games_completed=completed,
        games_interrupted=sum(g['status']=='interrupted' for g in games.values()),
        games_abandoned=sum(g['status']=='abandoned' for g in games.values()),
        games_unknown=sum(g['status']=='unknown' for g in games.values()),
        completion_rate=completed/starts if starts else 0,
        total_game_seconds=sum(g['elapsed'] for g in games.values()),
        total_active_game_seconds=sum(g['active'] for g in games.values()),
        average_visit_seconds=sum(v['duration'] for v in visits.values())/len(visits) if visits else 0,
        average_game_seconds=sum(g['elapsed'] for g in games.values())/len(games) if games else 0,
        named_games=sum(bool(g['name']) for g in games.values()))
    funnel = Counter(e['kind'] for e in events)
    scores = [dict(r) for r in db.execute('SELECT id,name,score,created FROM scores ORDER BY score DESC,id')]
    geography = Counter((v['country'],v['region'],v['city']) for v in visits.values())
    return dict(Summary=[dict(metric=k,value=v) for k,v in summary.items()],
        Funnel=[dict(event=k,count=funnel[k]) for k in ['page_view','game_start','hurry_up','game_complete','score_qualified','score_saved']],
        Visitors=list(visitors.values()), Visits=list(visits.values()), Games=list(games.values()), Events=events,
        Scores=[dict(s,display_name=s['name'] or '—') for s in scores],
        Locations=[{k:v[k] for k in ['visit_id','visitor_id','started','geo_consent','country','region','city','geo_source','geo_accuracy']} for v in visits.values()],
        Geography=[dict(country=k[0],region=k[1],city=k[2],visits=n) for k,n in geography.most_common()],
        Devices=[{k:v[k] for k in ['visit_id','visitor_id','started','device','os','browser']} for v in visits.values()])
