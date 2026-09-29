# 智算智伴一键启动：环境检查 -> 依赖 -> 便携数据库 -> API/前端 -> 浏览器。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pgBin = Join-Path $root '.runtime\pg\pgsql\bin'

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' 智算智伴 (408) 一键启动' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# 1. Node 环境检查
try { $nodeVersion = (node --version).Trim() } catch {
  Write-Host '未检测到 Node.js：请先安装 Node.js 24.16 或更高版本（https://nodejs.org）。' -ForegroundColor Red
  exit 1
}
Write-Host "Node $nodeVersion 已就绪" -ForegroundColor Green

# 2. pnpm 检查（由 corepack 自动激活）
try { pnpm --version | Out-Null } catch {
  Write-Host 'pnpm 不可用，尝试 corepack enable ...' -ForegroundColor Yellow
  try {
    corepack enable
    pnpm --version | Out-Null
  } catch {
    Write-Host 'pnpm 激活失败：请在终端手动执行 "corepack enable" 后重试。' -ForegroundColor Red
    exit 1
  }
}
Write-Host 'pnpm 已就绪' -ForegroundColor Green

# 3. 依赖安装（仅首次，需要联网）
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host '首次运行：正在安装依赖（pnpm install，约 1-3 分钟）...' -ForegroundColor Yellow
  Push-Location $root
  try {
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败' }
  } finally { Pop-Location }
  Write-Host '依赖安装完成' -ForegroundColor Green
}

# 4. 便携数据库
if (Test-Port 55435) {
  Write-Host '数据库已在运行 (127.0.0.1:55435)' -ForegroundColor Green
} else {
  if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
    Write-Host "未找到便携数据库二进制：$pgBin" -ForegroundColor Red
    Write-Host '请确认文件夹完整拷贝（应包含 .runtime\pg 目录）。' -ForegroundColor Red
    exit 1
  }
  Write-Host '启动便携 PostgreSQL ...' -ForegroundColor Yellow
  $env:POSTGRES_BIN = $pgBin
  Push-Location $root
  try {
    node repro/postgres.mjs start | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '数据库启动失败' }
  } finally { Pop-Location }
}

# 5. API 与前端（各自独立窗口，关闭本窗口不影响服务）
if (Test-Port 54000) {
  Write-Host 'API 已在运行 (127.0.0.1:54000)' -ForegroundColor Green
} else {
  Start-Process cmd -WorkingDirectory $root -ArgumentList '/k', 'title Xuetu-API && pnpm repro:api'
  Write-Host 'API 启动中 ...' -ForegroundColor Yellow
}
if (Test-Port 57105) {
  Write-Host '前端已在运行 (127.0.0.1:57105)' -ForegroundColor Green
} else {
  Start-Process cmd -WorkingDirectory $root -ArgumentList '/k', 'title Xuetu-Web && pnpm repro:web'
  Write-Host '前端启动中 ...' -ForegroundColor Yellow
}

# 6. 健康检查（最多等 60 秒）
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  if ((Test-Port 54000) -and (Test-Port 57105)) { break }
  Start-Sleep -Seconds 2
}
if ((Test-Port 54000) -and (Test-Port 57105)) {
  Write-Host '全部就绪！正在打开登录页 ...' -ForegroundColor Green
  Start-Process 'http://127.0.0.1:57105/login'
  Write-Host '演示账号：user_student_001 / 12345678' -ForegroundColor Yellow
  Write-Host '教师演示账号见 .repro-accounts.json（仅限本机演示）。' -ForegroundColor DarkYellow
} else {
  Write-Host '部分服务未在 60 秒内就绪，请查看两个命令窗口的输出排查。' -ForegroundColor Red
}
Write-Host ''
Write-Host '演示结束后双击 停止.cmd 可关闭全部服务。' -ForegroundColor DarkGray
