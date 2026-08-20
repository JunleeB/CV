import json
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal, Project, Label, Image, User
from backend.routers.auth import get_current_user_optional

router = APIRouter(prefix="/api/projects", tags=["projects"])

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


class LabelIn(BaseModel):
    name: str
    color: str = "#6366f1"
    class_index: int


class ProjectCreate(BaseModel):
    name: str
    source_path: Optional[str] = None
    conf_threshold: float = 0.7
    labels: list[LabelIn] = []
    roi: Optional[list[float]] = None


class RoiUpdate(BaseModel):
    roi: Optional[list[float]] = None


_EXCLUDE_PREFIXES = ("SYNOFILE", "@", "._", ".thumb", "thumb_")
_EXCLUDE_DIRS = {"@eaDir", "@tmp", "@sharebin", "labels", ".git"}


def _is_valid_image(path: Path) -> bool:
    name = path.name
    if name.upper().startswith(tuple(p.upper() for p in _EXCLUDE_PREFIXES)):
        return False
    if name.startswith("."):
        return False
    # skip images inside excluded dirs
    for part in path.parts:
        if part in _EXCLUDE_DIRS:
            return False
    return True


def _scan_images(project: Project, source_path: str, db: Session):
    src = Path(source_path)
    if not src.exists():
        raise HTTPException(status_code=400, detail=f"경로를 찾을 수 없습니다: {source_path}")
    all_images = []
    for ext in ("*.jpg", "*.JPG", "*.jpeg", "*.png", "*.PNG"):
        all_images.extend(src.rglob(ext))
    images = sorted(p for p in all_images if _is_valid_image(p))
    for img_path in images:
        db.add(Image(
            project_id=project.id,
            filename=img_path.name,
            rel_path=str(img_path),
            status="pending",
        ))
    db.commit()
    return len(images)


@router.get("")
def list_projects(
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    # admin → 전체 프로젝트, 일반 사용자 → 본인 프로젝트만
    q = db.query(Project).order_by(Project.created_at.desc())
    if current_user and current_user.role != "admin":
        q = q.filter(Project.created_by == current_user.id)

    result = []
    for p in q.all():
        total = len(p.images)
        annotated = sum(1 for i in p.images if i.status in ("annotated", "done"))
        review = sum(1 for i in p.images if i.status == "review")
        # 소유자 이름 조회
        owner = db.query(User).filter(User.id == p.created_by).first() if p.created_by else None
        result.append({
            "id": p.id,
            "name": p.name,
            "source_path": p.source_path,
            "conf_threshold": p.conf_threshold,
            "roi": json.loads(p.roi) if p.roi else None,
            "model_id": p.model_id,
            "created_at": p.created_at.isoformat(),
            "image_count": total,
            "annotated_count": annotated,
            "review_count": review,
            "owner": owner.display_name if owner else None,
            "labels": [{"id": l.id, "name": l.name, "color": l.color, "class_index": l.class_index} for l in p.labels],
        })
    return result


@router.post("")
def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    project = Project(
        name=data.name,
        source_path=data.source_path,
        conf_threshold=data.conf_threshold,
        roi=json.dumps(data.roi) if data.roi else None,
        created_by=current_user.id if current_user else None,
    )
    db.add(project)
    db.flush()
    for lbl in data.labels:
        db.add(Label(project_id=project.id, name=lbl.name, color=lbl.color, class_index=lbl.class_index))
    db.commit()
    db.refresh(project)

    image_count = 0
    if data.source_path:
        image_count = _scan_images(project, data.source_path, db)

    return {
        "id": project.id,
        "name": project.name,
        "image_count": image_count,
        "labels": [{"id": l.id, "name": l.name, "color": l.color, "class_index": l.class_index} for l in project.labels],
    }


@router.post("/{project_id}/upload-images")
async def upload_images(project_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    """이미지 파일(JPG/PNG)을 직접 업로드합니다."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    dest = UPLOAD_DIR / str(project_id) / "images"
    dest.mkdir(parents=True, exist_ok=True)

    saved = 0
    for upload in files:
        name = upload.filename or "image.jpg"
        ext = Path(name).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png"}:
            continue
        # Avoid duplicate filenames
        target = dest / name
        stem, suffix = Path(name).stem, Path(name).suffix
        counter = 1
        while target.exists():
            target = dest / f"{stem}_{counter}{suffix}"
            counter += 1
        with open(target, "wb") as f:
            f.write(await upload.read())
        # Register in DB if not already present
        exists = db.query(Image).filter(Image.rel_path == str(target)).first()
        if not exists:
            db.add(Image(project_id=project_id, filename=target.name, rel_path=str(target), status="pending"))
            saved += 1

    if not project.source_path:
        project.source_path = str(dest)
    db.commit()
    return {"uploaded": saved}


@router.post("/{project_id}/upload")
async def upload_folder(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    dest = UPLOAD_DIR / str(project_id)
    dest.mkdir(exist_ok=True)
    zip_path = dest / file.filename

    with open(zip_path, "wb") as f:
        f.write(await file.read())

    extract_dir = dest / "images"
    extract_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_dir)
    zip_path.unlink()

    project.source_path = str(extract_dir)
    db.commit()
    image_count = _scan_images(project, str(extract_dir), db)

    return {"image_count": image_count}


def _frame_prefix(project_name: str) -> str:
    """프로젝트 이름을 파일명으로 쓸 수 있게 정리 (경로 구분자 등 파일명에 쓸 수 없는 문자만 치환)."""
    safe = re.sub(r"[^\w.-]+", "_", project_name.strip())
    safe = safe.strip("_.")
    return safe or "frame"


def _ts_to_sec(t: str) -> float:
    parts = t.strip().split(":")
    s = 0.0
    for p in parts:
        s = s * 60 + float(p)
    return s


def _build_ffmpeg_cmd(tmp_path: str, dest_pattern: str, start_time: str, end_time: str, fps: float) -> list[str]:
    """GPU(cuvid) 가속 우선, 실패 시 CPU fallback."""
    def base(hwaccel: bool) -> list[str]:
        cmd = ["ffmpeg", "-y"]
        if hwaccel:
            cmd += ["-hwaccel", "cuda"]
        if start_time:
            cmd += ["-ss", start_time]
        cmd += ["-i", tmp_path]
        if end_time:
            if start_time:
                dur = _ts_to_sec(end_time) - _ts_to_sec(start_time)
                if dur > 0:
                    cmd += ["-t", str(dur)]
            else:
                cmd += ["-to", end_time]
        cmd += ["-vf", f"fps={fps}", "-threads", "0", "-q:v", "2",
                dest_pattern, "-hide_banner", "-loglevel", "error"]
        return cmd

    # GPU 가속 테스트 (짧은 probe)
    probe = subprocess.run(
        ["ffmpeg", "-y", "-hwaccel", "cuda", "-i", tmp_path,
         "-vframes", "1", "-f", "null", "-", "-hide_banner", "-loglevel", "error"],
        capture_output=True,
    )
    return base(hwaccel=(probe.returncode == 0))


def _run_video_extraction(project_id: int, tmp_path: str, dest: Path, prefix: str,
                          start_time: str, end_time: str, fps: float, next_num: int):
    """백그라운드 스레드에서 ffmpeg 실행 후 DB 등록."""
    try:
        out_pattern = str(dest / f"{prefix}_{next_num:06d}_%04d.jpg")
        cmd = _build_ffmpeg_cmd(tmp_path, out_pattern, start_time, end_time, fps)
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return  # 실패 시 조용히 종료 (이미 프로젝트는 생성됨)

        new_frames = sorted(dest.glob(f"{prefix}_{next_num:06d}_*.jpg"))
        db = SessionLocal()
        try:
            project = db.query(Project).filter(Project.id == project_id).first()
            for frame_path in new_frames:
                exists = db.query(Image).filter(Image.rel_path == str(frame_path)).first()
                if not exists:
                    db.add(Image(project_id=project_id, filename=frame_path.name,
                                 rel_path=str(frame_path), status="pending"))
            if project and not project.source_path:
                project.source_path = str(dest)
            db.commit()
        finally:
            db.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.post("/{project_id}/upload-video")
async def upload_video(
    project_id: int,
    file: UploadFile = File(...),
    start_time: str = Form(""),
    end_time: str = Form(""),
    fps: float = Form(2.0),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".mp4", ".avi", ".mov", ".mkv", ".webm", ".ts"}:
        raise HTTPException(status_code=400, detail="지원하지 않는 동영상 형식입니다.")

    dest = UPLOAD_DIR / str(project_id) / "images"
    dest.mkdir(parents=True, exist_ok=True)

    # 파일 저장 (이것만 동기, 이후 ffmpeg는 백그라운드)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    prefix = _frame_prefix(project.name)
    existing = sorted(dest.glob(f"{prefix}_*.jpg"))
    next_num = 0
    if existing:
        nums = []
        for p in existing:
            m = re.match(rf"^{re.escape(prefix)}_(\d+)_\d+$", p.stem)
            if m:
                nums.append(int(m.group(1)))
        next_num = (max(nums) + 1) if nums else len(existing)

    # 백그라운드 스레드 시작 — 즉시 응답 반환
    t = threading.Thread(
        target=_run_video_extraction,
        args=(project_id, tmp_path, dest, prefix, start_time, end_time, fps, next_num),
        daemon=True,
    )
    t.start()

    return {"status": "processing", "message": "프레임 추출 중입니다. 잠시 후 새로고침하세요."}


@router.get("/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    total = len(project.images)
    annotated = sum(1 for i in project.images if i.status in ("annotated", "done"))
    review = sum(1 for i in project.images if i.status == "review")
    pending = sum(1 for i in project.images if i.status == "pending")
    return {
        "id": project.id,
        "name": project.name,
        "source_path": project.source_path,
        "conf_threshold": project.conf_threshold,
        "roi": json.loads(project.roi) if project.roi else None,
        "model_id": project.model_id,
        "created_at": project.created_at.isoformat(),
        "image_count": total,
        "annotated_count": annotated,
        "review_count": review,
        "pending_count": pending,
        "labels": [{"id": l.id, "name": l.name, "color": l.color, "class_index": l.class_index} for l in project.labels],
    }


class ProjectRename(BaseModel):
    name: str


@router.patch("/{project_id}/name")
def rename_project(project_id: int, body: ProjectRename, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="프로젝트 이름을 입력해주세요.")
    project.name = name
    db.commit()
    return {"ok": True, "name": project.name}


class ModelSelect(BaseModel):
    model_id: Optional[int] = None


@router.patch("/{project_id}/model")
def set_project_model(project_id: int, body: ModelSelect, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    project.model_id = body.model_id
    db.commit()
    return {"ok": True}


@router.patch("/{project_id}/roi")
def update_roi(project_id: int, body: RoiUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    project.roi = json.dumps(body.roi) if body.roi else None
    db.commit()
    return {"ok": True}


@router.post("/{project_id}/rescan")
def rescan_images(project_id: int, db: Session = Depends(get_db)):
    """기존 이미지 목록을 비우고 source_path를 다시 스캔합니다."""
    from backend.database import Annotation
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if not project.source_path:
        raise HTTPException(status_code=400, detail="source_path가 설정되지 않았습니다.")
    # delete existing images (annotations cascade)
    existing = db.query(Image).filter(Image.project_id == project_id).all()
    for img in existing:
        db.query(Annotation).filter(Annotation.image_id == img.id).delete()
    db.query(Image).filter(Image.project_id == project_id).delete()
    db.commit()
    count = _scan_images(project, project.source_path, db)
    return {"image_count": count}


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/review")
def get_review_queue(project_id: int, db: Session = Depends(get_db)):
    images = db.query(Image).filter(
        Image.project_id == project_id,
        Image.status == "review",
    ).all()
    return [{"id": i.id, "filename": i.filename, "rel_path": i.rel_path, "status": i.status} for i in images]


def _get_image_size(rel_path: str):
    """이미지 파일에서 width, height 읽기."""
    try:
        import cv2
        img = cv2.imread(rel_path)
        if img is not None:
            return img.shape[1], img.shape[0]
    except Exception:
        pass
    return None, None


def _write_yolo_meta(zf, project, image_paths: list, task: str = "detect", include_images: bool = False):
    """data.yaml + train.txt 생성
    include_images=True  : 상대경로 images/train/filename (이식 가능)
    include_images=False : 서버 절대경로, 바로 학습 가능
    """
    sorted_labels = sorted(project.labels, key=lambda x: x.class_index)
    names_block = "\n".join(f"  {l.class_index}: {l.name}" for l in sorted_labels)

    if include_images:
        yaml_content = f"names:\n{names_block}\npath: .\ntrain: train.txt\n"
        train_lines = [f"images/train/{Path(p).name}" for p in image_paths]
    else:
        yaml_content = (
            f"names:\n{names_block}\n"
            f"path: /\n"
            f"nc: {len(sorted_labels)}\n"
            f"train: train.txt\n"
        )
        train_lines = list(image_paths)

    zf.writestr("data.yaml", yaml_content)
    zf.writestr("train.txt", "\n".join(train_lines))


def _poly_to_bbox_norm(poly: list[float]):
    """정규화 폴리곤 → 정규화 bbox (cx, cy, w, h)"""
    xs = poly[0::2]
    ys = poly[1::2]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    return (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1


@router.post("/{project_id}/export")
def export_labels(project_id: int, format: str = "yolo_seg", include_images: bool = False, db: Session = Depends(get_db)):
    """
    include_images=false : 라벨만 (서버 절대경로) — 동일 서버에서 바로 학습
    include_images=true  : 이미지 + 라벨 (상대경로) — 다른 머신/서버에서도 사용 가능
    """
    import io, zipfile as zf_module, json as _json
    from fastapi.responses import StreamingResponse
    from datetime import datetime

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    label_map = {l.id: l for l in project.labels}
    buf = io.BytesIO()

    def _add_image_to_zip(zf, img):
        if not include_images:
            return
        src = Path(img.rel_path)
        if src.exists():
            zf.write(src, f"images/train/{img.filename}")

    with zf_module.ZipFile(buf, "w", zf_module.ZIP_DEFLATED) as zf:

        # ── YOLO Segmentation (Ultralytics) ─────────────────────────────────
        if format == "yolo_seg":
            annotated_imgs = []
            for img in project.images:
                if not img.annotations:
                    continue
                lines = []
                for ann in img.annotations:
                    poly = _json.loads(ann.polygon)
                    if len(poly) < 6:
                        continue
                    lbl = label_map.get(ann.label_id)
                    cls = lbl.class_index if lbl else 0
                    coords = " ".join(f"{v:.6f}" for v in poly)
                    lines.append(f"{cls} {coords}")
                if lines:
                    zf.writestr(f"labels/train/{Path(img.filename).stem}.txt", "\n".join(lines))
                    annotated_imgs.append(img.rel_path)
                    _add_image_to_zip(zf, img)
            _write_yolo_meta(zf, project, annotated_imgs, task="segment", include_images=include_images)

        # ── YOLO Detection (Ultralytics) ────────────────────────────────────
        elif format == "yolo_det":
            annotated_imgs = []
            for img in project.images:
                if not img.annotations:
                    continue
                lines = []
                for ann in img.annotations:
                    poly = _json.loads(ann.polygon)
                    if len(poly) < 6:
                        continue
                    lbl = label_map.get(ann.label_id)
                    cls = lbl.class_index if lbl else 0
                    cx, cy, w, h = _poly_to_bbox_norm(poly)
                    lines.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
                if lines:
                    zf.writestr(f"labels/train/{Path(img.filename).stem}.txt", "\n".join(lines))
                    annotated_imgs.append(img.rel_path)
                    _add_image_to_zip(zf, img)
            _write_yolo_meta(zf, project, annotated_imgs, task="detect", include_images=include_images)

        # ── COCO JSON ───────────────────────────────────────────────────────
        elif format == "coco":
            categories = [
                {"id": l.class_index + 1, "name": l.name, "supercategory": "object"}
                for l in sorted(project.labels, key=lambda x: x.class_index)
            ]
            coco_images, coco_anns = [], []
            ann_id = 1
            for img in project.images:
                if not img.annotations:
                    continue
                w_px, h_px = _get_image_size(img.rel_path)
                w_px = w_px or 1920
                h_px = h_px or 1080
                coco_images.append({"id": img.id, "file_name": img.filename, "width": w_px, "height": h_px})
                for ann in img.annotations:
                    poly_norm = _json.loads(ann.polygon)
                    if len(poly_norm) < 6:
                        continue
                    poly_px = [
                        poly_norm[i] * w_px if i % 2 == 0 else poly_norm[i] * h_px
                        for i in range(len(poly_norm))
                    ]
                    xs = poly_px[0::2]; ys = poly_px[1::2]
                    x1, y1, bw, bh = min(xs), min(ys), max(xs)-min(xs), max(ys)-min(ys)
                    lbl = label_map.get(ann.label_id)
                    cat_id = (lbl.class_index + 1) if lbl else 1
                    coco_anns.append({
                        "id": ann_id, "image_id": img.id, "category_id": cat_id,
                        "segmentation": [poly_px],
                        "bbox": [round(x1, 2), round(y1, 2), round(bw, 2), round(bh, 2)],
                        "area": round(bw * bh, 2), "iscrowd": 0,
                        "confidence": ann.confidence,
                    })
                    ann_id += 1
            coco_data = {
                "info": {"description": project.name, "date_created": datetime.utcnow().isoformat()},
                "licenses": [], "images": coco_images,
                "annotations": coco_anns, "categories": categories,
            }
            zf.writestr("annotations.json", _json.dumps(coco_data, ensure_ascii=False, indent=2))

        # ── Pascal VOC XML ──────────────────────────────────────────────────
        elif format == "voc":
            for img in project.images:
                if not img.annotations:
                    continue
                w_px, h_px = _get_image_size(img.rel_path)
                w_px = w_px or 1920; h_px = h_px or 1080
                objs = []
                for ann in img.annotations:
                    poly = _json.loads(ann.polygon)
                    if len(poly) < 6:
                        continue
                    lbl = label_map.get(ann.label_id)
                    name = lbl.name if lbl else "object"
                    xs = [poly[i] * w_px for i in range(0, len(poly), 2)]
                    ys = [poly[i] * h_px for i in range(1, len(poly), 2)]
                    objs.append(
                        f"  <object>\n"
                        f"    <name>{name}</name>\n"
                        f"    <pose>Unspecified</pose>\n"
                        f"    <truncated>0</truncated>\n"
                        f"    <difficult>0</difficult>\n"
                        f"    <bndbox>\n"
                        f"      <xmin>{int(min(xs))}</xmin>\n"
                        f"      <ymin>{int(min(ys))}</ymin>\n"
                        f"      <xmax>{int(max(xs))}</xmax>\n"
                        f"      <ymax>{int(max(ys))}</ymax>\n"
                        f"    </bndbox>\n"
                        f"  </object>"
                    )
                xml = (
                    f'<annotation>\n'
                    f'  <filename>{img.filename}</filename>\n'
                    f'  <size><width>{w_px}</width><height>{h_px}</height><depth>3</depth></size>\n'
                    + "\n".join(objs) +
                    f'\n</annotation>'
                )
                zf.writestr(f"annotations/{Path(img.filename).stem}.xml", xml)

        # ── CSV ─────────────────────────────────────────────────────────────
        elif format == "csv":
            rows = ["filename,label,class_index,polygon,confidence,is_auto"]
            for img in project.images:
                for ann in img.annotations:
                    lbl = label_map.get(ann.label_id)
                    poly_str = "|".join(f"{v:.6f}" for v in _json.loads(ann.polygon))
                    rows.append(
                        f"{img.filename},{lbl.name if lbl else ''},{lbl.class_index if lbl else ''},"
                        f"{poly_str},{ann.confidence or ''},{ann.is_auto}"
                    )
            zf.writestr("annotations.csv", "\n".join(rows))

        else:
            raise HTTPException(status_code=400, detail=f"지원하지 않는 포맷: {format}")

    # 서버사이드 학습용 스냅샷 저장 (polygon 포맷으로 항상 보존)
    try:
        _save_dataset_snapshot(project, db)
    except Exception:
        pass  # 스냅샷 저장 실패해도 다운로드는 정상 제공

    buf.seek(0)
    from urllib.parse import quote as _quote
    fmt_suffix = {"yolo_seg": "yolo_seg", "yolo_det": "yolo_det", "coco": "coco", "voc": "voc", "csv": "csv"}.get(format, format)
    img_suffix = "_with_images" if include_images and format in ("yolo_seg", "yolo_det") else ""
    filename = f"{project.name}_{fmt_suffix}{img_suffix}.zip"
    encoded = _quote(filename, safe="")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


def _save_dataset_snapshot(project, db):
    """Export 시 서버에 학습용 스냅샷 저장."""
    import uuid as _uuid
    from datetime import datetime as _dt
    BASE_DIR = Path(__file__).parent.parent.parent
    SNAP_DIR = BASE_DIR / "datasets_saved"
    SNAP_DIR.mkdir(exist_ok=True)

    label_map = {l.id: l for l in project.labels}
    sorted_labels = sorted(project.labels, key=lambda l: l.class_index)

    img_data = []
    for img in project.images:
        anns = [a for a in img.annotations if not a.needs_review]
        if not anns:
            continue
        ann_list = []
        for a in anns:
            poly = json.loads(a.polygon)
            if len(poly) < 4:
                continue
            lbl = label_map.get(a.label_id)
            ann_list.append({"class_index": lbl.class_index if lbl else 0, "polygon": poly})
        if ann_list:
            img_data.append({"rel_path": img.rel_path, "filename": img.filename, "annotations": ann_list})

    if not img_data:
        return

    snap_id = str(_uuid.uuid4())[:8]
    snapshot = {
        "id": snap_id,
        "project_id": project.id,
        "project_name": project.name,
        "label_names": [l.name for l in sorted_labels],
        "image_count": len(img_data),
        "created_at": _dt.now().isoformat(),
        "img_data": img_data,
    }
    (SNAP_DIR / f"{snap_id}.json").write_text(
        json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
    )
