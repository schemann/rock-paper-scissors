"""Tests for the Rock Paper Scissors backend: rules, score per visitor, JSON mirror."""
import json
import os
import shutil
import tempfile
import threading
import unittest
from unittest import mock

import app as rps


class DetermineWinnerTest(unittest.TestCase):
    """The rules from the player's point of view."""

    def test_all_pairs(self):
        """Every one of the nine pairs gives the right result."""
        expected = {
            ("rock", "scissors"): "win",
            ("scissors", "paper"): "win",
            ("paper", "rock"): "win",
            ("scissors", "rock"): "lose",
            ("paper", "scissors"): "lose",
            ("rock", "paper"): "lose",
        }
        for user in rps.CHOICES:
            for computer in rps.CHOICES:
                want = "draw" if user == computer else expected[(user, computer)]
                self.assertEqual(rps.determine_winner(user, computer), want)


class ScoreTestBase(unittest.TestCase):
    """Shared setup: a scoreboard that writes to a temp file, clients with a session."""

    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        self.path = os.path.join(folder, "score.json")
        self.board = rps.Scoreboard(self.path, autosave=None)
        patcher = mock.patch.object(rps, "scoreboard", self.board)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = self.browser()

    @staticmethod
    def browser():
        """A test client that loaded the page once, so it holds a session cookie."""
        client = rps.app.test_client()
        client.get("/")
        return client

    def play(self, user, computer, client=None):
        """Play one round with a fixed computer move."""
        with mock.patch.object(rps.random, "choice", return_value=computer):
            return (client or self.client).post("/play", json={"choice": user})

    def visitor(self, client=None):
        """Return the anonymous visitor id stored in a client's session cookie."""
        with (client or self.client).session_transaction() as session:
            return session["visitor"]


class ScoreApiTest(ScoreTestBase):
    """The HTTP surface: rules, sessions, visitors."""

    def test_starts_at_zero(self):
        """A fresh game shows 0 : 0."""
        body = self.client.get("/score").get_json()
        self.assertEqual(body, {"user_score": 0, "computer_score": 0, "draws": 0, "rounds": 0})

    def test_rounds_count_wins_losses_and_draws(self):
        """Wins and losses go to the two sides, draws are counted apart."""
        self.assertEqual(self.play("rock", "scissors").get_json()["result"], "win")
        self.assertEqual(self.play("rock", "paper").get_json()["result"], "lose")
        body = self.play("paper", "paper").get_json()
        self.assertEqual(body["result"], "draw")
        self.assertEqual(body["user_choice"], "paper")
        self.assertEqual(body["computer_choice"], "paper")
        self.assertEqual(
            (body["user_score"], body["computer_score"], body["draws"], body["rounds"]),
            (1, 1, 1, 3),
        )
        self.assertEqual(self.client.get("/score").get_json()["rounds"], 3)

    def test_visitors_keep_separate_scores(self):
        """Two browsers do not see or reset each other's score."""
        other = self.browser()
        self.play("rock", "scissors")
        self.play("rock", "scissors")
        self.play("rock", "paper", client=other)
        self.assertEqual(self.client.get("/score").get_json()["user_score"], 2)
        self.assertEqual(other.get("/score").get_json()["computer_score"], 1)
        other.post("/reset")
        self.assertEqual(self.client.get("/score").get_json()["user_score"], 2)
        self.assertNotEqual(self.visitor(), self.visitor(other))

    def test_forged_visitor_id_is_replaced(self):
        """A session value that is not a valid id gets a fresh one."""
        with self.client.session_transaction() as session:
            session["visitor"] = "../../etc/passwd"
        self.assertEqual(self.play("rock", "scissors").status_code, 409)
        self.assertRegex(self.visitor(), rps.VISITOR_ID)
        self.assertEqual(self.play("rock", "scissors").status_code, 200)
        self.assertEqual(list(self.board.visitors), [self.visitor()])

    def test_cookieless_writes_store_nothing(self):
        """A client that never sends its cookie back cannot create score entries."""
        for _ in range(5):
            bare = rps.app.test_client(use_cookies=False)
            self.assertEqual(bare.post("/play", json={"choice": "rock"}).status_code, 409)
            self.assertEqual(bare.post("/reset").status_code, 409)
            self.assertEqual(bare.get("/score").get_json()["rounds"], 0)
        self.assertEqual(len(self.board.visitors), 0)

    def test_first_play_without_cookie_hands_one_out(self):
        """The 409 answer sets the cookie, so the retry counts."""
        client = rps.app.test_client()
        self.assertEqual(self.play("rock", "scissors", client=client).status_code, 409)
        self.assertEqual(self.play("rock", "scissors", client=client).get_json()["user_score"], 1)

    def test_reading_or_resetting_does_not_store_new_visitors(self):
        """Page views, score reads and resets of unknown visitors leave the store empty."""
        self.client.get("/score")
        self.client.post("/reset")
        self.browser().get("/score")
        self.assertEqual(len(self.board.visitors), 0)

    def test_invalid_choice_is_rejected(self):
        """A wrong choice, a missing body or a non-object body is a 400 and counts nothing."""
        for payload in ({"choice": "lizard"}, {}, ["rock"], "rock"):
            self.assertEqual(self.client.post("/play", json=payload).status_code, 400)
        self.assertEqual(self.client.post("/play", data="not json").status_code, 400)
        self.assertEqual(self.client.get("/score").get_json()["rounds"], 0)

    def test_least_recent_visitors_are_dropped(self):
        """Beyond MAX_VISITORS the visitor seen longest ago is forgotten."""
        with mock.patch.object(rps.Scoreboard, "MAX_VISITORS", 2):
            first, second, third = (self.browser() for _ in range(3))
            self.play("rock", "scissors", client=first)
            self.play("rock", "scissors", client=second)
            self.play("rock", "scissors", client=first)
            self.play("rock", "scissors", client=third)
            self.assertEqual(list(self.board.visitors), [self.visitor(first), self.visitor(third)])
            self.assertEqual(second.get("/score").get_json()["rounds"], 0)
            self.assertEqual(first.get("/score").get_json()["rounds"], 2)

    def test_viewing_counts_as_seen(self):
        """Reading the score keeps a visitor from being the next one dropped."""
        with mock.patch.object(rps.Scoreboard, "MAX_VISITORS", 2):
            first, second, third = (self.browser() for _ in range(3))
            self.play("rock", "scissors", client=first)
            self.play("rock", "scissors", client=second)
            first.get("/score")
            self.play("rock", "scissors", client=third)
            self.assertEqual(list(self.board.visitors), [self.visitor(first), self.visitor(third)])

    def test_page_and_health(self):
        """The game page loads with the vendored three.js, the health check answers."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"vendor/three/three.module.js", response.data)
        self.assertEqual(self.client.get("/health").get_json(), {"status": "ok"})


class PersistenceTest(ScoreTestBase):
    """The JSON mirror: background saving, restarts, damaged files, disk errors."""

    def test_reset(self):
        """Reset returns to 0 : 0, also after a restart."""
        self.play("scissors", "paper")
        self.board.flush()
        body = self.client.post("/reset").get_json()
        self.assertEqual((body["user_score"], body["computer_score"], body["rounds"]), (0, 0, 0))
        self.board.flush()
        restarted = rps.Scoreboard(self.path, autosave=None).snapshot(self.visitor())
        self.assertEqual(restarted["rounds"], 0)

    def test_score_survives_a_restart(self):
        """The JSON mirror brings the score back in a new scoreboard."""
        self.play("paper", "rock")
        self.play("paper", "scissors")
        visitor = self.visitor()
        self.assertFalse(os.path.exists(self.path))
        self.board.flush()
        with open(self.path, encoding="utf-8") as handle:
            saved = json.load(handle)
        self.assertEqual(saved["visitors"][visitor], {"user": 1, "computer": 1, "draws": 0})
        restarted = rps.Scoreboard(self.path, autosave=None).snapshot(visitor)
        self.assertEqual((restarted["user_score"], restarted["computer_score"]), (1, 1))

    def test_flush_writes_only_changes(self):
        """An unchanged board does not touch the disk."""
        self.play("rock", "scissors")
        self.board.flush()
        with mock.patch.object(rps.tempfile, "mkstemp") as mkstemp:
            self.board.flush()
            self.client.get("/score")
            self.board.flush()
        mkstemp.assert_not_called()

    def test_autosave_thread_writes_the_file(self):
        """With autosave on, a change reaches the disk without an explicit flush."""
        board = rps.Scoreboard(self.path, autosave=0.05)
        with mock.patch.object(rps, "scoreboard", board):
            self.play("paper", "rock")
        for _ in range(100):
            if os.path.exists(self.path):
                break
            threading.Event().wait(0.02)
        with open(self.path, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["visitors"][self.visitor()]["user"], 1)

    def test_damaged_file_starts_at_zero(self):
        """A broken or hostile score file never crashes the app."""
        hostile = json.dumps({"visitors": {
            "short": {"user": 5},
            "x" * 20: {"user": -3, "draws": True},
            "y" * 20: [1, 2],
        }})
        for content in ("{not json", "[1, 2]", '{"visitors": 7}', hostile):
            with open(self.path, "w", encoding="utf-8") as handle:
                handle.write(content)
            board = rps.Scoreboard(self.path, autosave=None)
            self.assertNotIn("short", board.visitors)
            self.assertNotIn("y" * 20, board.visitors)
            self.assertEqual(board.snapshot("x" * 20)["rounds"], 0)

    def test_unwritable_file_keeps_the_game_running(self):
        """A score file in a missing folder is logged, the score stays in memory."""
        board = rps.Scoreboard(os.path.join(self.path, "missing", "score.json"), autosave=None)
        with mock.patch.object(rps, "scoreboard", board):
            response = self.play("rock", "scissors")
            with self.assertLogs(rps.app.logger, level="WARNING"):
                board.flush()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["user_score"], 1)
        self.assertTrue(board.dirty, "a failed write must be retried")

    def test_failed_replace_leaves_no_temp_file(self):
        """When the rename fails, the old file stays and no temp file is left over."""
        self.play("rock", "scissors")
        self.board.flush()
        self.play("rock", "scissors")
        with mock.patch.object(rps.os, "replace", side_effect=OSError("disk full")):
            with self.assertLogs(rps.app.logger, level="WARNING"):
                self.board.flush()
        folder = os.path.dirname(self.path)
        self.assertEqual(os.listdir(folder), ["score.json"])
        restarted = rps.Scoreboard(self.path, autosave=None).snapshot(self.visitor())
        self.assertEqual(restarted["user_score"], 1)

    def test_failed_cleanup_does_not_raise(self):
        """If even removing the temp file fails, flushing only logs."""
        self.play("rock", "scissors")
        with mock.patch.object(rps.os, "replace", side_effect=OSError("disk full")), \
                mock.patch.object(rps.os, "unlink", side_effect=OSError("busy")):
            with self.assertLogs(rps.app.logger, level="WARNING"):
                self.board.flush()


class SecretKeyTest(unittest.TestCase):
    """Where the cookie signing key comes from."""

    def test_key_from_environment(self):
        """A set SECRET_KEY is used as it is."""
        environ = {"SECRET_KEY": "abc", "RPS_SECURE_COOKIE": "1"}
        self.assertEqual(rps.load_secret_key(environ), "abc")

    def test_production_without_key_refuses_to_start(self):
        """Secure cookies without a key would wipe every score on restart."""
        for environ in ({"RPS_SECURE_COOKIE": "1"}, {"RPS_SECURE_COOKIE": "1", "SECRET_KEY": "  "}):
            with self.assertRaises(RuntimeError):
                rps.load_secret_key(environ)

    def test_development_gets_a_fresh_key(self):
        """Locally a missing key is replaced by a random one."""
        self.assertEqual(len(rps.load_secret_key({})), 64)

    def test_cookie_flags(self):
        """The session cookie is HttpOnly and SameSite=Lax."""
        header = rps.app.test_client().get("/").headers["Set-Cookie"]
        self.assertIn("HttpOnly", header)
        self.assertIn("SameSite=Lax", header)


if __name__ == "__main__":
    unittest.main()
