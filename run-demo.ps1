$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Run-Step([string]$label, [string]$command, [string[]]$arguments) {
  Write-Host "[$label]" -ForegroundColor Cyan
  & $command @arguments
  if ($LASTEXITCODE -ne 0) { throw "$label 失败（退出码 $LASTEXITCODE）。请保留当前窗口中的错误信息。" }
}

function Test-ListeningPort([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-PortAvailable([int]$port) {
  if ($port -lt 1024 -or $port -gt 65535 -or (Test-ListeningPort $port)) { return $false }
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

function Select-FreePort([int]$preferred, [int[]]$excluded = @()) {
  for ($candidate = $preferred; $candidate -le 65535; $candidate++) {
    if (($excluded -notcontains $candidate) -and (Test-PortAvailable $candidate)) { return $candidate }
  }
  throw "从端口 $preferred 开始没有找到可用端口。"
}

function Set-EnvValue([string]$path, [string]$key, [string]$value) {
  $text = [System.IO.File]::ReadAllText($path)
  $line = "{0}={1}" -f $key, $value
  $pattern = "(?m)^" + [regex]::Escape($key) + "=.*$"
  if ([regex]::IsMatch($text, $pattern)) {
    $text = [regex]::Replace($text, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
  } else {
    if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += "`n" }
    $text += $line + "`n"
  }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-EnvValue([string]$path, [string]$key) {
  $line = Select-String -Path $path -Pattern ("^" + [regex]::Escape($key) + "=(.*)$") -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { throw "配置文件缺少 $key：$path" }
  return $line.Matches[0].Groups[1].Value
}

function Set-DemoPorts([bool]$ownDatabaseRunning) {
  $sharedEnv = Join-Path $PSScriptRoot '.env.reproduction'
  $apiEnv = Join-Path $PSScriptRoot 'apps\api\.env.local'
  $databasePort = [int](Get-EnvValue $sharedEnv 'XUETU_REPRO_DB_PORT')
  $apiPort = [int](Get-EnvValue $sharedEnv 'XUETU_REPRO_API_PORT')
  $webPort = [int](Get-EnvValue $sharedEnv 'XUETU_REPRO_WEB_PORT')
  if ($ownDatabaseRunning) {
    return @{ Database = $databasePort; Api = $apiPort; Web = $webPort }
  }

  $databasePort = Select-FreePort $databasePort
  Set-EnvValue $sharedEnv 'XUETU_REPRO_DB_PORT' ([string]$databasePort)

  $apiPort = Select-FreePort $apiPort @($databasePort)
  Set-EnvValue $sharedEnv 'XUETU_REPRO_API_PORT' ([string]$apiPort)
  Set-EnvValue $apiEnv 'PORT' ([string]$apiPort)

  $webPort = Select-FreePort $webPort @($databasePort, $apiPort)
  Set-EnvValue $sharedEnv 'XUETU_REPRO_WEB_PORT' ([string]$webPort)

  $databaseUrl = Get-EnvValue $apiEnv 'DATABASE_URL'
  $updatedUrl = [regex]::Replace($databaseUrl, '(@(?:127\.0\.0\.1|localhost):)\d+', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Groups[1].Value + $databasePort })
  if ($updatedUrl -eq $databaseUrl) { throw 'DATABASE_URL 不是本机 PostgreSQL 地址，无法安全切换端口。' }
  Set-EnvValue $apiEnv 'DATABASE_URL' $updatedUrl
  return @{ Database = $databasePort; Api = $apiPort; Web = $webPort }
}

function Test-OwnDemoDatabase([string]$nodePath) {
  $statusOutput = & $nodePath (Join-Path $PSScriptRoot 'repro\postgres.mjs') 'status' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $statusOutput) { return $false }
  try {
    $status = ($statusOutput | Out-String | ConvertFrom-Json)
    return [bool]$status.running
  } catch {
    return $false
  }
}

try {
  if ($PSScriptRoot -match '[^\x00-\x7F]') {
    throw '便携 PostgreSQL 不支持含中文字符的解压路径。请完整解压到纯英文路径，例如 D:\zhisuan-demo，然后再双击 start.cmd。'
  }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $nodeVersion = [version]((& $node --version).TrimStart('v'))
  if ($nodeVersion.Major -ne 24 -or $nodeVersion -lt [version]'24.14.0') {
    throw '请先安装 Node.js 24.14.0 或更高的 24.x 版本，并重新打开命令窗口。'
  }

  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpm) {
    $packageCommand = $pnpm.Source
    $packagePrefix = @()
  } else {
    $corepack = Get-Command corepack.cmd -ErrorAction Stop
    $packageCommand = $corepack.Source
    $packagePrefix = @('pnpm')
  }
  function Run-Pnpm([string]$label, [string[]]$arguments) {
    Run-Step $label $packageCommand ($packagePrefix + $arguments)
  }

  if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\.pnpm'))) {
    Run-Pnpm '安装依赖（首次运行需联网）' @('install', '--frozen-lockfile')
  }
  if (-not (Test-Path (Join-Path $PSScriptRoot '.env.reproduction'))) {
    if (Test-Path (Join-Path $PSScriptRoot 'apps\api\.env.local')) {
      throw '检测到 apps/api/.env.local，但缺少 .env.reproduction。请备份该文件后自行处理，脚本不会覆盖它。'
    }
    Run-Step '生成本机配置' $node @((Join-Path $PSScriptRoot 'repro\configure.mjs'))
  }
  $env:POSTGRES_BIN = Join-Path $PSScriptRoot '.runtime\pg\pgsql\bin'
  if (-not (Test-Path (Join-Path $env:POSTGRES_BIN 'pg_ctl.exe'))) {
    throw '压缩包缺少便携 PostgreSQL。请重新完整解压，不要在压缩包预览窗口运行。'
  }
  $ownDatabaseRunning = Test-OwnDemoDatabase $node
  $ports = Set-DemoPorts $ownDatabaseRunning
  $webPort = [string]$ports.Web
  if ($ownDatabaseRunning) {
    Write-Host '本演示包的数据库已在运行，跳过重复启动。' -ForegroundColor Yellow
  } else {
    try { Run-Step '启动演示数据库' $node @((Join-Path $PSScriptRoot 'repro\postgres.mjs'), 'start') }
    catch {
      $log = Join-Path $PSScriptRoot '.runtime\postgres.log'
      if (Test-Path $log) { Get-Content -LiteralPath $log -Tail 12 | Write-Host }
      throw '演示数据库启动失败。请检查目录是否全英文，以及上方数据库日志。脚本会自动避让已占用端口。'
    }
  }
  if (-not (Test-Path (Join-Path $PSScriptRoot '.runtime\.demo-restored'))) {
    Run-Step '导入演示数据' $node @((Join-Path $PSScriptRoot 'repro\restore-demo.mjs'))
  }
  $env:XUETU_SYNC_DEMO_CREDENTIALS = 'true'
  try { Run-Pnpm '初始化演示账号' @('--filter', '@xuetu/api', 'db:seed:auth') }
  finally { Remove-Item Env:XUETU_SYNC_DEMO_CREDENTIALS -ErrorAction SilentlyContinue }

  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $psExe)) { throw '未找到 Windows PowerShell。' }
  $services = @(
    @{ Task = 'repro:api'; Port = [int]$ports.Api },
    @{ Task = 'repro:web'; Port = [int]$webPort }
  )
  foreach ($service in $services) {
    if (Test-ListeningPort $service.Port) {
      Write-Host ("端口 {0} 已有服务运行，跳过重复启动。" -f $service.Port) -ForegroundColor Yellow
      continue
    }
    $task = $service.Task
    $script = "Set-Location -LiteralPath '$($PSScriptRoot.Replace("'", "''"))'; & '$($packageCommand.Replace("'", "''"))' $($packagePrefix -join ' ') $task"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
  }
  Write-Host ("正在启动服务。浏览器入口：http://127.0.0.1:{0}/login" -f $webPort) -ForegroundColor Green
  Write-Host '账号密码见本目录 .repro-accounts.json；服务日志在新打开的两个窗口中。' -ForegroundColor Green
  Start-Sleep -Seconds 5
  Start-Process ("http://127.0.0.1:{0}/login" -f $webPort)
} catch {
  Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
