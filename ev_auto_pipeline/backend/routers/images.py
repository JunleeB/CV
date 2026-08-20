from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database import get_db, Image

router = APIRouter(tags=["images"])

THUMB_DIR = Path(__file__).parent.parent.parent / "thumbs"
THUMB_DIR.mkdir(exist_ok=True)
THUMB_MAX = 1280  # px


@router.get("/api/projects/{project_id}/images")
def list_images(
    project_id: int,
    status: str = Query(None),
    skip: int = 0,
    limit: int = 100,
    page: int = Query(None),
    page_size: int = Query(None),
    db: Session = Depends(get_db),
):
    if page is not None and page_size is not None:
        skip = page * page_size
        limit = page_size
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
    return FileResponse(str(path), headers={"Cache-Control": "public, max-age=86400, immutable"})


@router.get("/images/{image_id}/thumb")
def serve_thumb(image_id: int, db: Session = Depends(get_db)):
    """리사이즈된 썸네일 서빙. 로컬 디스크에 캐시해 NAS 반복 접근을 막음."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")

    thumb_path = THUMB_DIR / f"{image_id}.jpg"
    if not thumb_path.exists():
        src = Path(img.rel_path)
        if not src.exists():
            raise HTTPException(status_code=404, detail=f"파일 없음: {img.rel_path}")
        from PIL import Image as PILImage
        with PILImage.open(src) as pil:
            pil = pil.convert("RGB")
            pil.thumbnail((THUMB_MAX, THUMB_MAX), PILImage.LANCZOS)
            pil.save(thumb_path, "JPEG", quality=78, optimize=True)

    return FileResponse(str(thumb_path), headers={"Cache-Control": "public, max-age=604800, immutable"})
