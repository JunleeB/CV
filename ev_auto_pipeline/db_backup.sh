#!/bin/bash
# DB 백업 스크립트 — 실행: ./db_backup.sh
BACKUP_DIR="$(dirname "$0")/backups"
mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/annotation_$DATE.sql"

docker exec ev_postgres pg_dump \
  -U evuser annotation > "$FILE"

if [ $? -eq 0 ]; then
  gzip "$FILE"
  echo "백업 완료: ${FILE}.gz"
  # 30일 이상 된 백업 자동 삭제
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
else
  echo "백업 실패"
  exit 1
fi
