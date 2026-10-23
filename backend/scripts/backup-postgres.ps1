param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
$envPath = Join-Path $PSScriptRoot "..\.env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "backend/.env tidak ditemukan. Salin backend/.env.example terlebih dahulu."
}

$databaseLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $databaseLine) {
  throw "DATABASE_URL belum diatur di backend/.env."
}

$databaseUrl = ($databaseLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"')
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL kosong."
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $OutputDirectory "inventorywarehouse-$timestamp.dump"

& pg_dump --dbname=$databaseUrl --format=custom --no-owner --no-privileges --file=$backupPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump gagal dengan exit code $LASTEXITCODE. Pastikan PostgreSQL bin tersedia di PATH."
}

Write-Output "Backup berhasil: $backupPath"
