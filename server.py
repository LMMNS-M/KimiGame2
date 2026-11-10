"""Serve the game and its shared, local SQLite leaderboard."""
import hashlib
import os
from pathlib import Path
import secrets
import sqlite3
import time
import unicodedata
from contextlib import contextmanager

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DATABASE=os.environ.get('KIMI_DATABASE', str(ROOT / 'data' / 'scores.sqlite3')),
        MAX_CONTENT_LENGTH=2048,
        MIN_RUN_SECONDS=60,
        RUN_TTL=3600,
        RUNS_PER_HOUR=60,
        ALLOWED_ORIGINS={value.strip() for value in os.environ.get('KIMI_ALLOWED_ORIGINS', '').split(',') if value.strip()},
    )
    if config:
        app.config.update(config)
    db_path = Path(app.config['DATABASE'])
    db_path.parent.mkdir(parents=True, exist_ok=True)
    address_salt = secrets.token_bytes(32)

    @contextmanager
    def connect():
        db = sqlite3.connect(db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS runs (
                token_hash TEXT PRIMARY KEY, started REAL NOT NULL,
                address_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS runs_started ON runs(started);
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 165),
                created REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scores_ranking ON scores(score DESC, id ASC);
        ''')

    def fail(message, status):
        return jsonify(error=message), status

    @app.before_request
    def protect_api():
        if request.path.startswith('/api/'):
            origin = request.headers.get('Origin')
            allowed = not origin or origin.rstrip('/') == request.host_url.rstrip('/') or origin in app.config['ALLOWED_ORIGINS']
            if not allowed:
                return fail('Origin not allowed.', 403)
            if request.method == 'OPTIONS':
                return '', 204
        if request.path.startswith('/api/') and request.method == 'POST':
            if request.content_length and request.content_length > app.config['MAX_CONTENT_LENGTH']:
                return fail('Request too large.', 413)
            # JSON-only writes, restricted to our explicit frontend origins.
            if not request.is_json:
                return fail('Request body must be JSON.', 415)

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
            origin = request.headers.get('Origin')
            if origin in app.config['ALLOWED_ORIGINS']:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
                response.vary.add('Origin')
        return response

    @app.errorhandler(400)
    @app.errorhandler(413)
    def invalid_request(error):
        return fail('Invalid or oversized request.', error.code)

    @app.errorhandler(sqlite3.Error)
    def database_error(error):
        app.logger.error('Leaderboard database error: %s', error)
        return fail('Leaderboard temporarily unavailable. Please try again.', 503)

    def leaders(db):
        rows = db.execute('SELECT id, name, score FROM scores ORDER BY score DESC, id ASC LIMIT 10')
        return [dict(row, rank=rank) for rank, row in enumerate(rows, 1)]

    def saved_result(db, row):
        rank = db.execute(
            'SELECT COUNT(*) + 1 FROM scores WHERE score > ? OR (score = ? AND id < ?)',
            (row['score'], row['score'], row['id']),
        ).fetchone()[0]
        return jsonify(entry=dict(row, rank=rank), leaderboard=leaders(db))

    @app.get('/api/leaderboard')
    def leaderboard():
        with connect() as db:
            return jsonify(leaderboard=leaders(db))

    @app.post('/api/runs')
    def begin_run():
        if not isinstance(request.get_json(), dict):
            return fail('Invalid request.', 400)
        now = time.time()
        address = hashlib.sha256(address_salt + (request.remote_addr or '').encode()).hexdigest()
        token = secrets.token_urlsafe(32)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM runs WHERE started < ?', (now - app.config['RUN_TTL'],))
            count = db.execute('SELECT COUNT(*) FROM runs WHERE address_hash = ? AND started > ?',
                               (address, now - 3600)).fetchone()[0]
            if count >= app.config['RUNS_PER_HOUR']:
                return fail('Too many games started. Please try again later.', 429)
            db.execute('INSERT INTO runs VALUES (?, ?, ?)',
                       (hashlib.sha256(token.encode()).hexdigest(), now, address))
        return jsonify(token=token), 201

    @app.post('/api/scores')
    def submit_score():
        body = request.get_json()
        if not isinstance(body, dict):
            return fail('Invalid result.', 400)
        token, name, score = body.get('token'), body.get('name'), body.get('score')
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            return fail('Unknown game. Start a new game.', 400)
        if not isinstance(name, str):
            return fail('Choose a nickname between 1 and 20 characters.', 400)
        name = unicodedata.normalize('NFC', name).strip()
        if not 1 <= len(name) <= 20 or any(unicodedata.category(c).startswith('C') for c in name):
            return fail('Choose a nickname between 1 and 20 characters, without control characters.', 400)
        if type(score) is not int or not 0 <= score <= 165:
            return fail('Invalid score.', 400)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT id, name, score FROM scores WHERE token_hash = ?', (token_hash,)).fetchone()
            if existing:
                if existing['name'] == name and existing['score'] == score:
                    return saved_result(db, existing)
                return fail('This game has already been saved.', 409)
            run = db.execute('SELECT started FROM runs WHERE token_hash = ?', (token_hash,)).fetchone()
            if not run or time.time() - run['started'] > app.config['RUN_TTL']:
                return fail('Game expired. Play again to save a score.', 410)
            if time.time() - run['started'] < app.config['MIN_RUN_SECONDS']:
                return fail('The game has not finished yet.', 409)
            cursor = db.execute('INSERT INTO scores (token_hash, name, score, created) VALUES (?, ?, ?, ?)',
                                (token_hash, name, score, time.time()))
            row = db.execute('SELECT id, name, score FROM scores WHERE id = ?', (cursor.lastrowid,)).fetchone()
            return saved_result(db, row)

    @app.get('/api/health')
    def health():
        with connect() as db:
            db.execute('SELECT COUNT(*) FROM scores').fetchone()
        return jsonify(status='ok')

    @app.get('/')
    def index():
        return send_from_directory(ROOT, 'index.html')

    @app.get('/<path:path>')
    def public_file(path):
        # Never expose the database, Git metadata, server code or environment.
        if path.split('/')[0] not in {'assets', 'css', 'js', 'tests'}:
            return fail('File not found.', 404)
        if path.startswith('tests/') and path != 'tests/browser-check.js':
            return fail('File not found.', 404)
        folder, _, filename = path.partition('/')
        return send_from_directory(ROOT / folder, filename, conditional=True)

    return app


if __name__ == '__main__':
    create_app().run(host='127.0.0.1', port=int(os.environ.get('PORT', '8080')))
