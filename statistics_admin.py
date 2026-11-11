"""Private admin and optional analytics routes, registered on the existing Flask app."""
import functools
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
from datetime import datetime

from flask import abort, jsonify, redirect, render_template, request, send_file, session
from werkzeug.security import check_password_hash, generate_password_hash

import statistics_store as stats


def install(app, connect):
    private = Path(app.config['DATABASE']).parent
    credentials = private / 'admin-credentials.json'
    if not credentials.exists():
        password = secrets.token_urlsafe(24)
        data = dict(password_hash=generate_password_hash(password), session_key=secrets.token_hex(32))
        try:
            with credentials.open('x') as f:
                os.chmod(credentials, 0o600)
                json.dump(data, f)
            note = private / 'ADMIN-ACCESS.txt'
            with note.open('w') as f:
                os.chmod(note, 0o600)
                f.write('KimiGame2 private statistics\nUsername: admin\nPassword: '+password+'\nURL: https://lammens-cloud.tail538586.ts.net/admin\nKeep this file private.\n')
        except FileExistsError:
            pass
    keys = json.loads(credentials.read_text())
    app.secret_key = keys['session_key']
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_SECURE=not app.testing, PERMANENT_SESSION_LIFETIME=3600)
    with connect() as db:
        stats.initialize(db)
    lock = threading.Lock()
    limits = {}

    def limited(category, maximum):
        # Memory-only keyed hash, never a persistent IP identity.
        key = (category, stats.digest(keys['session_key']+(request.remote_addr or '')))
        now = time.monotonic()
        with lock:
            for k in list(limits):
                if limits[k][0] < now-3600: del limits[k]
            since, count = limits.get(key, (now, 0))
            limits[key] = (since, count+1)
            return count >= maximum

    def authenticated(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            if not session.get('admin'):
                return redirect('/admin/login')
            if request.method == 'POST' and not secrets.compare_digest(request.form.get('csrf',''), session.get('csrf','!')):
                abort(403)
            return fn(*args, **kwargs)
        return wrapper

    @app.after_request
    def private_headers(response):
        if request.path.startswith('/admin'):
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.route('/admin/login', methods=['GET','POST'])
    def login():
        session.setdefault('csrf', secrets.token_urlsafe(32))
        error = ''
        if request.method == 'POST':
            if not secrets.compare_digest(request.form.get('csrf',''), session['csrf']): abort(403)
            if limited('login',20): abort(429)
            if request.form.get('username') == 'admin' and check_password_hash(keys['password_hash'], request.form.get('password','')):
                session.clear()
                session.update(admin=True,csrf=secrets.token_urlsafe(32))
                session.permanent = True
                return redirect('/admin')
            error = 'Invalid username or password.'
        return render_template('admin.html', login=True,error=error)

    def launch_export(manual=False):
        subprocess.Popen([sys.executable, str(Path(__file__).parent/'scripts/export_statistics.py')]+(['--manual'] if manual else []),
                         env={**os.environ,'KIMI_DATABASE':app.config['DATABASE']},
                         stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                         start_new_session=True)

    @app.route('/admin', methods=['GET'])
    @authenticated
    def dashboard():
        filters = {k:request.args[k].strip()[:100] for k in ('visitor','name') if request.args.get(k)}
        try:
            for k in ('from','to'):
                if request.args.get(k):
                    filters[k] = datetime.fromisoformat(request.args[k]+'T00:00:00+00:00').timestamp() + (86399.999 if k=='to' else 0)
        except ValueError:
            abort(400)
        with connect() as db:
            db.execute('BEGIN')
            data = stats.snapshot(db, filters)
            export = dict(db.execute('SELECT * FROM stats_export WHERE id=1').fetchone())
        return render_template('admin.html',data=data,export=export,filters=request.args)

    @app.post('/admin/export')
    @authenticated
    def refresh_export():
        if limited('export',30): abort(429)
        launch_export(True)
        return redirect('/admin?export_requested=1')

    @app.get('/admin/download')
    @authenticated
    def download_export():
        file = private/'statistics.xlsx'
        if not file.exists(): abort(404)
        return send_file(file,as_attachment=True,download_name='KimiGame2-statistics.xlsx',max_age=0)

    @app.post('/admin/delete')
    @authenticated
    def delete_visitor():
        visitor = request.form.get('visitor','')
        if not stats.ID.fullmatch(visitor): abort(400)
        with connect() as db:
            stats.purge(db, visitor)
        # Invalidate the older private export immediately; regenerate without the deleted data.
        (private/'statistics.xlsx').unlink(missing_ok=True)
        launch_export(True)
        return redirect('/admin')

    @app.post('/admin/logout')
    @authenticated
    def logout():
        session.clear()
        return redirect('/admin/login')

    def geolocation():
        unknown = None
        path = os.environ.get('KIMI_GEOIP_DATABASE')
        if not path: return unknown
        try:
            import geoip2.database
            # Never trust arbitrary X-Forwarded-For. Enable only for a trusted local proxy.
            address = request.remote_addr
            if os.environ.get('KIMI_TRUST_PROXY')=='1' and address in ('127.0.0.1','::1'):
                address = request.headers.get('X-Forwarded-For','').split(',')[0].strip() or address
            if not ipaddress.ip_address(address).is_global: return unknown
            with geoip2.database.Reader(path) as reader:
                place = reader.city(address)
                return dict(country=place.country.name or 'unknown',region=place.subdivisions.most_specific.name or 'unknown',
                            city=place.city.name or 'unknown',geo_source='local GeoIP database',geo_accuracy='approximate city/region; not GPS')
        except Exception:
            return unknown

    @app.post('/api/statistics')
    def collect():
        if limited('statistics',6000): return jsonify(error='Rate limited.'),429
        body = request.get_json()
        if not isinstance(body,dict): return jsonify(error='Invalid event.'),400
        try:
            stats.validate(body,time.time())
            geo = geolocation() if body['event'].get('geo_consent') is True else None
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                inserted = stats.record(db,body,geo)
            return jsonify(confirmed=True,inserted=inserted)
        except (ValueError,PermissionError,OverflowError) as error:
            return jsonify(error=str(error)), (403 if isinstance(error,PermissionError) else 429 if isinstance(error,OverflowError) else 400)

    @app.post('/api/statistics/delete')
    def delete_own():
        body = request.get_json()
        if not isinstance(body,dict): return jsonify(error='Invalid request.'),400
        try:
            visitor, secret = stats.identity(body)
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if stats.authorize(db, visitor, secret): stats.purge(db,visitor)
            (private/'statistics.xlsx').unlink(missing_ok=True)
            launch_export(True)
            return jsonify(deleted=True)
        except (ValueError,PermissionError) as error:
            return jsonify(error=str(error)),403

    app.jinja_env.filters['utc'] = lambda value: datetime.fromtimestamp(value, __import__('datetime').timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC') if value else 'Not yet generated'
