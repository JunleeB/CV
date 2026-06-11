#!/bin/bash
cd "$(dirname "$0")"
export CUDA_VISIBLE_DEVICES=2,5

# PostgreSQL 컨테이너 시작
if ! docker ps | grep -q ev_postgres; then
  echo "PostgreSQL 시작 중..."
  docker start ev_postgres 2>/dev/null || \
  docker run -d --name ev_postgres \
    -e POSTGRES_DB=annotation \
    -e POSTGRES_USER=evuser \
    -e POSTGRES_PASSWORD=REDACTED \
    -p 5432:5432 \
    -v "$(pwd)/pgdata:/var/lib/postgresql/data" \
    postgres:15
  sleep 3
fi

# pgAdmin 시작 (DB 관리 웹 UI)
if ! docker ps | grep -q ev_pgadmin; then
  docker start ev_pgadmin 2>/dev/null || \
  docker run -d --name ev_pgadmin \
    -e PGADMIN_DEFAULT_EMAIL=redacted@example.com \
    -e PGADMIN_DEFAULT_PASSWORD=REDACTED \
    -p 5050:80 \
    --link ev_postgres:postgres \
    dpage/pgadmin4
fi

echo "Starting EV Annotator on http://192.168.110.106:8000"
venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
