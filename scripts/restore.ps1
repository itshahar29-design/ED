# EduMemory — Shifrlangan zaxira nusxadan ma'lumotlar bazasini qayta tiklash skripti (PowerShell)
param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [string]$EncryptionKey = $env:BACKUP_ENCRYPTION_KEY
)

if (-not $EncryptionKey) {
    $EncryptionKey = "EduMemory_Super_Secret_Backup_Key_2026"
}

$Container = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "edumemory_postgres" }
$DbUser = if ($env:DB_USER) { $env:DB_USER } else { "edumemory" }
$DbName = if ($env:DB_NAME) { $env:DB_NAME } else { "edumemory" }

if (-not (Test-Path $BackupFile)) {
    Write-Error "❌ Xatolik: '$BackupFile' fayli topilmadi!"
    exit 1
}

$Confirm = Read-Host "⚠️  DIQQAT: Joriy ma'lumotlar zaxiradagi holatga qaytariladi. Davom etasizmi? (ha/yo'q)"
if ($Confirm -ne "ha") {
    Write-Host "Bekor qilindi." -ForegroundColor Yellow
    exit 0
}

$TempGz = "$BackupFile.temp.gz"
$TempSql = "$BackupFile.temp.sql"

Write-Host "🔓 Shifrdan chiqarilmoqda..." -ForegroundColor Cyan
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in $BackupFile -out $TempGz -pass pass:$EncryptionKey

tar -xzf $TempGz
Remove-Item $TempGz -Force

Write-Host "📥 Bazaga tiklanmoqda..." -ForegroundColor Cyan
Get-Content $TempSql | docker exec -i $Container psql -U $DbUser -d $DbName
Remove-Item $TempSql -Force

Write-Host "✅ Ma'lumotlar bazasi zaxiradan muvaffaqiyatli tiklandi!" -ForegroundColor Green
