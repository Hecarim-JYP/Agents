#!/usr/bin/env bash
# DB·업로드 파일 백업 — compose의 backup 서비스가 실행한다 (ops.md 6절)
#   백업:  docker compose run --rm backup                        (호스트 cron이 매일 호출)
#   복원:  docker compose run --rm backup restore <파일명> [대상DB]  (대상 기본값 <DB명>_restore — 복구 리허설용)
#
# 흐름: 덤프 → gzip → 암호화 → 임시 이름(.part)으로 저장 → 복호·압축·완료 표시 검사 → 정식 이름으로 변경
#       → 보관 기간 지난 파일 삭제 → batch_history에 성공 기록 (층 2 감시가 "정상 시간 내 성공"을 본다 — batch.md 3절)
# 검사를 통과한 파일만 정식 이름을 갖는다 — 중간에 죽은 백업이 "있는 백업"처럼 보이지 않게.
set -euo pipefail   # pipefail 필수: 없으면 mariadb-dump가 실패해도 `| gzip`의 종료 코드 0이 남는다 (실측: 20바이트 빈 파일 + exit 0)
umask 077           # 백업 파일은 소유자만 읽는다

: "${DB_NAME:?}" "${MYSQL_PWD:?}" "${BACKUP_KEY:?}" "${BACKUP_KEEP_DAYS:?}"   # MYSQL_PWD: 명령줄 -p 대신 — 프로세스 목록에 비밀번호가 보이지 않는다
OUT=/backup
DB_HOST=db
# MariaDB 이미지면 mariadb-dump, MySQL 이미지(8.4)면 mysqldump — backup 서비스 이미지를 db와 같게 두면 저절로 맞는다
DUMP="$(command -v mariadb-dump || command -v mysqldump)"
SQL="$(command -v mariadb || command -v mysql)"

log() { echo "$(date '+%F %T') [backup] $*"; }
# AES-256 + PBKDF2 — 이미지에 있는 openssl만 쓴다 (mariadb 이미지에는 gpg-agent가 없어 gpg 대칭 암호화가 안 된다)
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_KEY "$@"; }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY "$@"; }

if [[ "${1:-}" == "restore" ]]; then
  file="$OUT/${2:?복원할 파일명}"
  target="${3:-${DB_NAME}_restore}"   # 운영 DB에 덮어쓰려면 DB명을 직접 적어야 한다 — 리허설이 실수로 운영을 덮지 않게
  log "복원: $file → $target"
  "$SQL" -h "$DB_HOST" -uroot -e "CREATE DATABASE IF NOT EXISTS \`$target\`"
  dec -in "$file" | gunzip | "$SQL" -h "$DB_HOST" -uroot "$target"
  log "복원 완료 — 탈퇴·삭제 요청으로 파기한 데이터가 되살아났다면 파기 목록을 다시 적용한다 (features/account-withdrawal.md)"
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
started="$(date '+%F %T')"
rm -f "$OUT"/*.part   # 지난 실행이 남긴 미완성 파일

# 1) DB — --single-transaction: 쓰기를 멈추지 않고 한 시점으로 덤프한다 (실측: 기본 옵션은 덤프 내내 쓰기 정지,
#    잠금을 끄면 테이블끼리 시점이 어긋난다). --routines --events: 프로시저·이벤트는 기본 덤프에 들어가지 않는다 (실측)
db_file="db-$stamp.sql.gz.enc"
"$DUMP" -h "$DB_HOST" -uroot --single-transaction --routines --events "$DB_NAME" | gzip | enc -out "$OUT/$db_file.part"
# 검사: 복호 + gzip CRC + 마지막 줄의 완료 표시 (중간에 끊긴 덤프에는 이 줄이 없다 — 실측)
dec -in "$OUT/$db_file.part" | gunzip | tail -n 1 | grep -q '^-- Dump completed' || { log "DB 백업 검사 실패"; exit 1; }
mv "$OUT/$db_file.part" "$OUT/$db_file"
log "DB 백업 $db_file ($(du -h "$OUT/$db_file" | cut -f1))"

# 2) 업로드 파일 — 업로드 기능이 없으면 마운트가 없어 건너뛴다
files=1
if [[ -d /data/uploads ]]; then
  up_file="uploads-$stamp.tar.gz.enc"
  tar -C /data -czf - uploads | enc -out "$OUT/$up_file.part"
  dec -in "$OUT/$up_file.part" | tar -tzf - > /dev/null || { log "업로드 백업 검사 실패"; exit 1; }
  mv "$OUT/$up_file.part" "$OUT/$up_file"
  log "업로드 백업 $up_file ($(du -h "$OUT/$up_file" | cut -f1))"
  files=2
fi

# 3) 보관 기간 — 처리방침에 적은 기간과 같아야 한다 (탈퇴자 정보가 백업에 남는 기간 — features/account-withdrawal.md)
find "$OUT" -maxdepth 1 -name '*.enc' -mtime +"$BACKUP_KEEP_DAYS" -print -delete | sed 's/^/  삭제 /'

# 4) 성공 기록 — 기록이 없으면(백업이 안 돌았거나 실패) 배치 상태 엔드포인트가 빨간불 (batch.md 3절 층 2)
"$SQL" -h "$DB_HOST" -uroot "$DB_NAME" -e "INSERT INTO batch_history (batch_name, target_date, started_at, finished_at, status, processed_count)
  VALUES ('DB_BACKUP', CURDATE(), '$started', NOW(), 'SUCCESS', $files)"
log "완료"
