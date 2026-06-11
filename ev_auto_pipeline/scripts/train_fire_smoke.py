"""
불/연기 YOLO Detection 파인튜닝 스크립트
=========================================

[Roboflow 데이터셋 다운로드 방법]
1. https://universe.roboflow.com 접속
2. "fire smoke detection" 검색 → 이미지 수 많은 것 선택 (추천: "Fire-Smoke-Detection" by various)
   - 예: "Fire Detection" (4,199 images), "fire-smoke" (D-Fire 계열) 등
   - 여러 개 합쳐도 됨
3. [Download Dataset] → Format: YOLOv8 (YOLO11과 호환) → [download zip to computer]
4. 다운받은 zip을 이 서버로 업로드 후 아래 경로에 압축 해제:
   /home1/junlee/ev_auto_pipeline/datasets/fire_smoke/

압축 해제 후 구조:
   datasets/fire_smoke/
   ├── train/images/, train/labels/
   ├── valid/images/, valid/labels/
   └── data.yaml

[실행 방법]
   python train_fire_smoke.py                        # 기본 실행
   python train_fire_smoke.py --data datasets/fire_smoke/data.yaml
   python train_fire_smoke.py --epochs 100 --batch 16
   python train_fire_smoke.py --no-register          # DB 등록 건너뛰기
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent

# Slurm 환경이면 CUDA_VISIBLE_DEVICES는 srun이 자동 설정하므로 건드리지 않음
if "SLURM_JOB_ID" not in os.environ:
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "3")


def parse_args():
    p = argparse.ArgumentParser(description="Fire/Smoke YOLO Detection 파인튜닝")
    p.add_argument("--data", default="datasets/fire_smoke/data.yaml",
                   help="data.yaml 경로 (기본: datasets/fire_smoke/data.yaml)")
    p.add_argument("--base-weights", default="yolo11x.pt",
                   help="베이스 가중치 (기본: yolo11x.pt 최대 크기, 없으면 자동 다운로드)")
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--freeze", type=int, default=10, help="백본 freeze 레이어 수")
    p.add_argument("--model-name", default="",
                   help="DB 등록 모델 이름 (기본: fire_smoke_YYYYMMDD)")
    p.add_argument("--no-register", action="store_true",
                   help="학습 후 DB 등록 건너뛰기")
    # Slurm 환경이면 device=0 (할당된 GPU의 로컬 인덱스), 아니면 3
    default_device = "0" if "SLURM_JOB_ID" in os.environ else "3"
    p.add_argument("--device", default=default_device, help="GPU 번호 (Slurm 환경에서는 0 고정)")
    return p.parse_args()


def check_dataset(data_yaml: Path):
    if not data_yaml.exists():
        print(f"\n[오류] data.yaml을 찾을 수 없습니다: {data_yaml}")
        print("\nRoboflow에서 데이터셋을 다운로드하고 압축을 해제하세요:")
        print(f"  mkdir -p {data_yaml.parent}")
        print(f"  # zip 파일을 {data_yaml.parent}/ 에 압축 해제")
        sys.exit(1)

    import yaml
    with open(data_yaml) as f:
        cfg = yaml.safe_load(f)

    nc = cfg.get("nc", 0)
    names = cfg.get("names", [])
    print(f"[데이터셋] 클래스 {nc}개: {names}")

    # 이미지 수 카운트
    data_root = data_yaml.parent
    for split in ("train", "valid", "test"):
        img_dir = data_root / split / "images"
        if img_dir.exists():
            n = len(list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")))
            print(f"  {split}: {n}장")

    return cfg


def train(args):
    data_yaml = BASE_DIR / args.data
    check_dataset(data_yaml)

    from ultralytics import YOLO

    base = BASE_DIR / args.base_weights
    if not base.exists():
        # 로컬에 없으면 ultralytics가 자동 다운로드
        print(f"[정보] {base} 없음 → {args.base_weights} 자동 다운로드")
        base = args.base_weights
    else:
        base = str(base)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    save_name = f"fire_smoke_{timestamp}"

    print(f"\n[학습 시작]")
    print(f"  베이스: {base}")
    print(f"  데이터: {data_yaml}")
    print(f"  GPU: {args.device} / epochs: {args.epochs} / batch: {args.batch}")
    print(f"  저장: {BASE_DIR}/models/{save_name}\n")

    model = YOLO(base)
    results = model.train(
        data=str(data_yaml),
        task="detect",
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        freeze=args.freeze,
        lr0=0.0005,
        device=int(args.device),
        project=str(BASE_DIR / "models"),
        name=save_name,
        exist_ok=True,
        patience=20,
        plots=False,
        verbose=True,
    )

    best_pt = BASE_DIR / "models" / save_name / "weights" / "best.pt"
    if not best_pt.exists():
        print(f"[오류] best.pt 생성 실패: {best_pt}")
        sys.exit(1)

    print(f"\n[완료] 모델 저장: {best_pt}")
    return best_pt, save_name, results


def register_in_db(best_pt: Path, model_name: str, data_cfg: dict):
    """학습된 모델을 annotation DB에 등록."""
    # DB 연결은 백엔드 패키지 직접 임포트
    sys.path.insert(0, str(BASE_DIR))
    os.environ.setdefault(
        "DATABASE_URL",
        "postgresql://evuser:REDACTED@localhost:5432/annotation"
    )

    try:
        from backend.database import SessionLocal, ModelVersion
        db = SessionLocal()
        try:
            names = data_cfg.get("names", [])
            nc = data_cfg.get("nc", len(names))
            desc = f"Fire/Smoke detection — {nc}클래스 {names}, bbox-only"

            mv = ModelVersion(
                name=model_name,
                weights_path=str(best_pt),
                description=desc,
                is_base=False,
                task="detect",
            )
            db.add(mv)
            db.commit()
            db.refresh(mv)
            print(f"[DB 등록 완료] 모델 ID: {mv.id}  이름: {mv.name}")
            print(f"  → 웹 UI에서 모델 드롭다운에 즉시 표시됩니다.")
        finally:
            db.close()
    except Exception as e:
        print(f"[DB 등록 실패] {e}")
        print(f"  수동 등록: 웹 UI 파인튜닝 메뉴 또는 직접 DB INSERT")


if __name__ == "__main__":
    args = parse_args()
    os.environ["CUDA_VISIBLE_DEVICES"] = args.device

    best_pt, save_name, results = train(args)

    model_name = args.model_name or f"fire_smoke_{datetime.now().strftime('%Y%m%d')}"

    if not args.no_register:
        import yaml
        with open(BASE_DIR / args.data) as f:
            data_cfg = yaml.safe_load(f)
        register_in_db(best_pt, model_name, data_cfg)
    else:
        print(f"\n[DB 등록 건너뜀] 수동 등록 시 weights 경로: {best_pt}")
