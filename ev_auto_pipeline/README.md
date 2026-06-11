# EV 자동 어노테이션 시스템

> YOLO11 + SAM2 + Grounding DINO 기반 웹 자동 어노테이션 플랫폼  
> EV 주차장 CCTV 영상에서 화재·연기·차량 객체를 자동으로 탐지하고 어노테이션을 생성합니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 어노테이션 | YOLO11 탐지 + SAM2 세그멘테이션으로 배치 레이블링 |
| 제로샷 탐지 | Grounding DINO로 학습 없이 화재·연기 탐지 |
| 인터랙티브 SAM2 | 클릭(bbox/포인트) → 즉시 마스크 생성 |
| 비디오 트래킹 | SAM2 Video Predictor로 프레임 간 객체 전파 |
| 파인튜닝 | 어노테이션 데이터로 YOLO 모델 재학습 |
| 다중 포맷 내보내기 | YOLO / COCO / VOC / CSV |

## 기술 스택

**Backend**: FastAPI · SQLAlchemy · PostgreSQL · PyTorch 2.11 (CUDA 12.8)  
**Frontend**: React 19 · TypeScript · Vite · Konva · Zustand · Tailwind CSS  
**ML**: YOLO11 · SAM2 (Meta) · Grounding DINO (IDEA-Research)

## 아키텍처

```
[React SPA]  ←→  [FastAPI :8000]  ←→  [PostgreSQL :5432]
                      │
              [inference.py]
              ├── YOLO11  (GPU 2, cuda:0)
              ├── SAM2    (GPU 2, cuda:0)
              └── GDINO   (GPU 5, cuda:1)
```

GPU 구성: GPU 2 (YOLO+SAM2 추론) / GPU 5 (Grounding DINO) / GPU 3 (파인튜닝 학습)

## 빠른 시작

### 사전 요구사항

- Python 3.12 + venv
- Node.js 20+
- Docker (PostgreSQL 컨테이너)
- CUDA 12.8 호환 GPU

### 설치

```bash
git clone https://github.com/JunleeB/ev-auto-annotation.git
cd ev-auto-annotation

# Python 환경
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt

# 프론트엔드
cd frontend && npm install && npm run build && cd ..

# SAM2 체크포인트 다운로드
mkdir -p checkpoints
# https://github.com/facebookresearch/sam2 에서 sam2.1_hiera_large.pt 다운로드
# → checkpoints/sam2.1_hiera_large.pt

# PostgreSQL (Docker)
docker run -d --name ev_postgres \
  -e POSTGRES_DB=annotation \
  -e POSTGRES_USER=evuser \
  -e POSTGRES_PASSWORD=REDACTED \
  -p 5432:5432 \
  -v ./pgdata:/var/lib/postgresql/data \
  postgres:15
```

### 실행

```bash
# 프로덕션
CUDA_VISIBLE_DEVICES=2,5 ./start.sh

# 개발 (HMR)
CUDA_VISIBLE_DEVICES=2,5 ./start_dev.sh
```

접속: http://localhost:8000  
기본 관리자 계정: `kevin` / `REDACTED`

## 프로젝트 구조

```
ev-auto-annotation/
├── backend/
│   ├── main.py          # FastAPI 앱, 서버 초기화
│   ├── database.py      # SQLAlchemy ORM 모델
│   ├── inference.py     # YOLO + SAM2 + GDINO 추론 엔진
│   └── routers/         # auth / projects / images / annotations / jobs / models
├── frontend/
│   └── src/
│       ├── pages/       # Login / Projects / Annotator / Training / Admin
│       ├── store/       # Zustand 상태 관리
│       └── api/         # FastAPI 클라이언트
├── scripts/
│   ├── generate_cctv_fire_data.py   # Copy-Paste 합성 데이터 생성기
│   ├── train_fire_smoke.py          # YOLO 파인튜닝 스크립트
│   ├── train_fire_smoke.sh          # SLURM 배치 스크립트
│   └── migrate_to_pg.py            # SQLite → PostgreSQL 마이그레이션
├── datasets/                        # data.yaml 파일만 (이미지 제외)
├── docs/
│   ├── 기술설명서.md
│   └── 화재연기_트러블슈팅.md
├── start.sh
├── start_dev.sh
└── requirements.txt
```

## 문서

- [기술 설명서](docs/기술설명서.md) — 전체 아키텍처, API 목록, ML 파이프라인 상세
- [화재/연기 탐지 트러블슈팅](docs/화재연기_트러블슈팅.md) — YOLO 파인튜닝 → GDINO → SAM2 Video Tracking까지 개발 과정

## 라이선스

Private repository — All rights reserved.
