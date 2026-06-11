#!/bin/bash
# DB 복원 스크립트 — 실행: ./db_restore.sh backups/annotation_20240101_120000.sql.gz
if [ -z "$1" ]; then
  echo "사용법: $0 <백업파일.sql.gz>"
  echo "백업 목록:"
  ls -lh "$(dirname "$0")/backups/"*.sql.gz 2>/dev/null || echo "  백업 없음"
  exit 1
fi

echo "⚠️  기존 DB를 덮어씁니다. 계속하시겠습니까? (yes 입력)"
read CONFIRM
[ "$CONFIRM" != "yes" ] && echo "취소" && exit 0

gunzip -c "$1" | docker exec -i ev_postgres psql -U evuser annotation
echo "복원 완료: $1"
