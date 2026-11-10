import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server import create_app


class LeaderboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temp.name) / 'scores.sqlite3')
        self.app = create_app({'TESTING': True, 'DATABASE': self.database, 'MIN_RUN_SECONDS': 0})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def token(self):
        return self.client.post('/api/runs', json={}).json['token']

    def submit(self, score=12, name='Kimi', token=None):
        return self.client.post('/api/scores', json={'token': token or self.token(), 'score': score, 'name': name})

    def test_persistent_top_ten_and_stable_ties(self):
        for score in range(12):
            self.assertEqual(self.submit(score).status_code, 200)
        self.submit(11, 'Étoile')
        app = create_app({'TESTING': True, 'DATABASE': self.database})
        entries = app.test_client().get('/api/leaderboard').json['leaderboard']
        self.assertEqual(len(entries), 10)
        self.assertEqual([e['score'] for e in entries[:3]], [11, 11, 10])
        self.assertEqual([e['name'] for e in entries[:2]], ['Kimi', 'Étoile'])
        self.assertEqual([e['rank'] for e in entries], list(range(1, 11)))

    def test_retry_is_idempotent_and_cannot_change_score(self):
        token = self.token()
        first = self.submit(token=token).json
        self.assertEqual(self.submit(token=token).json, first)
        self.assertEqual(self.submit(50, token=token).status_code, 409)
        self.assertEqual(len(self.client.get('/api/leaderboard').json['leaderboard']), 1)

    def test_concurrent_submission_only_inserts_once(self):
        token = self.token()
        def post(_):
            with self.app.test_client() as client:
                return client.post('/api/scores', json={'token': token, 'score': 10, 'name': 'Star'}).status_code
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(post, range(8))), [200] * 8)
        self.assertEqual(len(self.client.get('/api/leaderboard').json['leaderboard']), 1)

    def test_rejects_invalid_values(self):
        token = self.token()
        for score in [-1, 166, 3.5, True, '12', None]:
            self.assertEqual(self.submit(score, token=token).status_code, 400)
        for name in ['', ' ', 'x' * 21, 'a\nb', '\u202ehello', 42]:
            self.assertEqual(self.submit(name=name, token=token).status_code, 400)
        self.assertEqual(self.submit(name='  Étoile ⭐  ', token=token).json['entry']['name'], 'Étoile ⭐')

    def test_early_unknown_expired_and_rate_limit(self):
        self.app.config['MIN_RUN_SECONDS'] = 60
        token = self.token()
        self.assertEqual(self.submit(token=token).status_code, 409)
        self.assertEqual(self.submit(token='x' * 32).status_code, 410)
        with sqlite3.connect(self.database) as db:
            db.execute('UPDATE runs SET started = ?', (time.time() - 4000,))
        self.assertEqual(self.submit(token=token).status_code, 410)
        self.app.config['RUNS_PER_HOUR'] = 1
        self.token()
        self.assertEqual(self.client.post('/api/runs', json={}).status_code, 429)

    def test_private_files_and_cross_origin_are_blocked(self):
        for path in ['/data/scores.sqlite3', '/server.py', '/.env', '/.git/config',
                     '/assets/../data/scores.sqlite3', '/assets/%2e%2e/server.py', '/tests/test_server.py']:
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(self.client.post('/api/runs', json={}, headers={'Origin': 'https://elsewhere.test'}).status_code, 403)
        self.assertEqual(self.client.post('/api/runs', data='{}').status_code, 415)
        self.assertEqual(self.client.post('/api/scores', json=['bad']).status_code, 400)
        self.assertEqual(self.client.post('/api/runs', data='x' * 3000, content_type='application/json').status_code, 413)

    def test_video_range_and_health(self):
        response = self.client.get('/assets/video/stars-game-background.mp4', headers={'Range': 'bytes=0-15'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(len(response.data), 16)
        response.close()
        self.assertEqual(self.client.get('/api/health').json, {'status': 'ok'})

    def test_github_pages_cors_preflight_and_submit(self):
        origin = 'https://lmmns-m.github.io'
        self.app.config['ALLOWED_ORIGINS'] = {origin}
        headers = {'Origin': origin, 'Sec-Fetch-Site': 'cross-site'}
        preflight = self.client.options('/api/scores', headers={**headers, 'Access-Control-Request-Method': 'POST'})
        self.assertEqual(preflight.status_code, 204)
        self.assertEqual(preflight.headers['Access-Control-Allow-Origin'], origin)
        token = self.client.post('/api/runs', json={}, headers=headers).json['token']
        saved = self.client.post('/api/scores', json={'token': token, 'name': 'iPhone', 'score': 20}, headers=headers)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.headers['Access-Control-Allow-Origin'], origin)
        denied = self.client.options('/api/scores', headers={'Origin': 'https://unrelated.github.io'})
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn('Access-Control-Allow-Origin', denied.headers)


if __name__ == '__main__':
    unittest.main()
