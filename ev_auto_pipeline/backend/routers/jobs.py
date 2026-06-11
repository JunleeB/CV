"""
Auto-annotation job management.
Jobs run in a background thread; progress is streamed via WebSocket.
"""
import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, SessionLocal, Image, Annotation, Label, ModelVersion
from backend import inference as inf

router = APIRouter(tags=["jobs"])


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    union = (ax2-ax1)*(ay2-ay1) + (bx2-bx1)*(by2-by1) - inter
    return inter / union if union > 0 else 0.0


class FrameTracker:
    """
    프레임 간 단순 IoU 트래커.
    - 놓친 프레임 전파: 이전 프레임 탐지를 최대 max_age 프레임 review로 전파
    - 정적 오탐 억제: static_frames 동안 같은 위치(IoU > static_iou) → 고정 물체로 판단, 제거
    """
    def __init__(self, iou_threshold=0.3, max_age=3, static_frames=6, static_iou=0.85):
        self.tracks: list[dict] = []
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.static_frames = static_frames
        self.static_iou = static_iou

    def _match(self, dets: list[dict]) -> tuple[dict, list[dict], list[dict]]:
        """현재 탐지를 트랙에 매칭. (matched_track→det, unmatched_tracks, unmatched_dets)"""
        matched, unmatched_tr, unmatched_det = {}, list(range(len(self.tracks))), list(range(len(dets)))
        for ti in list(unmatched_tr):
            tr = self.tracks[ti]
            best_iou, best_di = 0.0, -1
            for di in unmatched_det:
                if dets[di]["cls_id"] != tr["cls_id"]:
                    continue
                iou = _iou(tr["bbox"], dets[di]["bbox"])
                if iou > best_iou:
                    best_iou, best_di = iou, di
            if best_iou >= self.iou_threshold:
                matched[ti] = best_di
                unmatched_tr.remove(ti)
                unmatched_det.remove(best_di)
        return matched, unmatched_tr, unmatched_det

    def update(self, detections: list[dict]) -> list[dict]:
        """
        detections: [{"cls_id", "bbox", "conf", "is_auto"}]
        Returns: 이번 프레임의 최종 탐지 리스트 (전파 포함, 정적 오탐 제외)
        """
        matched, unmatched_tr, unmatched_det = self._match(detections)

        new_tracks = []
        result = []

        # 매칭된 트랙 업데이트
        for ti, di in matched.items():
            tr = self.tracks[ti]
            det = detections[di]
            prev_bbox = tr["bbox"]
            # 정적 판단: 이전 bbox와 거의 같으면 static_count 증가
            if _iou(prev_bbox, det["bbox"]) >= self.static_iou:
                static_count = tr.get("static_count", 0) + 1
            else:
                static_count = 0
            new_tracks.append({
                "cls_id": det["cls_id"],
                "bbox": det["bbox"],
                "conf": det["conf"],
                "age": 0,
                "static_count": static_count,
                "is_auto": det.get("is_auto", True),
            })
            if static_count < self.static_frames:
                result.append(det)
            # static_count >= static_frames → 정적 오탐, 결과에서 제외

        # 매칭 안 된 트랙 → 전파 or 소멸
        for ti in unmatched_tr:
            tr = self.tracks[ti]
            age = tr.get("age", 0) + 1
            if age <= self.max_age and tr.get("static_count", 0) < self.static_frames:
                # 이전 박스를 review 아이템으로 전파 (confidence 감쇠)
                propagated_conf = tr["conf"] * (0.8 ** age)
                result.append({
                    "cls_id": tr["cls_id"],
                    "bbox": tr["bbox"],
                    "conf": propagated_conf,
                    "is_auto": True,
                    "propagated": True,
                })
                new_tracks.append({**tr, "age": age, "conf": tr["conf"]})

        # 새 탐지 (매칭 안 된 detection) → 새 트랙 시작
        for di in unmatched_det:
            det = detections[di]
            new_tracks.append({
                "cls_id": det["cls_id"],
                "bbox": det["bbox"],
                "conf": det["conf"],
                "age": 0,
                "static_count": 0,
                "is_auto": det.get("is_auto", True),
            })
            result.append(det)

        self.tracks = new_tracks
        return result

# In-memory job registry  {job_id: {"status", "progress", "total", "project_id", "error"}}
_jobs: dict[str, dict] = {}
# Active WebSocket connections per job
_ws_clients: dict[str, list[WebSocket]] = {}


class JobCreate(BaseModel):
    conf_threshold: Optional[float] = None
    force: bool = False  # True면 기존 어노테이션 삭제 후 전체 재처리


@router.post("/api/projects/{project_id}/jobs")
def start_job(project_id: int, body: JobCreate = JobCreate(), db: Session = Depends(get_db)):
    from backend.database import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    conf = body.conf_threshold if body.conf_threshold is not None else project.conf_threshold
    roi = json.loads(project.roi) if project.roi else None

    # force 모드: 기존 어노테이션 전부 삭제 후 모든 이미지를 pending으로 초기화
    if body.force:
        all_images = db.query(Image).filter(Image.project_id == project_id).all()
        for img in all_images:
            db.query(Annotation).filter(Annotation.image_id == img.id).delete()
            img.status = "pending"
        db.commit()

    # 프로젝트에 지정된 모델의 weights_path 조회
    weights_path = None
    model_task = "segment"
    if project.model_id:
        mv = db.query(ModelVersion).filter(ModelVersion.id == project.model_id).first()
        if mv:
            weights_path = mv.weights_path
            model_task = mv.task or "segment"
    images = db.query(Image).filter(
        Image.project_id == project_id,
        Image.status == "pending",
    ).all()
    if not images:
        return {"job_id": None, "message": "처리할 이미지가 없습니다."}

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "running",
        "progress": 0,
        "total": len(images),
        "project_id": project_id,
        "error": None,
        "auto_count": 0,
        "review_count": 0,
    }
    _ws_clients[job_id] = []

    image_ids = [i.id for i in images]
    labels = {l.class_index: l.id for l in project.labels}

    thread = threading.Thread(
        target=_run_job,
        args=(job_id, image_ids, labels, conf, roi, weights_path, model_task),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "total": len(images)}


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    return job


@router.websocket("/ws/jobs/{job_id}")
async def job_ws(websocket: WebSocket, job_id: str):
    await websocket.accept()
    job = _jobs.get(job_id)
    if not job:
        await websocket.close(code=4004)
        return

    _ws_clients.setdefault(job_id, []).append(websocket)
    try:
        # Send current state immediately
        await websocket.send_json(_jobs[job_id])
        while True:
            await asyncio.sleep(0.5)
            state = _jobs.get(job_id)
            if state is None:
                break
            await websocket.send_json(state)
            if state["status"] in ("done", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        clients = _ws_clients.get(job_id, [])
        if websocket in clients:
            clients.remove(websocket)


def _run_job(job_id: str, image_ids: list[int], labels: dict[int, int], conf: float,
             roi: list | None = None, weights_path: str | None = None, model_task: str = "segment"):
    db = SessionLocal()
    if model_task == "segment":
        infer_fn = inf.run_inference
    elif model_task == "gdino":
        infer_fn = inf.run_inference_gdino
    else:
        infer_fn = inf.run_inference_detect

    # gdino만 tracking 적용 (프레임 순서가 의미 있는 경우)
    tracker = FrameTracker() if model_task == "gdino" else None

    try:
        # 파일명 순 정렬 → 프레임 순서 보장
        images = db.query(Image).filter(Image.id.in_(image_ids)).order_by(Image.filename).all()

        for i, img in enumerate(images):
            auto_labels, review_items = infer_fn(img.rel_path, conf_threshold=conf, roi=roi, weights_path=weights_path)

            # tracker 적용: GDINO 결과를 트래커에 넣고 최종 탐지 결정
            if tracker is not None:
                from PIL import Image as PILImage
                try:
                    with PILImage.open(img.rel_path) as _pil:
                        _iw, _ih = _pil.size
                except Exception:
                    _iw, _ih = 1920, 1080

                # auto_labels: normalized polygon → pixel bbox 변환
                all_dets = []
                for item in auto_labels:
                    poly = item["polygon"]
                    xs = [poly[k] * _iw for k in range(0, len(poly), 2)]
                    ys = [poly[k] * _ih for k in range(1, len(poly), 2)]
                    all_dets.append({
                        "cls_id": item["class_id"],
                        "bbox": [min(xs), min(ys), max(xs), max(ys)],
                        "conf": item["confidence"],
                        "is_auto": True,
                    })
                # review_items: 이미 pixel bbox
                for item in review_items:
                    all_dets.append({
                        "cls_id": item["class_id"],
                        "bbox": item["bbox"],
                        "conf": item["confidence"],
                        "is_auto": True,
                    })

                tracked = tracker.update(all_dets)

                # tracker 결과로 auto/review 재분류
                auto_labels, review_items = [], []
                for det in tracked:
                    x1, y1, x2, y2 = det["bbox"]
                    if det.get("propagated") or det["conf"] < conf:
                        review_items.append({
                            "class_id": det["cls_id"],
                            "bbox": [x1, y1, x2, y2],
                            "confidence": det["conf"],
                        })
                    else:
                        poly = [
                            x1/_iw, y1/_ih,
                            x2/_iw, y1/_ih,
                            x2/_iw, y2/_ih,
                            x1/_iw, y2/_ih,
                        ]
                        auto_labels.append({
                            "class_id": det["cls_id"],
                            "polygon": poly,
                            "confidence": det["conf"],
                        })

            db.query(Annotation).filter(Annotation.image_id == img.id).delete()

            if auto_labels:
                for item in auto_labels:
                    label_db_id = labels.get(item["class_id"])
                    if label_db_id is None:
                        continue
                    db.add(Annotation(
                        image_id=img.id,
                        label_id=label_db_id,
                        polygon=json.dumps(item["polygon"]),
                        confidence=item["confidence"],
                        is_auto=True,
                        needs_review=False,
                    ))
                img.status = "annotated"
                _jobs[job_id]["auto_count"] += 1
            else:
                img.status = "pending"

            for item in review_items:
                label_db_id = labels.get(item["class_id"])
                if label_db_id is None:
                    continue
                bbox = item["bbox"]
                db.add(Annotation(
                    image_id=img.id,
                    label_id=label_db_id,
                    polygon=json.dumps(bbox),
                    confidence=item["confidence"],
                    is_auto=True,
                    needs_review=True,
                ))
                img.status = "review"
                _jobs[job_id]["review_count"] += 1

            db.commit()
            _jobs[job_id]["progress"] = i + 1

        _jobs[job_id]["status"] = "done"
    except Exception as e:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)
    finally:
        db.close()


# ── SAM2 비디오 트래킹 ────────────────────────────────────────────────────────

class TrackCreate(BaseModel):
    image_id: int
    mask_mode: bool = False  # True → SAM2 마스크 polygon, False → bbox 직사각형


@router.post("/api/projects/{project_id}/track")
def start_track(project_id: int, body: TrackCreate, db: Session = Depends(get_db)):
    from backend.database import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    # 씨드 프레임 어노테이션 조회
    seed_anns = db.query(Annotation).filter(Annotation.image_id == body.image_id).all()
    if not seed_anns:
        return {"job_id": None, "message": "현재 프레임에 저장된 어노테이션이 없습니다. 먼저 저장하세요."}

    # 프로젝트 이미지 파일명 순 정렬 → 씨드 이후 프레임만 추출
    all_images = (
        db.query(Image)
        .filter(Image.project_id == project_id)
        .order_by(Image.filename)
        .all()
    )
    start_idx = next((i for i, img in enumerate(all_images) if img.id == body.image_id), None)
    if start_idx is None:
        raise HTTPException(status_code=404, detail="이미지가 프로젝트에 없습니다.")

    target_images = all_images[start_idx:]  # 씨드 프레임 포함
    if len(target_images) < 2:
        return {"job_id": None, "message": "추적할 다음 프레임이 없습니다."}

    # 씨드 bbox 추출 (polygon → bbox_norm)
    label_class_map = {lbl.id: lbl.class_index for lbl in project.labels}
    label_id_map = {lbl.class_index: lbl.id for lbl in project.labels}
    seeds = []
    for ann in seed_anns:
        poly = json.loads(ann.polygon)
        if len(poly) < 4:
            continue
        class_id = label_class_map.get(ann.label_id)
        if class_id is None:
            continue
        xs, ys = poly[0::2], poly[1::2]
        seeds.append({"bbox_norm": [min(xs), min(ys), max(xs), max(ys)], "class_id": class_id})

    if not seeds:
        return {"job_id": None, "message": "유효한 씨드 어노테이션이 없습니다."}

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "running",
        "progress": 0,
        "total": len(target_images) - 1,
        "project_id": project_id,
        "error": None,
        "auto_count": 0,
        "review_count": 0,
    }

    # mask_mode 명시 시 우선, 아니면 프로젝트 모델 task로 결정
    if body.mask_mode:
        bbox_only = False
    elif project.model_id:
        mv = db.query(ModelVersion).filter(ModelVersion.id == project.model_id).first()
        bbox_only = not (mv and mv.task == "segment")
    else:
        bbox_only = True

    thread = threading.Thread(
        target=_run_track_job,
        args=(job_id, [(img.id, img.rel_path) for img in target_images], seeds, label_id_map, bbox_only),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "total": len(target_images) - 1}


def _run_track_job(job_id: str, image_id_paths: list[tuple], seeds: list[dict], label_id_map: dict, bbox_only: bool = True):
    db = SessionLocal()
    try:
        image_paths = [p for _, p in image_id_paths]
        image_ids = [i for i, _ in image_id_paths]

        seed_bboxes = [s["bbox_norm"] for s in seeds]
        seed_class_ids = [s["class_id"] for s in seeds]

        def _progress(frame_idx):
            _jobs[job_id]["progress"] = frame_idx

        results = inf.run_sam2_video_track(
            image_paths, seed_bboxes, seed_class_ids, bbox_only=bbox_only, progress_cb=_progress
        )

        # frame_idx별 그룹화
        from collections import defaultdict
        by_frame: dict[int, list] = defaultdict(list)
        for r in results:
            by_frame[r["frame_idx"]].append(r)

        # 이번 트래킹에서 다루는 class_id 집합 (이것만 교체, 나머지 클래스는 보존)
        tracked_label_ids = {
            label_id_map[cid] for cid in seed_class_ids if cid in label_id_map
        }

        # 씨드 프레임(frame 0) 제외하고 저장
        for frame_idx, img_id in enumerate(image_ids[1:], start=1):
            # 같은 클래스의 기존 어노테이션만 삭제 — 다른 클래스는 유지
            db.query(Annotation).filter(
                Annotation.image_id == img_id,
                Annotation.label_id.in_(tracked_label_ids),
            ).delete(synchronize_session=False)

            frame_results = by_frame.get(frame_idx, [])
            if not frame_results:
                # 이 프레임에 남아있는 어노테이션(다른 클래스)이 있으면 annotated 유지
                remaining = db.query(Annotation).filter(Annotation.image_id == img_id).count()
                if remaining == 0:
                    db.query(Image).filter(Image.id == img_id).update({"status": "pending"})
                db.commit()
                continue
            for r in frame_results:
                label_db_id = label_id_map.get(r["class_id"])
                if label_db_id is None:
                    continue
                db.add(Annotation(
                    image_id=img_id,
                    label_id=label_db_id,
                    polygon=json.dumps(r["polygon"]),
                    confidence=0.9,
                    is_auto=True,
                    needs_review=False,
                ))
            db.query(Image).filter(Image.id == img_id).update({"status": "annotated"})
            db.commit()
            _jobs[job_id]["auto_count"] += 1

        _jobs[job_id]["progress"] = len(image_ids) - 1
        _jobs[job_id]["status"] = "done"
    except Exception as e:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)
    finally:
        db.close()
