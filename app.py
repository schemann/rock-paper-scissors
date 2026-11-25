"""Rock Paper Scissors: a Flask backend that keeps the score in application memory.

The score lives in a Scoreboard object in memory. Every change is also written
to score.json, so a server restart continues with the last score.
"""
import json
import os
import random
import tempfile
from threading import Lock

from flask import Flask, jsonify, render_template, request, send_from_directory

CHOICES = ("rock", "paper", "scissors")
BEATS = {"rock": "scissors", "paper": "rock", "scissors": "paper"}
SCORE_FILE = os.environ.get(
    "RPS_SCORE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "score.json")
)


class Scoreboard:
    """Win counts of player and computer, held in memory and mirrored to a JSON file."""

    FIELDS = ("user", "computer", "draws")

    def __init__(self, path=None):
        self._lock = Lock()
        self.path = path
        self.counts = dict.fromkeys(self.FIELDS, 0)
        self._load()

    def _load(self):
        """Read the last saved score; a missing or damaged file starts at 0 : 0."""
        if not self.path:
            return
        try:
            with open(self.path, encoding="utf-8") as handle:
                saved = json.load(handle)
        except (OSError, ValueError):
            return
        if not isinstance(saved, dict):
            return
        for field in self.FIELDS:
            value = saved.get(field)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                self.counts[field] = value

    def _save(self):
        """Write the score atomically: a temp file in the same folder, then a rename."""
        if not self.path:
            return
        folder = os.path.dirname(self.path) or "."
        try:
            handle, temp_path = tempfile.mkstemp(dir=folder, prefix=".score-", suffix=".json")
            with os.fdopen(handle, "w", encoding="utf-8") as temp_file:
                json.dump(self.counts, temp_file)
            os.replace(temp_path, self.path)
        except OSError as error:
            app.logger.warning("Could not save the score to %s: %s", self.path, error)

    def record(self, result):
        """Count one round ('win', 'lose' or 'draw') and return the new score."""
        field = {"win": "user", "lose": "computer", "draw": "draws"}[result]
        with self._lock:
            self.counts[field] += 1
            self._save()
            return self.snapshot()

    def reset(self):
        """Set the score back to 0 : 0 and return it."""
        with self._lock:
            self.counts = dict.fromkeys(self.FIELDS, 0)
            self._save()
            return self.snapshot()

    def snapshot(self):
        """Return the score in the shape the frontend reads."""
        return {
            "user_score": self.counts["user"],
            "computer_score": self.counts["computer"],
            "draws": self.counts["draws"],
            "rounds": sum(self.counts.values()),
        }


app = Flask(__name__)
scoreboard = Scoreboard(SCORE_FILE)


def determine_winner(user, computer):
    """Return 'win', 'lose' or 'draw' from the player's point of view."""
    if user == computer:
        return "draw"
    return "win" if BEATS[user] == computer else "lose"


@app.route("/")
def index():
    """Serve the 3D game page."""
    return render_template("index.html", score=scoreboard.snapshot())


@app.route("/favicon.ico")
def favicon():
    """Serve the tab icon."""
    return send_from_directory(app.static_folder, "favicon.svg", mimetype="image/svg+xml")


@app.route("/play", methods=["POST"])
def play():
    """Play one round against a random computer move and update the score."""
    data = request.get_json(silent=True)
    user_choice = data.get("choice") if isinstance(data, dict) else None
    if user_choice not in CHOICES:
        return jsonify({"error": f"choice must be one of {', '.join(CHOICES)}"}), 400
    computer_choice = random.choice(CHOICES)
    result = determine_winner(user_choice, computer_choice)
    return jsonify(
        {
            "user_choice": user_choice,
            "computer_choice": computer_choice,
            "result": result,
            **scoreboard.record(result),
        }
    )


@app.route("/score", methods=["GET"])
def score():
    """Return the current score."""
    return jsonify(scoreboard.snapshot())


@app.route("/reset", methods=["POST"])
def reset():
    """Start again at 0 : 0."""
    return jsonify(scoreboard.reset())


if __name__ == "__main__":
    app.run(debug=True)
