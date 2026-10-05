#!/usr/bin/env bash
# EduMemory — Kunlik shifrlangan ma'lumotlar bazasi zaxira nusxasini olish skripti (AES-256)
# Foydalanish: ./scripts/backup.sh [chiqish_papka]

set -e

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="edumemory_backup_${TIMESTAMP}.sql.gz.enc"
TARGET_FILE="${BACKUP_DIR}/${BACKUP_NAME}"

# .env faylidan o'qish (agar mavjud bo'lsa)
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_USER="${DB_USER:-edumemory}"
DB_NAME="${DB_NAME:-edumemory}"
CONTAINER_NAME="${PG_CONTAINER:-edumemory_postgres}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-EduMemory_Super_Secret_Backup_Key_2026}"

mkdir -p "${BACKUP_DIR}"

echo "📦 EduMemory: PostgreSQL ma'lumotlar bazasidan zaxira olinmoqda..."

# Docker container ichidan pg_dump olib, gzip bilan siqib, OpenSSL AES-256-CBC orqali shifrlash
docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists \
  | gzip \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 -out "${TARGET_FILE}" -pass pass:"${ENCRYPTION_KEY}"

echo "✅ Zaxira nusxa muvaffaqiyatli saqlandi va AES-256 bilan shifrlandi:"
echo "   Fayl: ${TARGET_FILE}"
echo "   Hajmi: $(du -h "${TARGET_FILE}" | cut -f1)"
