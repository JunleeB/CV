from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database import get_db, Image

router = APIRouter(tags=["images"])


@router.get("/api/projects/{project_id}/images")
def list_images(
    project_id: int,
    status: str = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = db.query(Image).filter(Image.project_id == project_id)
    if status:
        q = q.filter(Image.status == status)
    total = q.count()
    images = q.order_by(Image.filename).offset(skip).limit(limit).all()
    return {
        "total": total,
        "items": [
            {"id": i.id, "filename": i.filename, "rel_path": i.rel_path, "status": i.status}
            for i in images
        ],
    }


@router.get("/images/{image_id}/file")
def serve_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    path = Path(img.rel_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"파일 없음: {img.rel_path}")
    return FileResponse(str(path))
