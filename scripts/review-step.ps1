param([ValidateSet('check','install','configure','database','restore','auth','api','web','stop')][string]$Step)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..
$root = (Get-Location).Path

function Fail([string]$message) { throw $message }
function Find-Node { (Get-Command node.exe -ErrorAction Stop).Source }
function Find-Pnpm {
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpm) { return @{ Command = $pnpm.Source; Prefix = @() } }
  $corepack = Get-Command corepack.cmd -ErrorAction Stop
  return @{ Command = $corepack.Source; Prefix = @('pnpm') }
}
function Invoke-Pnpm([string[]]$Arguments) {
  $manager = Find-Pnpm
  & $manager.Command @($manager.Prefix + $Arguments)
  if ($LASTEXITCODE -ne 0) { Fail "pnpm 执行失败（退出码 $LASTEXITCODE）。" }
}
function EnvValue([string]$path, [string]$key) {
  $line = Select-String -LiteralPath $path -Pattern ("^" + [regex]::Escape($key) + "=(.*)$") | Select-Object -First 1
  if (-not $line) { Fail "配置文件缺少 $key：$path" }
  return $line.Matches[0].Groups[1].Value
}
function Test-Listening([int]$port) { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1) }
function Test-Free([int]$port) {
  if ($port -lt 1024 -or $port -gt 65535 -or (Test-Listening $port)) { return $false }
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
  try { $listener.Start(); return $true } catch { return $false } finally { if ($listener) { $listener.Stop() } }
}
function Free-Port([int]$preferred, [int[]]$excluded = @()) {
  for ($port = $preferred; $port -le 65535; $port++) { if (($excluded -notcontains $port) -and (Test-Free $port)) { return $port } }
  Fail "从端口 $preferred 开始没有找到可用端口。"
}
function Ensure-Config {
  $envFile = Join-Path $root '.env.reproduction'
  $apiFile = Join-Path $root 'apps\api\.env.local'
  if (-not (Test-Path $envFile)) {
    if (Test-Path $apiFile) { Fail '检测到旧的 apps/api/.env.local，但缺少本机配置。请删除旧配置后重新执行 03-生成配置.cmd。' }
    $node = Find-Node
    & $node (Join-Path $root 'repro\configure.mjs')
    if ($LASTEXITCODE -ne 0) { Fail '生成本机配置失败。' }
  }
  if (-not (Test-Path $apiFile)) { Fail '缺少 apps/api/.env.local，请先执行 03-生成配置.cmd。' }
}
function Ensure-Dependencies {
  if (-not (Test-Path (Join-Path $root 'node_modules\.pnpm'))) { Invoke-Pnpm @('install','--frozen-lockfile') }
}
function Update-Ports {
  Ensure-Config
  $shared = Join-Path $root '.env.reproduction'
  $database = Free-Port ([int](EnvValue $shared 'XUETU_REPRO_DB_PORT'))
  $api = Free-Port ([int](EnvValue $shared 'XUETU_REPRO_API_PORT')) @($database)
  $web = Free-Port ([int](EnvValue $shared 'XUETU_REPRO_WEB_PORT')) @($database, $api)
  $node = Find-Node
  & $node (Join-Path $root 'repro\update-ports.mjs') $database $api $web
  if ($LASTEXITCODE -ne 0) { Fail '更新本机端口配置失败。' }
  return @{ Database = $database; Api = $api; Web = $web }
}
function Start-Window([string]$title, [string]$task) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if ($task -eq 'api') {
    $manager = Find-Pnpm
    $commandPath = $manager.Command
    $arguments = @($manager.Prefix + @('--filter', '@xuetu/api', 'start'))
  } elseif ($task -eq 'web') {
    $commandPath = Find-Node
    $arguments = @((Join-Path $root 'repro\start-web.mjs'))
  } else {
    Fail "未知服务：$task"
  }
  $escapedRoot = $root.Replace("'", "''")
  $escapedCommand = $commandPath.Replace("'", "''")
  $escapedArguments = $arguments | ForEach-Object { "'" + $_.ToString().Replace("'", "''") + "'" }
  $command = "Set-Location -LiteralPath '" + $escapedRoot + "'; & '" + $escapedCommand + "' " + ($escapedArguments -join ' ')
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  Start-Process $ps -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -WindowStyle Normal
  Write-Host "$title 已打开独立窗口。" -ForegroundColor Green
}
function Wait-Listening([int]$port, [string]$title) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-Listening $port) { Write-Host "$title 已就绪：127.0.0.1:$port" -ForegroundColor Green; return }
    Start-Sleep -Seconds 1
  }
  Fail "$title 未能在端口 $port 启动。请查看新打开的 PowerShell 窗口中的错误信息。"
}

if ($Step -eq 'check') {
    if ($root -match '[^\x00-\x7F]') { Fail '当前路径含中文。请将整个文件夹解压到纯英文路径，例如 D:\zhisuan-demo。' }
    $node = Find-Node
    $version = [version]((& $node --version).TrimStart('v'))
    if ($version.Major -ne 24 -or $version -lt [version]'24.14.0') { Fail '请安装 Node.js 24.14.0 或更高的 24.x 版本。' }
    $null = Find-Pnpm
    if (-not (Test-Path (Join-Path $root '.runtime\pg\pgsql\bin\pg_ctl.exe'))) { Fail '压缩包缺少便携 PostgreSQL，请完整解压整个压缩包。' }
    Write-Host "环境检查通过：Node $version、pnpm、便携 PostgreSQL 均可用。" -ForegroundColor Green
} elseif ($Step -eq 'install') {
  Invoke-Pnpm @('install','--frozen-lockfile'); Write-Host '依赖安装完成。' -ForegroundColor Green
} elseif ($Step -eq 'configure') {
  Ensure-Config; Write-Host '本机配置已准备好，不会覆盖已有账号或密码。' -ForegroundColor Green
} elseif ($Step -eq 'database') {
    $node = Find-Node; Ensure-Config; Ensure-Dependencies
    $env:POSTGRES_BIN = Join-Path $root '.runtime\pg\pgsql\bin'
    $status = (& $node (Join-Path $root 'repro\postgres.mjs') status 2>$null | Out-String | ConvertFrom-Json)
    if (-not $status.running) { $ports = Update-Ports } else { $ports = @{ Database = $status.port } }
    & $node (Join-Path $root 'repro\postgres.mjs') start
    if ($LASTEXITCODE -ne 0) { Fail '数据库启动失败，请查看 .runtime/postgres.log。' }
    Write-Host "数据库已就绪：127.0.0.1:$($ports.Database)（只使用本演示包自己的数据库）。" -ForegroundColor Green
} elseif ($Step -eq 'restore') {
    Ensure-Config; Ensure-Dependencies; $node = Find-Node
    if (-not (Test-Path (Join-Path $root '.runtime\repro-postgres\PG_VERSION'))) { Fail '数据库尚未启动，请先执行 04-启动数据库.cmd。' }
    & $node (Join-Path $root 'repro\restore-demo.mjs')
    if ($LASTEXITCODE -ne 0) { Fail '演示数据导入失败。' }
    Write-Host '演示数据导入完成。' -ForegroundColor Green
} elseif ($Step -eq 'auth') {
  Ensure-Config; Ensure-Dependencies; Invoke-Pnpm @('--filter','@xuetu/api','db:seed:auth'); Write-Host '演示账号初始化完成，账号密码见 .repro-accounts.json。' -ForegroundColor Green
} elseif ($Step -eq 'api') {
  Ensure-Config; Ensure-Dependencies
  $port = [int](EnvValue (Join-Path $root '.env.reproduction') 'XUETU_REPRO_API_PORT')
  if (Test-Listening $port) { Fail "API 端口 $port 已被占用；请先关闭占用该端口的程序。" }
  Start-Window 'API' 'api'
  Wait-Listening $port 'API'
} elseif ($Step -eq 'web') {
    Ensure-Config; Ensure-Dependencies
    $apiPort = [int](EnvValue (Join-Path $root '.env.reproduction') 'XUETU_REPRO_API_PORT')
    if (-not (Test-Listening $apiPort)) { Fail 'API 尚未启动，请先运行 07-启动API.cmd 并等待显示已就绪。' }
    $port = [int](EnvValue (Join-Path $root '.env.reproduction') 'XUETU_REPRO_WEB_PORT')
    if (Test-Listening $port) { Fail "网页端口 $port 已被占用；请先关闭占用该端口的程序。" }
    Start-Window '网页' 'web'
    Wait-Listening $port '网页'
    Start-Process "http://127.0.0.1:$port/login"
    Write-Host "网页入口：http://127.0.0.1:$port/login" -ForegroundColor Green
} elseif ($Step -eq 'stop') {
  $stopScript = Join-Path $root "scripts\stop-all.ps1"
  & $stopScript
}
