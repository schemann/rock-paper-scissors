"""Rock Paper Scissors: a Flask backend that keeps the score in application memory.

Every visitor gets an anonymous id in a signed session cookie; the scores live
in memory under that id, so players on a shared server do not see or reset each
other's score. A background thread mirrors changes to score.json, so a server
restart continues with the last score.
"""
import atexit
import json
import os
import random
import re
import secrets
import tempfile
import threading
from collections import OrderedDict

from flask import Flask, jsonify, render_template, request, send_from_directory, session

CHOICES = ("rock", "paper", "scissors")
BEATS = {"rock": "scissors", "paper": "rock", "scissors": "paper"}
SCORE_FILE = os.environ.get(
    "RPS_SCORE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "score.json")
)
VISITOR_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def valid_count(value):
    """True for a non-negative integer that is not a bool."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


class Scoreboard:
    """Win counts per visitor, held in memory and mirrored to a JSON file.

    The least recently seen visitors are dropped beyond MAX_VISITORS, so the
    memory a public server spends on scores stays bounded. Changes only mark
    the board dirty; a background thread writes the file every `autosave`
    seconds, so a burst of requests never waits on the disk.
    """

    FIELDS = ("user", "computer", "draws")
    MAX_VISITORS = 20000

    def __init__(self, path=None, autosave=2.0):
        self._lock = threading.Lock()
        self._save_lock = threading.Lock()
        self.path = path
        self.visitors = OrderedDict()
        self.dirty = False
        self._load()
        if path and autosave:
            worker = threading.Thread(target=self._autosave, args=(autosave,), daemon=True)
            worker.start()
            atexit.register(self.flush)

    def _load(self):
        """Read the saved scores; a missing or damaged file starts everyone at 0 : 0.

        Files from the first version (one global score, no "visitors" key) are ignored.
        """
        if not self.path:
            return
        try:
            with open(self.path, encoding="utf-8") as handle:
                saved = json.load(handle)
        except (OSError, ValueError):
            return
        visitors = saved.get("visitors") if isinstance(saved, dict) else None
        if not isinstance(visitors, dict):
            return
        for visitor, counts in visitors.items():
            if not isinstance(visitor, str) or not VISITOR_ID.match(visitor):
                continue
            if not isinstance(counts, dict):
                continue
            self.visitors[visitor] = {
                field: counts.get(field) if valid_count(counts.get(field)) else 0
                for field in self.FIELDS
            }
        while len(self.visitors) > self.MAX_VISITORS:
            self.visitors.popitem(last=False)

    def _autosave(self, interval):
        """Write the file whenever something changed, until the process ends."""
        stop = threading.Event()
        while not stop.wait(interval):
            self.flush()

    def flush(self):
        """Write the scores now if they changed: a temp file in the same folder, then a rename."""
        if not self.path:
            return
        with self._save_lock:
            with self._lock:
                if not self.dirty:
                    return
                payload = json.dumps({"visitors": self.visitors})
                self.dirty = False
            if not self._write(payload):
                with self._lock:
                    self.dirty = True

    def _write(self, payload):
        """Atomically replace the score file; return False when the disk refused."""
        folder = os.path.dirname(self.path) or "."
        temp_path = None
        try:
            handle, temp_path = tempfile.mkstemp(dir=folder, prefix=".score-", suffix=".json")
            with os.fdopen(handle, "w", encoding="utf-8") as temp_file:
                temp_file.write(payload)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_path, self.path)
            temp_path = None
            return True
        except OSError as error:
            app.logger.warning("Could not save the score to %s: %s", self.path, error)
            return False
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    def _counts(self, visitor):
        """Return the visitor's counts, created at 0 : 0; marks the visitor as recently seen."""
        counts = self.visitors.get(visitor)
        if counts is None:
            counts = dict.fromkeys(self.FIELDS, 0)
            self.visitors[visitor] = counts
            while len(self.visitors) > self.MAX_VISITORS:
                self.visitors.popitem(last=False)
        else:
            self.visitors.move_to_end(visitor)
        return counts

    @staticmethod
    def _shape(counts):
        """Return counts in the shape the frontend reads."""
        return {
            "user_score": counts["user"],
            "computer_score": counts["computer"],
            "draws": counts["draws"],
            "rounds": sum(counts.values()),
        }

    def record(self, visitor, result):
        """Count one round ('win', 'lose' or 'draw') for a visitor and return the new score."""
        field = {"win": "user", "lose": "computer", "draw": "draws"}[result]
        with self._lock:
            counts = self._counts(visitor)
            counts[field] += 1
            self.dirty = True
            return self._shape(counts)

    def reset(self, visitor):
        """Set a visitor's score back to 0 : 0; an unknown visitor is not stored."""
        with self._lock:
            if visitor in self.visitors:
                self.visitors[visitor] = dict.fromkeys(self.FIELDS, 0)
                self.visitors.move_to_end(visitor)
                self.dirty = True
            return self._shape(dict.fromkeys(self.FIELDS, 0))

    def snapshot(self, visitor):
        """Return a visitor's score; an unknown visitor sees 0 : 0 and is not stored."""
        with self._lock:
            counts = self.visitors.get(visitor)
            if counts is None:
                return self._shape(dict.fromkeys(self.FIELDS, 0))
            self.visitors.move_to_end(visitor)
            return self._shape(counts)


def load_secret_key(environ):
    """Return the cookie signing key: SECRET_KEY, or a fresh one outside production.

    With secure cookies on (production) a missing key is an error, since every
    restart would otherwise sign with a new key and wipe every player's score.
    """
    key = environ.get("SECRET_KEY", "").strip()
    if key:
        return key
    if environ.get("RPS_SECURE_COOKIE") == "1":
        raise RuntimeError("SECRET_KEY must be set when RPS_SECURE_COOKIE=1")
    return secrets.token_hex(32)


app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret_key(os.environ),
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("RPS_SECURE_COOKIE") == "1",
)
if not os.environ.get("SECRET_KEY"):
    app.logger.warning("SECRET_KEY is not set: players start a new score after every restart")
scoreboard = Scoreboard(SCORE_FILE)


def known_visitor():
    """Return the visitor id from the session cookie, or None when there is no valid one."""
    visitor = session.get("visitor")
    if isinstance(visitor, str) and VISITOR_ID.match(visitor):
        return visitor
    return None


def ensure_visitor():
    """Return this browser's anonymous id, creating it in the session cookie on first use."""
    visitor = known_visitor()
    if visitor is None:
        visitor = secrets.token_urlsafe(16)
        session["visitor"] = visitor
        session.permanent = True
    return visitor


def no_session():
    """Answer a write without a session cookie: hand one out, store nothing."""
    ensure_visitor()
    return jsonify({"error": "no session yet: load the page first, then play"}), 409


def determine_winner(user, computer):
    """Return 'win', 'lose' or 'draw' from the player's point of view."""
    if user == computer:
        return "draw"
    return "win" if BEATS[user] == computer else "lose"


@app.route("/")
def index():
    """Serve the 3D game page."""
    return render_template("index.html", score=scoreboard.snapshot(ensure_visitor()))


@app.route("/favicon.ico")
def favicon():
    """Serve the tab icon."""
    return send_from_directory(app.static_folder, "favicon.svg", mimetype="image/svg+xml")


@app.route("/health")
def health():
    """Answer the container health check."""
    return jsonify({"status": "ok"})


@app.route("/play", methods=["POST"])
def play():
    """Play one round against a random computer move and update the score.

    Only a browser whose session cookie came back gets a score slot, so a
    client that drops cookies cannot flood the store with new visitors.
    """
    data = request.get_json(silent=True)
    user_choice = data.get("choice") if isinstance(data, dict) else None
    if user_choice not in CHOICES:
        return jsonify({"error": f"choice must be one of {', '.join(CHOICES)}"}), 400
    visitor = known_visitor()
    if visitor is None:
        return no_session()
    computer_choice = random.choice(CHOICES)
    result = determine_winner(user_choice, computer_choice)
    return jsonify(
        {
            "user_choice": user_choice,
            "computer_choice": computer_choice,
            "result": result,
            **scoreboard.record(visitor, result),
        }
    )


@app.route("/score", methods=["GET"])
def score():
    """Return the current score."""
    return jsonify(scoreboard.snapshot(ensure_visitor()))


@app.route("/reset", methods=["POST"])
def reset():
    """Start again at 0 : 0."""
    visitor = known_visitor()
    if visitor is None:
        return no_session()
    return jsonify(scoreboard.reset(visitor))


if __name__ == "__main__":
    app.run(debug=True)
