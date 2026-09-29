# 智算智伴一键停止：关闭 API/前端进程，再停止便携数据库（数据保留）。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '正在停止智算智伴服务 ...' -ForegroundColor Yellow

# 关闭占用 API / 前端专用端口的进程
foreach ($port in 53105, 57105) {
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "已停止端口 $port 的进程 (PID $procId)" -ForegroundColor Green
  }
}

# 停止便携数据库（数据保留在 .runtime\repro-postgres）
$pgBin = Join-Path $root '.runtime\pg\pgsql\bin'
if (Test-Path (Join-Path $pgBin 'pg_ctl.exe')) {
  $env:POSTGRES_BIN = $pgBin
  Push-Location $root
  try { node repro/postgres.mjs stop | Out-Host } finally { Pop-Location }
}

Write-Host '全部已停止。' -ForegroundColor Green
