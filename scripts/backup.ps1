# EduMemory — Kunlik shifrlangan ma'lumotlar bazasi zaxira nusxasini olish skripti (PowerShell)
param(
    [string]$BackupDir = ".\backups",
    [string]$EncryptionKey = $env:BACKUP_ENCRYPTION_KEY
)

if (-not $EncryptionKey) {
    $EncryptionKey = "EduMemory_Super_Secret_Backup_Key_2026"
}

$Container = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "edumemory_postgres" }
$DbUser = if ($env:DB_USER) { $env:DB_USER } else { "edumemory" }
$DbName = if ($env:DB_NAME) { $env:DB_NAME } else { "edumemory" }

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TargetFile = Join-Path $BackupDir "edumemory_backup_$Timestamp.sql.gz.enc"
$TempSql = Join-Path $BackupDir "temp_dump_$Timestamp.sql"
$TempGz = Join-Path $BackupDir "temp_dump_$Timestamp.sql.gz"

Write-Host "📦 EduMemory: PostgreSQL ma'lumotlar bazasidan zaxira olinmoqda..." -ForegroundColor Cyan

docker exec -t $Container pg_dump -U $DbUser -d $DbName --clean --if-exists > $TempSql

# Gzip siqish
Get-Content -Path $TempSql -Raw | Out-File -FilePath $TempSql -Encoding utf8
tar -czf $TempGz -C $BackupDir "temp_dump_$Timestamp.sql"
Remove-Item $TempSql -Force

# OpenSSL bilan shifrlash
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 -in $TempGz -out $TargetFile -pass pass:$EncryptionKey
Remove-Item $TempGz -Force

Write-Host "✅ Zaxira nusxa muvaffaqiyatli saqlandi va AES-256 bilan shifrlandi:" -ForegroundColor Green
Write-Host "   Fayl: $TargetFile" -ForegroundColor Yellow
