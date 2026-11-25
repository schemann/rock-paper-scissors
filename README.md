# Rock Paper Scissors 3D

Masterschool Backend Development exercise: add a score display to the
[Rock Paper Scissors Flask app](https://github.com/lazar-savko/rock).

- The score shows how often you and the computer have won, starting at 0 : 0.
- It lives in application memory (`Scoreboard` in `app.py`); draws are counted separately.
  Every browser gets an anonymous id in a signed session cookie and its own score, so
  players on a shared server do not see or reset each other's score.
- A background thread mirrors changes to `score.json` every two seconds, so a server
  restart continues with the last score. A missing or damaged file starts again at 0 : 0;
  a file from the first version (one global score) is ignored.
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

An unknown choice is a `400`. The score routes answer for the calling browser's own score.
`/play` and `/reset` need the session cookie the page hands out; without it they answer
`409`, set the cookie and store nothing (the page retries once), so a client that drops
cookies cannot fill the store. Only a visitor who played gets a slot; at most 20000 are
kept, the least recently seen go first. `GET /health` answers `{"status": "ok"}`.

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

# Plesk: site rps.schemann.dev in the schemann-networks.de subscription, Let's Encrypt on.
# Rate-limit zones (http context) and the proxy directives; Plesk's CLI has no option for
# additional nginx directives, so the file goes to the site's conf folder:
install -m 644 deploy/nginx-ratelimit.conf /etc/nginx/conf.d/rps-schemann-dev-ratelimit.conf
install -m 644 deploy/plesk-nginx.conf /var/www/vhosts/system/rps.schemann.dev/conf/vhost_nginx.conf
plesk sbin httpdmng --reconfigure-domain rps.schemann.dev

# update
cd /opt/rock-paper-scissors && git pull && docker compose up -d --build
```

gunicorn runs one worker with eight threads on purpose: the score lives in that one
process's memory. The score file sits in the Docker volume `score-data`. The container is
read-only, runs as a non-root user without capabilities, with memory, process and log
limits; `SECRET_KEY` is required there (the app refuses to start without it). nginx limits
`/play` and `/reset` to 2 requests a second per IP and everything else to 20.
