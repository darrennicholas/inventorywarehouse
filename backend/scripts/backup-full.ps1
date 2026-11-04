param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
$backendDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

Push-Location $backendDirectory
try {
  npm run db:backup -- $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Backup PostgreSQL gagal." }
} finally {
  Pop-Location
}

$envPath = Join-Path $backendDirectory ".env"
$attachmentDirectory = Join-Path $backendDirectory "storage\attachments"
if (Test-Path -LiteralPath $envPath) {
  $attachmentLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*ATTACHMENT_STORAGE_PATH\s*=' } | Select-Object -First 1
  if ($attachmentLine) {
    $configuredPath = ($attachmentLine -replace '^\s*ATTACHMENT_STORAGE_PATH\s*=\s*', '').Trim().Trim('"')
    if ($configuredPath) {
      $attachmentDirectory = if ([System.IO.Path]::IsPathRooted($configuredPath)) { $configuredPath } else { Join-Path $backendDirectory $configuredPath }
    }
  }
}

if (Test-Path -LiteralPath $attachmentDirectory -PathType Container) {
  $files = Get-ChildItem -LiteralPath $attachmentDirectory -Force
  if ($files.Count -gt 0) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $archivePath = Join-Path $outputPath "attachments-$timestamp.zip"
    Compress-Archive -Path (Join-Path $attachmentDirectory "*") -DestinationPath $archivePath -CompressionLevel Optimal
    Write-Output "Attachment backup: $archivePath"
  } else {
    Write-Output "Attachment directory is empty; no attachment archive created."
  }
} else {
  Write-Warning "Attachment directory tidak ditemukan: $attachmentDirectory. Hanya backup PostgreSQL yang dibuat."
}
