"""
모델 버전 관리 + 파인튜닝.
파인튜닝: 현재 프로젝트의 어노테이션 + 기존 학습 데이터 샘플 → 새 가중치 생성
"""
import json
import os
import random
import shutil
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal, ModelVersion, Project, Image, Annotation, Label

router = APIRouter(tags=["models"])

BASE_DIR = Path(__file__).parent.parent.parent
MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)
DATASETS_DIR = BASE_DIR / "datasets_saved"
DATASETS_DIR.mkdir(exist_ok=True)

ORIGINAL_DATASET = BASE_DIR / "dataset"
ORIGINAL_WEIGHTS = str(BASE_DIR / "runs/yolo11m_ev/weights/best.pt")

# 파인튜닝 진행상황 {job_id: {...}}
_ft_jobs: dict[str, dict] = {}
_ft_ws: dict[str, list[WebSocket]] = {}


# ── 저장된 데이터셋 (스냅샷) ──────────────────────────────────────────────────

@router.get("/api/datasets")
def list_datasets():
    snaps = []
    for f in sorted(DATASETS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            keys = ("id", "project_name", "label_names", "image_count", "created_at")
            snap = {k: d[k] for k in keys}
            if "source" in d:
                snap["source"] = d["source"]
            snaps.append(snap)
        except Exception:
            pass
    return snaps


@router.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    f = DATASETS_DIR / f"{dataset_id}.json"
    if not f.exists():
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    ext_dir = DATASETS_DIR / f"ext_{dataset_id}"
    if ext_dir.exists():
        shutil.rmtree(ext_dir)
    f.unlink()
    return {"ok": True}


@router.post("/api/datasets/upload")
async def upload_external_dataset(file: UploadFile = File(...)):
    """외부 YOLO ZIP(Roboflow 등) → datasets_saved 스냅샷으로 변환"""
    import io as _io, zipfile as _zf, yaml as _yaml

    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(400, "ZIP 파일만 업로드 가능합니다.")

    snap_id = str(uuid.uuid4())[:8]
    ext_dir = DATASETS_DIR / f"ext_{snap_id}"
    ext_dir.mkdir(parents=True, exist_ok=True)

    try:
        content = await file.read()
        with _zf.ZipFile(_io.BytesIO(content)) as zf:
            zf.extractall(ext_dir)

        # data.yaml 탐색
        yaml_files = list(ext_dir.rglob("data.yaml"))
        if not yaml_files:
            raise HTTPException(400, "data.yaml이 없습니다. YOLO 형식 ZIP인지 확인하세요.")

        yaml_path = min(yaml_files, key=lambda p: len(p.parts))  # 가장 얕은 위치
        root_dir = yaml_path.parent

        meta = _yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        names = meta.get("names", [])
        if isinstance(names, dict):
            names = [names[i] for i in sorted(names.keys())]

        # 이미지+라벨 수집 (train / valid / val / test 모두)
        img_data = []
        seen = set()

        for split in ("train", "valid", "val", "test"):
            for img_dir in [
                root_dir / split / "images",
                root_dir / "images" / split,
            ]:
                if not img_dir.exists():
                    continue
                for img_path in sorted(img_dir.iterdir()):
                    if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
                        continue
                    if str(img_path) in seen:
                        continue
                    seen.add(str(img_path))

                    lbl_path = img_path.parent.parent / "labels" / (img_path.stem + ".txt")
                    if not lbl_path.exists():
                        continue

                    anns = []
                    for line in lbl_path.read_text(encoding="utf-8").splitlines():
                        parts = line.strip().split()
                        if len(parts) < 5:
                            continue
                        cls = int(parts[0])
                        coords = [float(v) for v in parts[1:]]
                        if len(coords) == 4:
                            # YOLO detect: cx cy w h → 사각형 polygon
                            cx, cy, w, h = coords
                            x1, y1 = cx - w / 2, cy - h / 2
                            x2, y2 = cx + w / 2, cy + h / 2
                            poly = [x1, y1, x2, y1, x2, y2, x1, y2]
                        else:
                            # YOLO seg: 이미 polygon
                            poly = coords
                        anns.append({"class_index": cls, "polygon": poly})

                    if anns:
                        img_data.append({
                            "rel_path": str(img_path),
                            "filename": img_path.name,
                            "annotations": anns,
                        })

        if not img_data:
            raise HTTPException(400, "어노테이션된 이미지가 없습니다.")

        snapshot = {
            "id": snap_id,
            "project_name": (file.filename or "external").replace(".zip", ""),
            "label_names": names,
            "image_count": len(img_data),
            "created_at": datetime.now().isoformat(),
            "img_data": img_data,
            "source": "external",
        }
        (DATASETS_DIR / f"{snap_id}.json").write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
        )
        return {"id": snap_id, "image_count": len(img_data), "label_names": names}

    except HTTPException:
        shutil.rmtree(ext_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(ext_dir, ignore_errors=True)
        raise HTTPException(500, f"데이터셋 처리 오류: {e}")


# ── 조회 ──────────────────────────────────────────────────────────────────────

@router.get("/api/models")
def list_models(db: Session = Depends(get_db)):
    models = db.query(ModelVersion).order_by(ModelVersion.created_at).all()
    return [_serialize(m) for m in models]


@router.delete("/api/models/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    m = db.query(ModelVersion).filter(ModelVersion.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="모델을 찾을 수 없습니다.")
    if m.is_base:
        raise HTTPException(status_code=400, detail="기본 모델은 삭제할 수 없습니다.")
    # weights 파일 삭제
    try:
        weights = Path(m.weights_path)
        if weights.exists():
            shutil.rmtree(weights.parent.parent, ignore_errors=True)
    except Exception:
        pass
    db.delete(m)
    db.commit()
    return {"ok": True}


# ── 파인튜닝 시작 ──────────────────────────────────────────────────────────────

class FinetuneCreate(BaseModel):
    project_id: int
    model_name: str
    base_model_id: Optional[int] = None   # None → 기본 모델 사용
    replay_count: int = 300               # 기존 데이터 샘플 수
    epochs: int = 50
    freeze: int = 10                      # 백본 레이어 freeze 수
    task: str = "segment"                 # "segment" | "detect"


@router.post("/api/models/finetune")
def start_finetune(body: FinetuneCreate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == body.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    # 어노테이션된 이미지 수집
    images = db.query(Image).filter(
        Image.project_id == body.project_id,
        Image.status.in_(["annotated", "done"]),
    ).all()
    if len(images) < 3:
        raise HTTPException(status_code=400, detail="파인튜닝에는 어노테이션된 이미지가 최소 3장 필요합니다.")

    # 기본 가중치 결정
    if body.base_model_id:
        base_mv = db.query(ModelVersion).filter(ModelVersion.id == body.base_model_id).first()
        if not base_mv:
            raise HTTPException(status_code=404, detail="베이스 모델을 찾을 수 없습니다.")
        base_weights = base_mv.weights_path
    else:
        base_weights = ORIGINAL_WEIGHTS

    # 라벨 매핑
    labels = {l.id: l.class_index for l in project.labels}
    sorted_labels = sorted(project.labels, key=lambda l: l.class_index)
    label_names = [l.name for l in sorted_labels]

    # 어노테이션 데이터 직렬화 (DB 세션 밖으로)
    img_data = []
    for img in images:
        anns = db.query(Annotation).filter(
            Annotation.image_id == img.id,
            Annotation.needs_review == False,
        ).all()
        if not anns:
            continue
        img_data.append({
            "rel_path": img.rel_path,
            "filename": img.filename,
            "annotations": [
                {"class_index": labels.get(a.label_id, 0), "polygon": json.loads(a.polygon)}
                for a in anns
            ],
        })

    job_id = str(uuid.uuid4())
    _ft_jobs[job_id] = {
        "status": "running",
        "progress": 0,
        "total": body.epochs,
        "model_id": None,
        "error": None,
    }
    _ft_ws[job_id] = []

    thread = threading.Thread(
        target=_run_finetune,
        args=(job_id, body.model_name, base_weights, img_data,
              label_names, body.replay_count, body.epochs, body.freeze, body.task),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "new_image_count": len(img_data)}


class FinetuneFromDatasets(BaseModel):
    dataset_ids: list[str]
    model_name: str
    base_model_id: Optional[int] = None
    epochs: int = 50
    task: str = "detect"


@router.post("/api/models/finetune-from-datasets")
def start_finetune_from_datasets(body: FinetuneFromDatasets, db: Session = Depends(get_db)):
    if not body.dataset_ids:
        raise HTTPException(status_code=400, detail="데이터셋을 하나 이상 선택하세요.")

    # 선택된 스냅샷 로드 + 병합
    img_data, label_names = [], []
    for ds_id in body.dataset_ids:
        f = DATASETS_DIR / f"{ds_id}.json"
        if not f.exists():
            raise HTTPException(status_code=404, detail=f"데이터셋 {ds_id}를 찾을 수 없습니다.")
        snap = json.loads(f.read_text(encoding="utf-8"))
        img_data.extend(snap.get("img_data", []))
        if not label_names:
            label_names = snap.get("label_names", [])

    if len(img_data) < 3:
        raise HTTPException(status_code=400, detail="파인튜닝에는 어노테이션된 이미지가 최소 3장 필요합니다.")

    if body.base_model_id:
        base_mv = db.query(ModelVersion).filter(ModelVersion.id == body.base_model_id).first()
        base_weights = base_mv.weights_path if base_mv else ORIGINAL_WEIGHTS
    else:
        base_weights = ORIGINAL_WEIGHTS

    job_id = str(uuid.uuid4())
    _ft_jobs[job_id] = {"status": "running", "progress": 0, "total": body.epochs, "model_id": None, "error": None}
    _ft_ws[job_id] = []

    thread = threading.Thread(
        target=_run_finetune,
        args=(job_id, body.model_name, base_weights, img_data, label_names, 0, body.epochs, 0, body.task),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "total_images": len(img_data)}


@router.get("/api/models/finetune/{job_id}")
def get_finetune_job(job_id: str):
    job = _ft_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    return job


@router.websocket("/ws/finetune/{job_id}")
async def finetune_ws(websocket: WebSocket, job_id: str):
    await websocket.accept()
    job = _ft_jobs.get(job_id)
    if not job:
        await websocket.close(code=4004)
        return
    _ft_ws.setdefault(job_id, []).append(websocket)
    try:
        await websocket.send_json(_ft_jobs[job_id])
        import asyncio
        while True:
            await asyncio.sleep(1)
            state = _ft_jobs.get(job_id)
            if state is None:
                break
            await websocket.send_json(state)
            if state["status"] in ("done", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        clients = _ft_ws.get(job_id, [])
        if websocket in clients:
            clients.remove(websocket)


# ── 파인튜닝 실행 (백그라운드) ─────────────────────────────────────────────────

def _run_finetune(
    job_id: str,
    model_name: str,
    base_weights: str,
    img_data: list,
    label_names: list,
    replay_count: int,
    epochs: int,
    freeze: int,
    task: str = "segment",
):
    tmp_dir = Path(tempfile.mkdtemp(prefix="ev_ft_"))
    try:
        # 1. 디렉토리 구성
        new_img_dir = tmp_dir / "images" / "train"
        new_lbl_dir = tmp_dir / "labels" / "train"
        new_img_dir.mkdir(parents=True)
        new_lbl_dir.mkdir(parents=True)

        # 2. 신규 어노테이션 이미지 복사
        for item in img_data:
            src = Path(item["rel_path"])
            if not src.exists():
                continue
            dst = new_img_dir / item["filename"]
            shutil.copy2(src, dst)
            lines = []
            for ann in item["annotations"]:
                poly = ann["polygon"]
                if task == "detect":
                    # bbox 포맷: cx cy w h (normalized)
                    if len(poly) < 4:
                        continue
                    xs = poly[0::2]; ys = poly[1::2]
                    cx = (min(xs) + max(xs)) / 2
                    cy = (min(ys) + max(ys)) / 2
                    w = max(xs) - min(xs)
                    h = max(ys) - min(ys)
                    lines.append(f"{ann['class_index']} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
                else:
                    # seg 포맷: 폴리곤 좌표 나열
                    if len(poly) < 6:
                        continue
                    coords = " ".join(f"{v:.6f}" for v in poly)
                    lines.append(f"{ann['class_index']} {coords}")
            if lines:
                lbl_path = new_lbl_dir / (Path(item["filename"]).stem + ".txt")
                lbl_path.write_text("\n".join(lines))

        # 3. 기존 데이터 replay 샘플링 (클래스 비율 유지: dog 50% 보장)
        orig_img_dir = ORIGINAL_DATASET / "images" / "train"
        orig_lbl_dir = ORIGINAL_DATASET / "labels" / "train"
        if orig_img_dir.exists() and orig_lbl_dir.exists():
            all_orig = [p for p in orig_img_dir.iterdir()
                        if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
            dog_orig, other_orig = [], []
            for img_p in all_orig:
                lbl_p = orig_lbl_dir / (img_p.stem + ".txt")
                if not lbl_p.exists():
                    continue
                try:
                    classes = {line.split()[0] for line in lbl_p.read_text().splitlines() if line.strip()}
                except Exception:
                    classes = set()
                (dog_orig if "1" in classes else other_orig).append(img_p)

            n_dog = min(replay_count // 2, len(dog_orig))
            n_other = min(replay_count - n_dog, len(other_orig))
            sample = random.sample(dog_orig, n_dog) + random.sample(other_orig, n_other)
            for img_p in sample:
                lbl_p = orig_lbl_dir / (img_p.stem + ".txt")
                shutil.copy2(img_p, new_img_dir / img_p.name)
                shutil.copy2(lbl_p, new_lbl_dir / lbl_p.name)

        # 4. data.yaml 생성
        nc = len(label_names)
        yaml_content = (
            f"path: {tmp_dir}\n"
            f"train: images/train\n"
            f"val: images/train\n\n"
            f"task: {task}\n"
            f"nc: {nc}\n"
            f"names: {label_names}\n"
        )
        yaml_path = tmp_dir / "data.yaml"
        yaml_path.write_text(yaml_content)

        # 5. 파인튜닝 실행
        from ultralytics import YOLO

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_name = f"finetune_{timestamp}"

        model = YOLO(base_weights)

        def on_epoch_end(trainer):
            _ft_jobs[job_id]["progress"] = trainer.epoch + 1

        model.add_callback("on_train_epoch_end", on_epoch_end)

        model.train(
            data=str(yaml_path),
            epochs=epochs,
            lr0=0.0001,
            freeze=freeze,
            imgsz=640,
            batch=8,
            device=3,           # 추론용 GPU(2)와 분리
            project=str(MODELS_DIR),
            name=save_name,
            exist_ok=True,
            val=False,
            plots=False,
            patience=15,
            verbose=False,
        )

        best_pt = MODELS_DIR / save_name / "weights" / "best.pt"
        if not best_pt.exists():
            raise FileNotFoundError(f"학습 결과 파일 없음: {best_pt}")

        # 6. DB에 새 모델 버전 등록
        db = SessionLocal()
        try:
            mv = ModelVersion(
                name=model_name,
                weights_path=str(best_pt),
                description=f"신규 {len(img_data)}장 + replay {replay_count}장, {epochs}epoch",
                is_base=False,
                task=task,
            )
            db.add(mv)
            db.commit()
            db.refresh(mv)
            _ft_jobs[job_id]["model_id"] = mv.id
            _ft_jobs[job_id]["status"] = "done"
        finally:
            db.close()

    except Exception as e:
        _ft_jobs[job_id]["status"] = "error"
        _ft_jobs[job_id]["error"] = str(e)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _serialize(m: ModelVersion) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "weights_path": m.weights_path,
        "description": m.description,
        "is_base": m.is_base,
        "task": m.task or "segment",
        "created_at": m.created_at.isoformat(),
    }


def ensure_base_model(db: Session):
    """서버 시작 시 기본 모델 + 공식 pretrained 모델이 DB에 없으면 등록."""
    existing = db.query(ModelVersion).filter(ModelVersion.is_base == True).first()
    if not existing:
        db.add(ModelVersion(
            name="기본 모델 (yolo11m_ev)",
            weights_path=ORIGINAL_WEIGHTS,
            description="최초 학습 모델",
            is_base=True,
            task="segment",
        ))
        db.commit()

    # Ultralytics 공식 pretrained 모델 시드 (없을 때만)
    _pretrained_seed = [
        ("yolo11l.pt (공식 pretrained)", "yolo11l.pt", "detect"),
        ("yolo11l-seg.pt (공식 pretrained)", "yolo11l-seg.pt", "segment"),
    ]
    existing_paths = {m.weights_path for m in db.query(ModelVersion).all()}
    added = False
    for name, wp, task in _pretrained_seed:
        if wp not in existing_paths:
            db.add(ModelVersion(name=name, weights_path=wp, task=task, is_base=False))
            added = True
    if added:
        db.commit()
