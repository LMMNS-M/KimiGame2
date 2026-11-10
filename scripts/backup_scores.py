"""Create a consistent SQLite backup without stopping the running game."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3

source = Path(os.environ.get('KIMI_DATABASE', str(Path.home() / '.local/share/kimi-game/scores.sqlite3')))
if not source.is_file():
    raise SystemExit(f'Base introuvable : {source}')
directory = source.parent / 'backups'
directory.mkdir(parents=True, exist_ok=True)
target = directory / f"scores-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.sqlite3"
os.umask(0o077)
original = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
backup = sqlite3.connect(target)
try:
    original.backup(backup)
finally:
    backup.close()
    original.close()
print(target)
