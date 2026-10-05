#!/usr/bin/env bash
# EduMemory — Shifrlangan zaxira nusxadan ma'lumotlar bazasini qayta tiklash skripti
# Foydalanish: ./scripts/restore.sh <zaxira_fayli.sql.gz.enc>

set -e

BACKUP_FILE="$1"

if [ -z "${BACKUP_FILE}" ]; then
  echo "❌ Xatolik: Zaxira faylini ko'rsating!"
  echo "Foydalanish: ./scripts/restore.sh <zaxira_fayli.sql.gz.enc>"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ Xatolik: '${BACKUP_FILE}' fayli topilmadi!"
  exit 1
fi

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_USER="${DB_USER:-edumemory}"
DB_NAME="${DB_NAME:-edumemory}"
CONTAINER_NAME="${PG_CONTAINER:-edumemory_postgres}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-EduMemory_Super_Secret_Backup_Key_2026}"

echo "⚠️  DIQQAT: Joriy ma'lumotlar zaxiradagi holatga qaytariladi."
read -p "Davom etishni xohlaysizmi? (ha/yo'q): " confirm
if [ "${confirm}" != "ha" ]; then
  echo "Bekor qilindi."
  exit 0
fi

echo "🔓 Shifrdan chiqarilmoqda va bazaga qayta tiklanmoqda..."

openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in "${BACKUP_FILE}" -pass pass:"${ENCRYPTION_KEY}" \
  | gunzip \
  | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "✅ Ma'lumotlar bazasi zaxiradan muvaffaqiyatli tiklandi!"
