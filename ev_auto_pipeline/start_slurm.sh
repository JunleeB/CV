#!/bin/bash
#SBATCH --job-name=ev_annotator
#SBATCH --nodelist=gpu-106
#SBATCH --gres=gpu:A6000:2
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=INFINITE
#SBATCH --output=/home1/junlee/ev_auto_pipeline/logs/slurm_%j.out
#SBATCH --error=/home1/junlee/ev_auto_pipeline/logs/slurm_%j.err

cd /home1/junlee/ev_auto_pipeline

set -a
[ -f .env ] && source .env
set +a
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-changeme}"
PGADMIN_EMAIL="${PGADMIN_EMAIL:-admin@example.com}"
PGADMIN_PASSWORD="${PGADMIN_PASSWORD:-changeme}"

# SLURM이 CUDA_VISIBLE_DEVICES를 자동 설정
# inference.py: cuda:0 = YOLO+SAM2 추론, cuda:1 = Grounding DINO

echo "[$(date)] Job $SLURM_JOB_ID started on $SLURMD_NODENAME"
echo "  CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
echo "  NUM_INFERENCE_WORKERS=$NUM_INFERENCE_WORKERS"

# PostgreSQL 컨테이너 시작
if ! docker ps | grep -q ev_postgres; then
  echo "PostgreSQL 시작 중..."
  docker start ev_postgres 2>/dev/null || \
  docker run -d --name ev_postgres \
    -e POSTGRES_DB=annotation \
    -e POSTGRES_USER=evuser \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -p 5432:5432 \
    -v "$(pwd)/pgdata:/var/lib/postgresql/data" \
    postgres:15
  sleep 3
fi

# pgAdmin 시작
if ! docker ps | grep -q ev_pgadmin; then
  docker start ev_pgadmin 2>/dev/null || \
  docker run -d --name ev_pgadmin \
    -e PGADMIN_DEFAULT_EMAIL="$PGADMIN_EMAIL" \
    -e PGADMIN_DEFAULT_PASSWORD="$PGADMIN_PASSWORD" \
    -p 5050:80 \
    --link ev_postgres:postgres \
    dpage/pgadmin4
fi

echo "Starting EV Annotator on http://192.168.110.106:8010"
venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8010
