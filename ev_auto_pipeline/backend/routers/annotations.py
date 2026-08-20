import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db, Annotation, Image, Label
from backend import inference as inf

router = APIRouter(tags=["annotations"])


class SamBboxBody(BaseModel):
    bbox: list[float]   # [x1,y1,x2,y2] normalized


class SamPointsBody(BaseModel):
    points: list[list[float]]   # [[x,y], ...]
    point_labels: list[int]     # 1=positive, 0=negative


@router.post("/api/images/{image_id}/sam-bbox")
def sam_bbox(image_id: int, body: SamBboxBody, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    try:
        polygon = inf.sam_predict_bbox(img.rel_path, body.bbox)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if polygon is None:
        raise HTTPException(status_code=422, detail="마스크 생성 실패 — 영역을 다시 그려주세요.")
    return {"polygon": polygon}


@router.post("/api/images/{image_id}/sam-points")
def sam_points(image_id: int, body: SamPointsBody, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    try:
        polygon = inf.sam_predict_points(img.rel_path, body.points, body.point_labels)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if polygon is None:
        raise HTTPException(status_code=422, detail="마스크 생성 실패.")
    return {"polygon": polygon}


class AnnotationIn(BaseModel):
    label_id: int
    polygon: list[float]
    confidence: Optional[float] = None
    is_auto: bool = False
    needs_review: bool = False


@router.get("/api/images/{image_id}/annotations")
def get_annotations(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    return [
        {
            "id": a.id,
            "label_id": a.label_id,
            "polygon": json.loads(a.polygon),
            "confidence": a.confidence,
            "is_auto": a.is_auto,
            "needs_review": a.needs_review,
        }
        for a in img.annotations
    ]


@router.put("/api/images/{image_id}/annotations")
def save_annotations(image_id: int, items: list[AnnotationIn], db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")

    # replace all annotations for this image
    db.query(Annotation).filter(Annotation.image_id == image_id).delete()
    for item in items:
        db.add(Annotation(
            image_id=image_id,
            label_id=item.label_id,
            polygon=json.dumps(item.polygon),
            confidence=item.confidence,
            is_auto=item.is_auto,
            needs_review=item.needs_review,
        ))

    has_review = any(i.needs_review for i in items)
    img.status = "review" if has_review else ("annotated" if items else "pending")
    db.commit()
    return {"ok": True, "status": img.status}


@router.delete("/api/projects/{project_id}/annotations")
def delete_all_project_annotations(project_id: int, db: Session = Depends(get_db)):
    images = db.query(Image).filter(Image.project_id == project_id).all()
    for img in images:
        db.query(Annotation).filter(Annotation.image_id == img.id).delete()
        img.status = "pending"
    db.commit()
    return {"ok": True}


@router.patch("/api/images/{image_id}/status")
def update_status(image_id: int, status: str, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    if status not in ("pending", "annotated", "review", "done"):
        raise HTTPException(status_code=400, detail="유효하지 않은 상태값입니다.")
    img.status = status
    db.commit()
    return {"ok": True}
