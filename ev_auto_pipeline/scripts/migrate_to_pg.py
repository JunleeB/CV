"""
SQLite → PostgreSQL 마이그레이션 스크립트.
기존 annotation.db 의 모든 데이터를 PostgreSQL로 복사합니다.
"""
import sqlite3
import psycopg2
import json
from pathlib import Path

SQLITE_PATH = Path(__file__).parent / "annotation.db"
PG_DSN = "host=localhost port=5432 dbname=annotation user=evuser password=REDACTED"

print("SQLite →  PostgreSQL 마이그레이션 시작")

sqlite = sqlite3.connect(str(SQLITE_PATH))
sqlite.row_factory = sqlite3.Row
pg = psycopg2.connect(PG_DSN)

# ── PostgreSQL 스키마 생성 ──────────────────────────────────────────────────
pg.cursor().execute("""
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'annotator',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    source_path TEXT,
    conf_threshold FLOAT DEFAULT 0.7,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS labels (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(50) DEFAULT '#6366f1',
    class_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    rel_path TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS annotations (
    id SERIAL PRIMARY KEY,
    image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
    label_id INTEGER REFERENCES labels(id) ON DELETE CASCADE,
    polygon TEXT NOT NULL,
    confidence FLOAT,
    is_auto BOOLEAN DEFAULT FALSE,
    needs_review BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_images_project_status ON images(project_id, status);
CREATE INDEX IF NOT EXISTS idx_annotations_image_id ON annotations(image_id);
""")
pg.commit()
print("PostgreSQL 스키마 생성 완료")

cur_pg = pg.cursor()

# ── users ──────────────────────────────────────────────────────────────────
rows = sqlite.execute("SELECT * FROM users").fetchall()
for r in rows:
    cur_pg.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (r['id'], r['username'], r['password_hash'], r['display_name'], r['role'], r['created_at'])
    )
print(f"users: {len(rows)}개 마이그레이션")

# ── projects ───────────────────────────────────────────────────────────────
rows = sqlite.execute("SELECT * FROM projects").fetchall()
for r in rows:
    cur_pg.execute(
        "INSERT INTO projects (id, name, source_path, conf_threshold, created_at) "
        "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (r['id'], r['name'], r['source_path'], r['conf_threshold'], r['created_at'])
    )
print(f"projects: {len(rows)}개 마이그레이션")

# ── labels ─────────────────────────────────────────────────────────────────
rows = sqlite.execute("SELECT * FROM labels").fetchall()
for r in rows:
    cur_pg.execute(
        "INSERT INTO labels (id, project_id, name, color, class_index) "
        "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (r['id'], r['project_id'], r['name'], r['color'], r['class_index'])
    )
print(f"labels: {len(rows)}개 마이그레이션")

# ── images (배치 처리) ──────────────────────────────────────────────────────
rows = sqlite.execute("SELECT * FROM images").fetchall()
batch = [(r['id'], r['project_id'], r['filename'], r['rel_path'], r['status']) for r in rows]
if batch:
    from psycopg2.extras import execute_values
    execute_values(cur_pg,
        "INSERT INTO images (id, project_id, filename, rel_path, status) VALUES %s ON CONFLICT (id) DO NOTHING",
        batch
    )
print(f"images: {len(rows)}개 마이그레이션")

# ── annotations (배치 처리) ────────────────────────────────────────────────
rows = sqlite.execute("SELECT * FROM annotations").fetchall()
batch = [(r['id'], r['image_id'], r['label_id'], r['polygon'],
          r['confidence'], bool(r['is_auto']), bool(r['needs_review'])) for r in rows]
if batch:
    execute_values(cur_pg,
        "INSERT INTO annotations (id, image_id, label_id, polygon, confidence, is_auto, needs_review) "
        "VALUES %s ON CONFLICT (id) DO NOTHING",
        batch,
        page_size=1000
    )
print(f"annotations: {len(rows)}개 마이그레이션")

# ── sequence 재설정 (AUTO INCREMENT 충돌 방지) ──────────────────────────────
for table in ['users', 'projects', 'labels', 'images', 'annotations']:
    cur_pg.execute(f"SELECT setval('{table}_id_seq', COALESCE((SELECT MAX(id) FROM {table}), 1))")

pg.commit()
sqlite.close()
pg.close()
print("\n마이그레이션 완료!")
