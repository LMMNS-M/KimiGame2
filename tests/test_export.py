"""Full workbook integration checks when the server's bundled Node runtime is installed."""
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from server import create_app
from scripts.export_statistics import export

RUNTIME=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'


@unittest.skipUnless(RUNTIME.exists(),'Excel integration requires the Ubuntu artifact-tool runtime')
class ExportTests(unittest.TestCase):
    def test_complete_atomic_dirty_export(self):
        with tempfile.TemporaryDirectory() as directory:
            database=str(Path(directory)/'scores.sqlite3')
            client=create_app({'TESTING':True,'DATABASE':database,'MIN_RUN_SECONDS':0}).test_client()
            visitor,secret,visit,game=[str(uuid4()) for _ in range(4)]
            for kind in ('page_view','game_start','game_complete','score_saved'):
                event=dict(event_id=str(uuid4()),visit_id=visit,game_id=game,kind=kind,occurred=time.time(),
                           elapsed=60 if kind in ('game_complete','score_saved') else 0,active=0,visit_active=30,
                           visible=True,geo_consent=False,device='smartphone',os='iOS',browser='Safari',
                           score=123,best=140,name='=Étoile' if kind=='score_saved' else None)
                self.assertEqual(client.post('/api/statistics',json=dict(visitor_id=visitor,secret=secret,consent=True,event=event)).status_code,200)
            token=client.post('/api/runs',json={}).json['token']
            client.post('/api/scores',json=dict(token=token,score=123))
            self.assertEqual(export(database),'exported') # Validates EVERY raw field and derived cell.
            output=Path(directory)/'statistics.xlsx';first=output.read_bytes()
            self.assertEqual(export(database),'unchanged');self.assertEqual(first,output.read_bytes())
            client.post('/api/scores',json=dict(token=token,score=123,name='New name'))
            self.assertEqual(export(database),'deferred')
            self.assertEqual(export(database,manual=True),'exported')
            second=output.read_bytes();self.assertNotEqual(first,second)
            with sqlite3.connect(database) as db:db.execute('UPDATE stats_export SET version=version+1')
            with patch('scripts.export_statistics.subprocess.run',side_effect=RuntimeError('worker interrupted')):
                with self.assertRaises(RuntimeError):export(database,manual=True)
            self.assertEqual(output.read_bytes(),second)
            self.assertEqual(export(database,manual=True),'exported')
            with sqlite3.connect(database) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM stats_events').fetchone()[0],4)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM scores').fetchone()[0],1)
