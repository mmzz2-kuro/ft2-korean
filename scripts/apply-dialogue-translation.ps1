param(
  [Parameter(Mandatory = $true)][string]$DatPath,
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$TranslationTsv,
  [Parameter(Mandatory = $true)][string]$OutDat,
  [string]$SourceBin = "",
  [string]$OutBin = "",
  [int]$Fs2Lba = 223,
  [string]$FontPath = "font/NanumSquareRoundR.ttf",
  [string]$WorkDir = "tmp/SLPS-01903/translation-apply",
  [ValidateSet("Single", "AntiAlias")][string]$Mode = "AntiAlias",
  [switch]$InstantDisplay,
  [switch]$TrimToOrigin
)

function ConvertFrom-EscapedTsvField {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return $Value.Replace("\\n", "`n").Replace("\\t", "`t").Replace("\\\\", "\")
}

function Get-RowInt {
  param(
    [object]$Row,
    [string]$Name,
    [int]$Default
  )

  if ($null -eq $Row.PSObject.Properties[$Name]) { return $Default }
  $value = [string]$Row.$Name
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return [int]$value
}

function Read-TranslationRows {
  param([string]$Path)

  $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
  if ($lines.Count -lt 1) {
    throw "translation TSV is empty: $Path"
  }

  $headers = $lines[0] -split "`t", -1
  $rows = New-Object System.Collections.Generic.List[object]

  for ($i = 1; $i -lt $lines.Count; $i++) {
    if ([string]::IsNullOrWhiteSpace($lines[$i])) { continue }
    $values = $lines[$i] -split "`t", -1
    $row = [ordered]@{}
    for ($j = 0; $j -lt $headers.Count; $j++) {
      $value = if ($j -lt $values.Count) { $values[$j] } else { "" }
      $row[$headers[$j]] = ConvertFrom-EscapedTsvField $value
    }
    $rows.Add([pscustomobject]$row)
  }

  return $rows
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$renderScript = Join-Path $scriptDir "render-text-to-message-pgm.ps1"
$patchScript = Join-Path $scriptDir "message-mask-pgm-tool.js"
$injectScript = Join-Path $scriptDir "inject-dat-into-raw-bin.js"
$instantPatchScript = Join-Path $scriptDir "patch-dialogue-instant-display.js"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$resolvedDat = (Resolve-Path -LiteralPath $DatPath).Path
$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$resolvedFont = (Resolve-Path -LiteralPath $FontPath).Path
$outDir = Split-Path -Parent $OutDat
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$rows = Read-TranslationRows $TranslationTsv
$currentDat = $resolvedDat
$applied = 0

foreach ($row in $rows) {
  $messageId = [int]$row.message_id
  if ($null -ne $row.PSObject.Properties["enabled"]) {
    $enabled = [string]$row.enabled
    if ($enabled -eq "0" -or $enabled -eq "false" -or $enabled -eq "False") { continue }
  }
  $text = [string]$row.ko_text
  if ([string]::IsNullOrWhiteSpace($text)) { continue }

  $fontSize = if ([string]::IsNullOrWhiteSpace([string]$row.font_size)) { 16 } else { [int]$row.font_size }
  $lineHeight = if ([string]::IsNullOrWhiteSpace([string]$row.line_height)) { 15 } else { [int]$row.line_height }
  $pad = if ([string]::IsNullOrWhiteSpace([string]$row.pad)) { 1 } else { [int]$row.pad }
  $inkMax = Get-RowInt $row "ink_max" 2
  $threshold = Get-RowInt $row "threshold" 32
  $brightThreshold = Get-RowInt $row "bright_threshold" 96
  $bold = Get-RowInt $row "bold" 0

  $pgmPath = Join-Path $WorkDir ("message-mask-{0}-ko.pgm" -f $messageId)

  $renderArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $renderScript,
    "-FontPath", $resolvedFont,
    "-Text", $text,
    "-OutPath", $pgmPath,
    "-FontSize", $fontSize,
    "-X", 0,
    "-Y", 0,
    "-LineHeight", $lineHeight,
    "-Pad", $pad,
    "-InkMax", $inkMax,
    "-Threshold", $threshold,
    "-BrightThreshold", $brightThreshold,
    "-Bold", $bold,
    "-Mode", $Mode
  )
  if ($TrimToOrigin) {
    $renderArgs += "-TrimToOrigin"
  }
  & powershell @renderArgs
  if ($LASTEXITCODE -ne 0) {
    throw "render failed for message $messageId"
  }

  & node $patchScript patch $currentDat $resolvedExe $OutDat $messageId $pgmPath
  if ($LASTEXITCODE -ne 0) {
    throw "patch failed for message $messageId"
  }

  $currentDat = (Resolve-Path -LiteralPath $OutDat).Path
  $applied++
}

if ($applied -eq 0) {
  Copy-Item -LiteralPath $resolvedDat -Destination $OutDat -Force
}

Write-Output "applied $applied translated rows -> $OutDat"

if (-not [string]::IsNullOrWhiteSpace($SourceBin) -or -not [string]::IsNullOrWhiteSpace($OutBin)) {
  if ([string]::IsNullOrWhiteSpace($SourceBin) -or [string]::IsNullOrWhiteSpace($OutBin)) {
    throw "SourceBin and OutBin must be provided together"
  }
  $resolvedSourceBin = (Resolve-Path -LiteralPath $SourceBin).Path
  & node $injectScript $resolvedSourceBin $OutDat $OutBin --lba $Fs2Lba
  if ($LASTEXITCODE -ne 0) {
    throw "BIN injection failed"
  }
  Write-Output "injected patched DAT into BIN -> $OutBin"

  if ($InstantDisplay) {
    $instantOutBin = Join-Path $WorkDir "instant-display-out.bin"
    & node $instantPatchScript $OutBin $instantOutBin
    if ($LASTEXITCODE -ne 0) {
      throw "instant dialogue display patch failed"
    }
    Move-Item -LiteralPath $instantOutBin -Destination $OutBin -Force
    Write-Output "applied instant dialogue display patch -> $OutBin"
  }
}
