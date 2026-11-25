# Rock Paper Scissors 3D

Masterschool Backend Development exercise: add a score display to the
[Rock Paper Scissors Flask app](https://github.com/lazar-savko/rock).

- The score shows how often you and the computer have won, starting at 0 : 0.
- It lives in application memory (`Scoreboard` in `app.py`); draws are counted separately.
  Every browser gets an anonymous id in a signed session cookie and its own score, so
  players on a shared server do not see or reset each other's score.
- Every change is also mirrored to `score.json`, so a server restart continues with the
  last score. A missing or damaged file starts again at 0 : 0.
- The frontend is a three.js 3D scene: pick rock, paper or scissors on the pedestals
  (or press 1 2 3, R P S), watch the duel against the computer and the LED scoreboard.
  0 resets the score. three.js 0.187.0 is vendored in `static/vendor/three` (MIT), so the
  game runs without a CDN; only the Space Grotesk font comes from Google Fonts.
- `RPS_SCORE_FILE` sets another path for the score file. `SECRET_KEY` signs the session
  cookie; without it every start uses a fresh key and players begin a new score.

## Run

```
pip3 install -r requirements.txt
python3 app.py
```

Open http://127.0.0.1:5000.

## API

| Method | Path     | Body                     | Answer |
|--------|----------|--------------------------|--------|
| POST   | `/play`  | `{"choice": "rock"}`     | `user_choice`, `computer_choice`, `result` (`win`/`lose`/`draw`), `user_score`, `computer_score`, `draws`, `rounds` |
| GET    | `/score` |                          | `user_score`, `computer_score`, `draws`, `rounds` |
| POST   | `/reset` |                          | the score at 0 : 0 |

An unknown choice is a `400`. All routes answer for the calling browser's own score.
`GET /health` answers `{"status": "ok"}` for the container health check.

## Tests and style

```
python3 -m unittest discover -s tests -t .
pylint --disable=W0311,W1514,C0114 app.py tests/__init__.py tests/test_app.py
```

## Deploy

Live at https://rps.schemann.dev: a Docker Compose stack on the Plesk server, behind the
Plesk nginx of the site `rps.schemann.dev`, which proxies to `127.0.0.1:3060`.

```
# first time, on the server
git clone https://github.com/schemann/rock-paper-scissors.git /opt/rock-paper-scissors
cd /opt/rock-paper-scissors
printf 'SECRET_KEY=%s\n' "$(openssl rand -hex 32)" > .env && chmod 600 .env
docker compose up -d --build

# update
cd /opt/rock-paper-scissors && git pull && docker compose up -d --build
```

gunicorn runs one worker with eight threads on purpose: the score lives in that one
process's memory. The score file sits in the Docker volume `score-data`.
