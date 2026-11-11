"""Dirty-aware, atomic export. A lightweight systemd timer invokes this and exits."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import statistics_store as stats

# Columns for empty derived sheets; raw Events always follows the actual database schema.
EMPTY = {
 'Summary':['metric','value'], 'Funnel':['event','count'],
 'Visitors':['visitor_id','first_visit','last_visit','visits','games','names','scores'],
 'Visits':['visit_id','visitor_id','started','last_seen','duration','active','device','os','browser','geo_consent','country','region','city','geo_source','geo_accuracy'],
 'Games':['game_id','visit_id','visitor_id','started','ended','last_seen','elapsed','active','progress','status','score','best','name','score_id'],
 'Scores':['id','name','score','created','display_name'],
 'Locations':['visit_id','visitor_id','started','geo_consent','country','region','city','geo_source','geo_accuracy'],
 'Devices':['visit_id','visitor_id','started','device','os','browser'],
 'Geography':['country','region','city','visits'],
}


def validate_workbook(path, tables):
    """Check every exported header, row and cell, not just a valid ZIP signature."""
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as archive:
        if archive.testzip(): raise ValueError('Invalid XLSX archive')
        strings=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings=[''.join(e.itertext()) for e in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si',ns)]
        for index,(name,table) in enumerate(tables.items(),1):
            root=ET.fromstring(archive.read(f'xl/worksheets/sheet{index}.xml'))
            rows=root.findall('m:sheetData/m:row',ns)
            if len(rows)!=len(table['rows'])+1: raise ValueError(f'{name}: row count mismatch')
            for row_index,row in enumerate(rows):
                actual={}
                for cell in row.findall('m:c',ns):
                    ref=cell.attrib['r']; letters=''.join(c for c in ref if c.isalpha()); col=0
                    for c in letters: col=col*26+ord(c)-64
                    if cell.find('m:f',ns) is not None: raise ValueError('Unexpected formula in raw export')
                    value=cell.find('m:v',ns)
                    text=value.text if value is not None else None
                    kind=cell.attrib.get('t')
                    if kind=='s': text=strings[int(text)]
                    elif kind=='inlineStr': text=''.join(cell.find('m:is',ns).itertext())
                    elif text is not None and kind not in ('str','e'): text=float(text)
                    actual[col-1]=text
                for col,key in enumerate(table['columns']):
                    expected=key if row_index==0 else table['rows'][row_index-1].get(key)
                    if row_index==0 and key in {'occurred','received','started','ended','first_visit','last_visit','last_seen','created'}:
                        expected += ' (Unix seconds UTC)'
                    value=actual.get(col)
                    if expected in (None,'') and value in (None,''): continue
                    if isinstance(expected,(int,float)) and isinstance(value,(int,float)) and abs(expected-value)<0.00001: continue
                    if value!=expected: raise ValueError(f'{name}: cell mismatch at row {row_index+1}, {key}')


def export(database, manual=False, render=False):
    private=Path(database).parent
    with (private/'statistics-export.lock').open('w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return 'busy'
        db=sqlite3.connect(database,timeout=10);db.row_factory=sqlite3.Row
        try:
            with db: stats.purge(db)
            db.execute('BEGIN')
            state=dict(db.execute('SELECT * FROM stats_export WHERE id=1').fetchone())
            now=time.time()
            output=private/'statistics.xlsx'
            if state['version']==state['exported_version'] and output.exists(): return 'unchanged'
            if not manual and now-state['last_auto']<3600: return 'deferred'
            data=stats.snapshot(db)
            tables={name:dict(columns=list(rows[0]) if rows else (list(stats.EVENT_COLUMNS) if name=='Events' else EMPTY[name]),rows=rows) for name,rows in data.items()}
            raw_columns=[r['name'] for r in db.execute('PRAGMA table_info(stats_events)')]
            if tables['Events']['columns'] != raw_columns: raise ValueError('An event field is missing from the export')
            dates={'occurred','received','started','ended','first_visit','last_visit','last_seen','created'}
            for table in tables.values():
                for key in list(table['columns']):
                    if key not in dates: continue
                    table['columns'].append(key+'_utc')
                    for row in table['rows']:
                        row[key+'_utc'] = row[key]/86400+25569 if row.get(key) is not None else None
            db.commit()
            runtime=Path(os.environ.get('KIMI_ARTIFACT_RUNTIME',str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies')))
            with tempfile.TemporaryDirectory(prefix='.statistics-',dir=private) as folder:
                folder=Path(folder)
                (folder/'node_modules').symlink_to(runtime/'node/node_modules',target_is_directory=True)
                shutil.copyfile(ROOT/'scripts/export-workbook.mjs',folder/'build.mjs')
                (folder/'input.json').write_text(json.dumps(dict(tables=tables),ensure_ascii=False))
                candidate=folder/'statistics.xlsx'
                command=[str(runtime/'node/bin/node'),str(folder/'build.mjs'),str(folder/'input.json'),str(candidate)]
                if render: command.append(str(private/'export-preview'))
                subprocess.run(command,check=True,timeout=180,stdout=subprocess.DEVNULL)
                validate_workbook(candidate,tables)
                # Deletion during export must never resurrect private data in the workbook.
                db.execute('BEGIN IMMEDIATE')
                version=db.execute('SELECT version FROM stats_export WHERE id=1').fetchone()[0]
                if version != state['version']:
                    db.rollback();return 'changed during export; retry pending'
                os.chmod(candidate,0o600)
                with candidate.open('rb') as f: os.fsync(f.fileno())
                os.replace(candidate,output)
                db.execute('UPDATE stats_export SET exported_version=?,exported_at=?,last_auto=?,error=\'\' WHERE id=1',
                           (state['version'],now,state['last_auto'] if manual else now))
                db.commit()
            return 'exported'
        except Exception:
            db.rollback()
            with db: db.execute("UPDATE stats_export SET error='Export failed. The previous valid workbook is preserved; retry from the dashboard.' WHERE id=1")
            raise
        finally: db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--manual',action='store_true');parser.add_argument('--render',action='store_true');args=parser.parse_args()
    database=os.environ.get('KIMI_DATABASE',str(Path.home()/'.local/share/kimi-game/scores.sqlite3'))
    print(export(database,args.manual,args.render))
