#!/bin/bash
# Development mode: FastAPI backend + Vite frontend dev server
cd "$(dirname "$0")"
export CUDA_VISIBLE_DEVICES=1,2,4,7   # cuda:0=GPU1(추론), cuda:1=GPU2(GDINO)

echo "Starting backend on :8010 and frontend dev server on :5173"
echo "Open http://localhost:5173"
echo ""

# Start FastAPI in background
venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8010 --reload &
BACKEND_PID=$!

# Start Vite dev server
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh" --no-use 2>/dev/null
export PATH="$NVM_DIR/versions/node/v20.20.2/bin:$PATH"
cd frontend && npm run dev

# Cleanup on exit
kill $BACKEND_PID 2>/dev/null
