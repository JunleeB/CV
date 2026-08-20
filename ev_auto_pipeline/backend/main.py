from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database import init_db, get_db, Image, engine
from backend import inference as inf
from sqlalchemy import text
from backend.routers import (
    projects,
    images,
    annotations,
    jobs,
    auth,
    models as models_router,
)
from backend.routers.auth import ensure_admin_exists
from backend.routers.models import ensure_base_model
from backend.database import SessionLocal

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # 신규 컬럼 마이그레이션
    for stmt in [
        "ALTER TABLE projects ADD COLUMN roi TEXT",
        "ALTER TABLE projects ADD COLUMN model_id INTEGER",
        "ALTER TABLE model_versions ADD COLUMN task VARCHAR DEFAULT 'segment'",
    ]:
        try:
            with engine.connect() as conn:
                conn.execute(text(stmt))
                conn.commit()
        except Exception:
            pass
    db = SessionLocal()
    try:
        ensure_admin_exists(db)
        ensure_base_model(db)
    finally:
        db.close()
    print("DB 초기화 완료")
    try:
        inf.load_models()
        print("모델 로딩 완료 (YOLO + SAM2)")
    except Exception:
        import traceback

        print(f"[경고] 모델 로딩 실패 — 추론 기능 비활성화:\n{traceback.format_exc()}")
    yield


app = FastAPI(title="EV Annotation", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(images.router)
app.include_router(annotations.router)
app.include_router(jobs.router)
app.include_router(models_router.router)


@app.get("/api/public/preview")
def public_preview(db: Session = Depends(get_db)):
    """인증 없이 로그인 화면에서 사용할 어노테이션된 이미지 ID 3개 반환."""
    import random

    imgs = db.query(Image).filter(Image.status.in_(["annotated", "done"])).all()
    sample = random.sample(imgs, min(3, len(imgs))) if imgs else []
    return [{"id": img.id, "filename": img.filename} for img in sample]


@app.get("/api/public/image/{image_id}")
def public_image(image_id: int, db: Session = Depends(get_db)):
    """인증 없이 이미지 파일 서빙 (로그인 페이지 미리보기용)."""
    from fastapi import HTTPException

    img = db.query(Image).filter(Image.id == image_id).first()
    if not img or not Path(img.rel_path).exists():
        raise HTTPException(status_code=404)
    return FileResponse(img.rel_path, media_type="image/jpeg")


# Serve frontend (CDN-based, no build step)
if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def index():
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Don't intercept API or image routes
        if (
            full_path.startswith("api/")
            or full_path.startswith("images/")
            or full_path.startswith("ws/")
        ):
            from fastapi import HTTPException

            raise HTTPException(status_code=404)
        return FileResponse(str(STATIC_DIR / "index.html"))
