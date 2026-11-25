# Production image: gunicorn with ONE worker process. The score lives in that process's
# memory, so more workers would each keep their own score; threads serve requests in parallel.
FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RPS_SCORE_FILE=/data/score.json

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static ./static
COPY templates ./templates

RUN useradd --system --uid 10001 rps && mkdir /data && chown rps /data
USER rps

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["gunicorn", "app:app", "--workers", "1", "--threads", "8", "--bind", "0.0.0.0:8000", "--access-logfile", "-"]
