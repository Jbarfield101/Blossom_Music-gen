import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, Optional

_db_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def init_db(db_path: str = "combat_tracker.db"):
    """Initialize the SQLite database and create required tables."""
    global _conn
    with _db_lock:
        if _conn:
            _conn.close()
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.execute(
            """
            CREATE TABLE IF NOT EXISTS encounters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT
            );
            """
        )
        _conn.execute(
            """
            CREATE TABLE IF NOT EXISTS participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encounter_id INTEGER,
                name TEXT
            );
            """
        )
        _conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stats (
                participant_id INTEGER,
                name TEXT,
                value INTEGER,
                PRIMARY KEY (participant_id, name)
            );
            """
        )
        _conn.commit()
    return _conn


# Initialize default database on import
init_db()


def create_encounter(name: str) -> int:
    """Create a new encounter and return its ID."""
    with _db_lock:
        cur = _conn.cursor()
        cur.execute("INSERT INTO encounters(name) VALUES (?)", (name,))
        _conn.commit()
        return cur.lastrowid


def add_participant(encounter_id: int, name: str, stats: Optional[Dict[str, int]] = None) -> int:
    """Add a participant to an encounter."""
    stats = stats or {}
    with _db_lock:
        cur = _conn.cursor()
        cur.execute(
            "INSERT INTO participants(encounter_id, name) VALUES (?, ?)",
            (encounter_id, name),
        )
        participant_id = cur.lastrowid
        for s_name, value in stats.items():
            cur.execute(
                "INSERT OR REPLACE INTO stats(participant_id, name, value) VALUES (?, ?, ?)",
                (participant_id, s_name, int(value)),
            )
        _conn.commit()
        return participant_id


def update_stat(player: str, stat: str, delta: int, encounter_id: int):
    """Update a participant's stat by delta."""
    with _db_lock:
        cur = _conn.cursor()
        cur.execute(
            "SELECT id FROM participants WHERE encounter_id=? AND name=?",
            (encounter_id, player),
        )
        row = cur.fetchone()
        if not row:
            raise KeyError(f"Player {player} not found")
        participant_id = row[0]
        cur.execute(
            "SELECT value FROM stats WHERE participant_id=? AND name=?",
            (participant_id, stat),
        )
        row = cur.fetchone()
        value = row[0] if row else 0
        value += delta
        cur.execute(
            "INSERT OR REPLACE INTO stats(participant_id, name, value) VALUES (?, ?, ?)",
            (participant_id, stat, value),
        )
        _conn.commit()


def get_status(encounter_id: int) -> Dict[str, Dict[str, int]]:
    """Return all participant stats for an encounter."""
    with _db_lock:
        cur = _conn.cursor()
        cur.execute(
            "SELECT id, name FROM participants WHERE encounter_id=?",
            (encounter_id,),
        )
        participants = cur.fetchall()
        result: Dict[str, Dict[str, int]] = {}
        for pid, name in participants:
            cur.execute(
                "SELECT name, value FROM stats WHERE participant_id=?",
                (pid,),
            )
            stats = {s_name: int(value) for s_name, value in cur.fetchall()}
            result[name] = stats
        return result


class CombatTrackerRequestHandler(BaseHTTPRequestHandler):
    """Simple REST handler to manage combat encounters."""

    def _send_json(self, data: Dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(data) if data else {}
        except json.JSONDecodeError:
            self._send_json({"error": "invalid json"}, status=400)
            return

        parts = [p for p in self.path.strip("/").split("/") if p]
        if parts == ["encounters"]:
            encounter_id = create_encounter(payload.get("name", ""))
            self._send_json({"encounter_id": encounter_id})
            return
        if len(parts) == 3 and parts[0] == "encounters" and parts[2] == "participants":
            encounter_id = int(parts[1])
            name = payload["name"]
            stats = payload.get("stats", {})
            add_participant(encounter_id, name, stats)
            self._send_json({"status": "ok"})
            return
        if len(parts) == 5 and parts[0] == "encounters" and parts[2] == "participants" and parts[4] == "stats":
            encounter_id = int(parts[1])
            player = parts[3]
            stat = payload["stat"]
            delta = payload["delta"]
            update_stat(player, stat, delta, encounter_id)
            self._send_json({"status": "ok"})
            return
        self._send_json({"error": "not found"}, status=404)

    def do_GET(self):
        parts = [p for p in self.path.strip("/").split("/") if p]
        if len(parts) == 3 and parts[0] == "encounters" and parts[2] == "status":
            encounter_id = int(parts[1])
            self._send_json(get_status(encounter_id))
            return
        self._send_json({"error": "not found"}, status=404)


def run_server(host: str = "127.0.0.1", port: int = 8000):
    """Run the combat tracker REST server."""
    server = HTTPServer((host, port), CombatTrackerRequestHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()
