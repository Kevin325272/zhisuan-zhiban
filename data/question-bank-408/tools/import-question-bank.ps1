param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [string]$TargetRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$questionBankRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$allowedRawRoot = [IO.Path]::GetFullPath((Join-Path $questionBankRoot "raw"))
$resolvedTargetRoot = if ($TargetRoot) {
  [IO.Path]::GetFullPath($TargetRoot)
} else {
  $allowedRawRoot
}

if (
  $resolvedTargetRoot -ne $allowedRawRoot -and
  -not $resolvedTargetRoot.StartsWith(
    $allowedRawRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )
) {
  throw "TargetRoot must stay inside $allowedRawRoot"
}

$resolvedArchive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) {
  throw "Archive does not exist: $resolvedArchive"
}

$manifestPath = Join-Path $questionBankRoot "manifest.json"
$manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedArchive).Hash.ToLowerInvariant()
$expectedHash = ([string]$manifest.archive_sha256).ToLowerInvariant()
if ($archiveHash -ne $expectedHash) {
  throw "Archive SHA-256 mismatch. Expected $expectedHash but received $archiveHash"
}

$targetDataRoot = [IO.Path]::GetFullPath((Join-Path $resolvedTargetRoot "408_json_data"))
if (Test-Path -LiteralPath $targetDataRoot) {
  throw "Refusing to overwrite existing import: $targetDataRoot"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedArchive)
$stagingRoot = [IO.Path]::GetFullPath(
  (Join-Path $resolvedTargetRoot (".import-" + [Guid]::NewGuid().ToString("N")))
)
$stagingCreated = $false

try {
  if ($archive.Entries.Count -gt 5000) {
    throw "Archive contains too many entries: $($archive.Entries.Count)"
  }

  [long]$totalUncompressed = 0
  foreach ($entry in $archive.Entries) {
    $entryName = $entry.FullName.Replace("\", "/")
    if (
      [string]::IsNullOrWhiteSpace($entryName) -or
      [IO.Path]::IsPathRooted($entryName) -or
      $entryName -match "^[A-Za-z]:" -or
      $entryName -match "(^|/)\.\.(/|$)" -or
      -not $entryName.StartsWith("408_json_data/", [StringComparison]::Ordinal)
    ) {
      throw "Unsafe archive entry: $entryName"
    }

    $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    if ($unixFileType -eq 0xA000) {
      throw "Symbolic-link entries are not allowed: $entryName"
    }
    if ($entry.Length -gt 64MB) {
      throw "Archive entry exceeds the 64 MiB limit: $entryName"
    }
    $totalUncompressed += $entry.Length
    if ($totalUncompressed -gt 512MB) {
      throw "Archive exceeds the 512 MiB uncompressed limit."
    }

    $candidate = [IO.Path]::GetFullPath((Join-Path $stagingRoot $entryName))
    if (-not $candidate.StartsWith(
      $stagingRoot + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      throw "Archive entry escaped the staging directory: $entryName"
    }
  }

  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  $stagingCreated = $true
  foreach ($entry in $archive.Entries) {
    $entryName = $entry.FullName.Replace("\", "/")
    $destination = [IO.Path]::GetFullPath((Join-Path $stagingRoot $entryName))
    if ($entryName.EndsWith("/", [StringComparison]::Ordinal)) {
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
      continue
    }
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    $inputStream = $entry.Open()
    $outputStream = [IO.File]::Open(
      $destination,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    try {
      $inputStream.CopyTo($outputStream)
    } finally {
      $outputStream.Dispose()
      $inputStream.Dispose()
    }
  }

  $stagedDataRoot = Join-Path $stagingRoot "408_json_data"
  $summaryPath = Join-Path $stagedDataRoot "summary.json"
  if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) {
    throw "Imported data is missing summary.json"
  }
  $summary = [IO.File]::ReadAllText($summaryPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if (
    [int]$summary.totals.years -ne [int]$manifest.verified_counts.years -or
    [int]$summary.totals.questions -ne [int]$manifest.verified_counts.questions
  ) {
    throw "Imported summary does not match the tracked manifest."
  }

  $ids = [System.Collections.Generic.HashSet[string]]::new()
  $choiceCount = 0
  $subjectiveCount = 0
  foreach ($year in 2009..2026) {
    $yearPath = Join-Path $stagedDataRoot "$year\$year.json"
    if (-not (Test-Path -LiteralPath $yearPath -PathType Leaf)) {
      throw "Missing yearly question file: $yearPath"
    }
    $document = [IO.File]::ReadAllText($yearPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ([int]$document.year -ne $year -or $document.questions.Count -ne 47) {
      throw "Unexpected year or question count in $yearPath"
    }
    foreach ($question in $document.questions) {
      if (-not $ids.Add([string]$question.id)) {
        throw "Duplicate question id: $($question.id)"
      }
      if ([string]$question.type -eq "choice") {
        $choiceCount += 1
      } elseif ([string]$question.type -eq "subjective") {
        $subjectiveCount += 1
      } else {
        throw "Unsupported question type: $($question.type)"
      }
    }
  }
  if (
    $ids.Count -ne [int]$manifest.verified_counts.questions -or
    $choiceCount -ne [int]$manifest.verified_counts.choice -or
    $subjectiveCount -ne [int]$manifest.verified_counts.subjective
  ) {
    throw "Imported question counts do not match the tracked manifest."
  }

  New-Item -ItemType Directory -Path $resolvedTargetRoot -Force | Out-Null
  Move-Item -LiteralPath $stagedDataRoot -Destination $targetDataRoot
  $report = [ordered]@{
    imported_at = [DateTimeOffset]::UtcNow.ToString("o")
    archive_file = [IO.Path]::GetFileName($resolvedArchive)
    archive_sha256 = $archiveHash
    target = $targetDataRoot
    years = 18
    questions = $ids.Count
    choice = $choiceCount
    subjective = $subjectiveCount
    runtime_storage = "postgresql"
    json_usage = "import_only"
  }
  [IO.File]::WriteAllText(
    (Join-Path $resolvedTargetRoot "import-report.json"),
    ($report | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
  )
  $report
} finally {
  $archive.Dispose()
  if ($stagingCreated -and (Test-Path -LiteralPath $stagingRoot)) {
    $verifiedStaging = [IO.Path]::GetFullPath($stagingRoot)
    if ($verifiedStaging.StartsWith(
      $allowedRawRoot + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      Remove-Item -LiteralPath $verifiedStaging -Recurse -Force
    }
  }
}
