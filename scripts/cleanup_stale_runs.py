"""Cancel all stale 'running' engine runs and task logs."""
import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"
conn = sqlite3.connect(str(db))
r1 = conn.execute("UPDATE engine_runs SET Status='cancelled', EndedAt=datetime('now') WHERE Status='running'")
r2 = conn.execute("UPDATE engine_task_log SET Status='cancelled' WHERE Status='running'")
conn.commit()
print(f"Cancelled {r1.rowcount} runs, {r2.rowcount} task logs")
conn.close()
