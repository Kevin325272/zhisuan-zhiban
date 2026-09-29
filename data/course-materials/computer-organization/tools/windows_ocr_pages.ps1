param(
  [Parameter(Mandatory = $true)][string]$InputManifest,
  [Parameter(Mandatory = $true)][string]$OutputJsonl
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

function Await-WinRt {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$language = New-Object Windows.Globalization.Language("zh-Hans-CN")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
  throw "The zh-Hans-CN Windows OCR recognizer is not available."
}

$manifest = Get-Content -LiteralPath $InputManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$records = New-Object System.Collections.Generic.List[string]

foreach ($entry in $manifest) {
  $stream = $null
  try {
    $file = Await-WinRt (
      [Windows.Storage.StorageFile]::GetFileFromPathAsync($entry.image_path)
    ) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt (
      $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
    ) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRt (
      [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    ) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRt (
      $decoder.GetSoftwareBitmapAsync()
    ) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-WinRt (
      $engine.RecognizeAsync($bitmap)
    ) ([Windows.Media.Ocr.OcrResult])

    $lines = foreach ($line in $result.Lines) {
      $words = foreach ($word in $line.Words) {
        [ordered]@{
          text = $word.Text
          x = [math]::Round($word.BoundingRect.X, 2)
          y = [math]::Round($word.BoundingRect.Y, 2)
          width = [math]::Round($word.BoundingRect.Width, 2)
          height = [math]::Round($word.BoundingRect.Height, 2)
        }
      }
      [ordered]@{
        text = $line.Text
        words = @($words)
      }
    }
    $record = [ordered]@{
      physical_page = [int]$entry.physical_page
      image_path = $entry.image_path
      status = "ok"
      lines = @($lines)
    }
  }
  catch {
    $record = [ordered]@{
      physical_page = [int]$entry.physical_page
      image_path = $entry.image_path
      status = "error"
      error = $_.Exception.Message
      lines = @()
    }
  }
  finally {
    if ($null -ne $stream) {
      $stream.Dispose()
    }
  }
  $records.Add(($record | ConvertTo-Json -Depth 8 -Compress))
}

$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($OutputJsonl, $records, $encoding)
