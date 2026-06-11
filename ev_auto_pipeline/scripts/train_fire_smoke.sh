#!/bin/bash
#SBATCH --job-name=fire_smoke_train
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=12:00:00
#SBATCH --output=/home1/junlee/ev_auto_pipeline/logs/fire_smoke_%j.log
#SBATCH --error=/home1/junlee/ev_auto_pipeline/logs/fire_smoke_%j.log

echo "========================================"
echo "Job ID: $SLURM_JOB_ID"
echo "GPU: $CUDA_VISIBLE_DEVICES"
echo "Start: $(date)"
echo "========================================"

source /home1/junlee/ev_auto_pipeline/venv/bin/activate

cd /home1/junlee/ev_auto_pipeline

python train_fire_smoke.py \
  --data datasets/fire_smoke/data.yaml \
  --base-weights yolo11x.pt \
  --epochs 80 \
  --batch 8 \
  --model-name "fire_smoke_v1" \
  --device 0

echo "========================================"
echo "End: $(date)"
echo "========================================"
