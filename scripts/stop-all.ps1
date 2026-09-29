# 智算智伴一键停止：关闭 API/前端进程，再停止便携数据库（数据保留）。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '正在停止智算智伴服务 ...' -ForegroundColor Yellow

$sharedEnv = Join-Path $root '.env.reproduction'
$ports = @(53105, 57305)
if (Test-Path $sharedEnv) {
  $configured = Select-String -Path $sharedEnv -Pattern '^XUETU_REPRO_(API|WEB)_PORT=(\d+)$' -ErrorAction SilentlyContinue |
    ForEach-Object { [int]$_.Matches[0].Groups[2].Value }
  if ($configured.Count -eq 2) { $ports = $configured }
}

# 关闭本演示实例记录的 API / 前端端口，不触碰其他端口上的演示实例。
foreach ($port in $ports) {
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
