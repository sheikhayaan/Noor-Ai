import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parent.parent / "noor_ai.db"
c = sqlite3.connect(db)
for name, sql in c.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"):
    print("---", name, "---")
    print(sql)
    print()
for t in ("conversations", "messages", "users"):
    try:
        n = c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"{t}: {n} rows")
    except Exception as e:
        print(f"{t}: MISSING ({e})")
