import copy
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from server import create_app
import statistics_store as stats


class StatisticsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.database=str(Path(self.temp.name)/'scores.sqlite3')
        self.app=create_app({'TESTING':True,'DATABASE':self.database,'MIN_RUN_SECONDS':0})
        self.client=self.app.test_client()
        self.visitor,self.secret,self.visit,self.game=[str(uuid4()) for _ in range(4)]

    def tearDown(self): self.temp.cleanup()

    def body(self,kind='page_view',**extra):
        return dict(visitor_id=self.visitor,secret=self.secret,consent=True,event=dict(
            event_id=str(uuid4()),visit_id=self.visit,game_id=self.game if kind!='page_view' else None,
            kind=kind,occurred=time.time(),elapsed=0,active=0,visit_active=0,visible=True,
            geo_consent=False,device='smartphone',os='iOS',browser='Safari',**extra))

    def snapshot(self):
        with sqlite3.connect(self.database) as db:
            db.row_factory=sqlite3.Row
            return stats.snapshot(db)

    def test_consent_validation_ownership_dedup_and_unknown_geo(self):
        body=self.body();no=copy.deepcopy(body);no['consent']=False
        self.assertEqual(self.client.post('/api/statistics',json=no).status_code,400)
        self.assertEqual(self.client.post('/api/statistics',json=body).status_code,200)
        self.assertFalse(self.client.post('/api/statistics',json=body).json['inserted'])
        stranger=copy.deepcopy(body);stranger['secret']=str(uuid4())
        self.assertEqual(self.client.post('/api/statistics',json=stranger).status_code,403)
        for event in ([],None,{'kind':'fingerprint'},dict(body['event'],elapsed=61),dict(body['event'],occurred=0)):
            invalid=copy.deepcopy(body);invalid['event']=event
            self.assertEqual(self.client.post('/api/statistics',json=invalid).status_code,400)
        data=self.snapshot();self.assertEqual(len(data['Events']),1)
        self.assertEqual(data['Locations'][0]['country'],'unknown')
        self.assertFalse(any('ip'==k or 'secret' in k for k in data['Events'][0]))

    def test_history_progress_and_interruption(self):
        for name in ('First','Second'):
            self.visit,self.game=str(uuid4()),str(uuid4())
            for kind in ('page_view','game_start','hurry_up','game_complete','score_saved'):
                body=self.body(kind)
                if kind in ('hurry_up','game_complete','score_saved'):
                    body['event'].update(elapsed=45 if kind=='hurry_up' else 60,active=40,score=100,best=100)
                if kind=='score_saved': body['event'].update(name=name,score_id=1)
                self.assertEqual(self.client.post('/api/statistics',json=body).status_code,200)
        data=self.snapshot();self.assertEqual(len(data['Games']),2)
        self.assertEqual(data['Visitors'][0]['visits'],2)
        self.assertEqual(json.loads(data['Visitors'][0]['names']),['First','Second'])
        self.assertEqual(data['Games'][0]['progress'],1)
        self.game=str(uuid4())
        self.client.post('/api/statistics',json=self.body('game_start'))
        self.client.post('/api/statistics',json=self.body('visibility'))
        self.assertEqual(self.snapshot()['Games'][-1]['status'],'unknown')
        self.client.post('/api/statistics',json=self.body('game_interrupted'))
        self.assertEqual(self.snapshot()['Games'][-1]['status'],'interrupted')

    def login(self):
        page=self.client.get('/admin/login')
        csrf=re.search(r'name="csrf" value="([^"]+)"',page.text)[1]
        password=re.search(r'Password: (.+)',(Path(self.temp.name)/'ADMIN-ACCESS.txt').read_text())[1]
        result=self.client.post('/admin/login',data=dict(csrf=csrf,username='admin',password=password))
        self.assertEqual(result.status_code,302)

    def test_private_dashboard_csrf_and_deletion(self):
        self.client.post('/api/statistics',json=self.body())
        for path in ('/admin','/admin/download'):
            self.assertEqual(self.client.get(path).status_code,302)
        for path in ('/statistics.xlsx','/admin-credentials.json','/templates/admin.html'):
            self.assertEqual(self.client.get(path).status_code,404)
        self.login();self.assertEqual(self.client.get('/admin').status_code,200)
        self.assertEqual(self.client.post('/admin/export').status_code,403)
        bad=dict(visitor_id=self.visitor,secret=str(uuid4()))
        self.assertEqual(self.client.post('/api/statistics/delete',json=bad).status_code,403)
        with patch('statistics_admin.subprocess.Popen'):
            self.assertEqual(self.client.post('/api/statistics/delete',json=dict(visitor_id=self.visitor,secret=self.secret)).status_code,200)
        self.assertEqual(self.snapshot()['Events'],[])

    def test_deferred_score_is_owned_and_idempotent(self):
        token='a'*64;now=time.time()
        body=dict(token=token,deferred=True,started=now-70,ended=now-5)
        self.assertEqual(self.client.post('/api/runs',json=body).status_code,201)
        score=dict(token=token,score=120)
        row=self.client.post('/api/scores',json=score).json['entry']
        self.client.post('/api/runs',json=body)
        self.assertEqual(self.client.post('/api/scores',json=score).json['entry']['id'],row['id'])
        self.assertEqual(self.client.post('/api/scores',json=dict(score,name='Owner')).json['entry']['id'],row['id'])
        self.assertEqual(self.client.post('/api/runs',json=dict(body,started=now-1)).status_code,400)

    def test_retention_preserves_public_scores(self):
        token=self.client.post('/api/runs',json={}).json['token']
        self.client.post('/api/scores',json=dict(token=token,score=100,name='Kept'))
        self.client.post('/api/statistics',json=self.body())
        with sqlite3.connect(self.database) as db:
            db.execute('UPDATE stats_events SET occurred=?',(time.time()-91*86400,))
            stats.purge(db)
        self.assertEqual(self.snapshot()['Events'],[])
        self.assertEqual(self.snapshot()['Scores'][0]['name'],'Kept')


if __name__=='__main__': unittest.main()
