param(
  [Parameter(Mandatory = $true)][string]$DatPath,
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$TranslationTsv,
  [Parameter(Mandatory = $true)][string]$OutDat,
  [string]$SourceBin = "",
  [string]$OutBin = "",
  [int]$Fs2Lba = 223,
  [Parameter(Mandatory = $true)][string]$FontPath,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [ValidateSet("Single", "AntiAlias")][string]$Mode = "AntiAlias",
  [switch]$TrimToOrigin
)

$ErrorActionPreference = "Stop"

function Unescape-TsvValue {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  $marker = [string][char]0xE000
  return $Value.Replace("\\", $marker).Replace("\n", "`n").Replace("\t", "`t").Replace($marker, "\")
}

function Read-Tsv {
  param([string]$Path)
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  if ($lines.Count -eq 0) { return @() }
  $headers = $lines[0] -split "`t", -1
  $rows = @()
  if ($lines.Count -le 1) { return @() }
  foreach ($line in $lines[1..($lines.Count - 1)]) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $values = $line -split "`t", -1
    $row = [ordered]@{}
    for ($i = 0; $i -lt $headers.Count; $i++) {
      $value = ""
      if ($i -lt $values.Count) { $value = $values[$i] }
      $row[$headers[$i]] = Unescape-TsvValue $value
    }
    $rows += [pscustomobject]$row
  }
  return $rows
}

function Get-IntField {
  param($Row, [string]$Name, [int]$Default)
  $value = $Row.$Name
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return [int]$value
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$renderScript = Join-Path $scriptDir "render-text-to-1bpp-pbm.ps1"
$patchScript = Join-Path $scriptDir "ui-1bpp-mask-tool.js"
$injectScript = Join-Path $scriptDir "inject-dat-into-raw-bin.js"
$pngTool = Join-Path $scriptDir "ui-1bpp-png-tool.py"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$rows = Read-Tsv $TranslationTsv
$currentDat = $DatPath
$applied = 0

foreach ($row in $rows) {
  $enabled = [string]$row.enabled
  if ($enabled -in @("0", "false", "False", "")) { continue }
  $text = [string]$row.ko_text
  if ([string]::IsNullOrWhiteSpace($text)) { continue }

  $resourceId = [int]$row.resource_id
  $width = Get-IntField $row "width" 256
  $height = Get-IntField $row "height" 64
  $bytesPerRow = Get-IntField $row "bytes_per_row" ([Math]::Ceiling($width / 8))
  $rowsCount = Get-IntField $row "rows" $height
  $dataOffset = Get-IntField $row "data_offset" 0
  $fontSize = Get-IntField $row "font_size" 24
  $lineHeight = Get-IntField $row "line_height" $fontSize
  $pad = Get-IntField $row "pad" 1
  $threshold = Get-IntField $row "threshold" 64
  $bold = Get-IntField $row "bold" 0

  $pbmPath = Join-Path $WorkDir ("ui-mask-{0}-ko.pbm" -f $resourceId)
  $replacementPng = [string]$row.replacement_png
  if ([string]::IsNullOrWhiteSpace($replacementPng) -or -not (Test-Path -LiteralPath $replacementPng)) {
    $sourceMask = [string]$row.mask_pbm
    if (-not [string]::IsNullOrWhiteSpace($sourceMask)) {
      $automaticPng = Join-Path (Join-Path (Split-Path -Parent $sourceMask) "edit") ("ui-mask-{0}-ko-edit.png" -f $resourceId)
      if (Test-Path -LiteralPath $automaticPng) {
        $replacementPng = $automaticPng
      }
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($replacementPng) -and (Test-Path -LiteralPath $replacementPng)) {
    & python $pngTool png-to-pbm $replacementPng $pbmPath --width $width --height $height --threshold 128
    if ($LASTEXITCODE -ne 0) { throw "edited PNG conversion failed for resource $resourceId" }
    Write-Output "resource ${resourceId}: using edited PNG $replacementPng"
  } else {
    $renderArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $renderScript,
    "-FontPath", $FontPath,
    "-Text", $text,
    "-OutPath", $pbmPath,
    "-Width", $width,
    "-Height", $height,
    "-FontSize", $fontSize,
    "-X", 0,
    "-Y", 0,
    "-LineHeight", $lineHeight,
    "-Pad", $pad,
    "-Threshold", $threshold,
    "-Bold", $bold,
    "-Mode", $Mode
    )
    if ($TrimToOrigin) { $renderArgs += "-TrimToOrigin" }
    & powershell @renderArgs
    if ($LASTEXITCODE -ne 0) { throw "render failed for resource $resourceId" }
  }

  & node $patchScript patch $currentDat $ExePath $OutDat $resourceId $pbmPath --bytes-per-row $bytesPerRow --rows $rowsCount --data-offset $dataOffset
  if ($LASTEXITCODE -ne 0) { throw "patch failed for resource $resourceId" }
  $currentDat = $OutDat
  $applied++
}

if ($applied -eq 0) {
  Copy-Item -LiteralPath $DatPath -Destination $OutDat -Force
}
Write-Output "wrote $OutDat ($applied UI mask rows applied)"

if (-not [string]::IsNullOrWhiteSpace($SourceBin) -and -not [string]::IsNullOrWhiteSpace($OutBin)) {
  $sourceInfo = Get-Item -LiteralPath $SourceBin
  $datInfo = Get-Item -LiteralPath $OutDat
  Write-Output ("source BIN size: {0}, patched DAT size: {1}" -f $sourceInfo.Length, $datInfo.Length)
  if ($sourceInfo.Length -eq $datInfo.Length) {
    Copy-Item -LiteralPath $OutDat -Destination $OutBin -Force
    $outInfo = Get-Item -LiteralPath $OutBin
    Write-Output ("source BIN is DAT-sized; wrote patched DAT payload to {0} ({1} bytes)" -f $OutBin, $outInfo.Length)
  } else {
    & node $injectScript $SourceBin $OutDat $OutBin --lba $Fs2Lba
    if ($LASTEXITCODE -ne 0) { throw "inject failed" }
    $outInfo = Get-Item -LiteralPath $OutBin
    Write-Output ("injected patched DAT into raw BIN -> {0} ({1} bytes)" -f $OutBin, $outInfo.Length)
  }
}
