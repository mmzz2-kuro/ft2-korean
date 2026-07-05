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

function Get-BoolField {
  param($Row, [string]$Name, [bool]$Default)
  $value = [string]$Row.$Name
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value -in @("1", "true", "True", "yes", "YES")
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$renderScript = Join-Path $scriptDir "render-text-to-1bpp-pbm.ps1"
$patchScript = Join-Path $scriptDir "be-hdr-ui-tile-tool.js"
$healScript = Join-Path $scriptDir "heal-behdr-index-holes.js"
$restoreInkScript = Join-Path $scriptDir "restore-behdr-replacement-ink.js"
$injectScript = Join-Path $scriptDir "inject-dat-into-raw-bin.js"
$extractScript = Join-Path $scriptDir "extract-dat-from-raw-bin.js"
$convertScript = Join-Path $scriptDir "convert-pbm-image.py"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$rows = Read-Tsv $TranslationTsv
$currentDat = $DatPath
if ([System.IO.Path]::GetExtension($DatPath).ToLowerInvariant() -eq ".bin") {
  $extractedDat = Join-Path $WorkDir "extracted-FS2_FILE.DAT"
  & node $extractScript $DatPath $extractedDat --lba $Fs2Lba
  if ($LASTEXITCODE -ne 0) { throw "extract DAT from BIN failed" }
  $currentDat = $extractedDat
  if ([string]::IsNullOrWhiteSpace($SourceBin)) {
    $SourceBin = $DatPath
  }
}
$applied = 0

foreach ($row in $rows) {
  $enabled = [string]$row.enabled
  if ($enabled -in @("0", "false", "False", "")) { continue }
  $text = [string]$row.ko_text
  $replacementPbm = [string]$row.replacement_pbm
  $replacementPng = [string]$row.replacement_png
  $customErasePbm = [string]$row.erase_pbm
  if ([string]::IsNullOrWhiteSpace($text) -and [string]::IsNullOrWhiteSpace($replacementPbm) -and [string]::IsNullOrWhiteSpace($replacementPng)) { continue }

  $resourceId = [int]$row.resource_id
  $width = Get-IntField $row "width" 128
  $height = Get-IntField $row "height" 48
  $fontSize = Get-IntField $row "font_size" 24
  $lineHeight = Get-IntField $row "line_height" $fontSize
  $pad = Get-IntField $row "pad" 1
  $threshold = Get-IntField $row "threshold" 64
  $bold = Get-IntField $row "bold" 0
  $invert = Get-BoolField $row "invert" $true
  $sourceInkIndexes = [string]$row.source_ink_indexes
  if ([string]::IsNullOrWhiteSpace($sourceInkIndexes)) { $sourceInkIndexes = "224-232" }
  $inkIndex = Get-IntField $row "ink_index" 232
  $bgIndex = Get-IntField $row "bg_index" 3
  $patchRegions = [string]$row.patch_regions
  $lossyFit = Get-BoolField $row "lossy_fit" $false
  $lossyProtectRegions = [string]$row.lossy_protect_regions
  $healRegions = [string]$row.heal_regions
  $healIndexes = [string]$row.heal_indexes
  $healRadius = Get-IntField $row "heal_radius" 32

  $pbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-ko.pbm" -f $resourceId)
  $erasePbmPath = ""
  $nextDat = $OutDat

  if (-not [string]::IsNullOrWhiteSpace($replacementPbm)) {
    $pbmPath = $replacementPbm
    Write-Output "resource $resourceId uses replacement PBM: $pbmPath"
  } elseif (-not [string]::IsNullOrWhiteSpace($replacementPng)) {
    $pbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-replacement.pbm" -f $resourceId)
    $pngMode = [string]$row.replacement_mode
    if ([string]::IsNullOrWhiteSpace($pngMode)) {
      $pngMode = if ($invert) { "white-on-dark" } else { "black-on-white" }
    }
    if ($patchRegions -in @("auto", "AUTO", "diff", "DIFF")) {
      $editablePng = [string]$row.editable_png
      if ([string]::IsNullOrWhiteSpace($editablePng)) {
        throw "resource $resourceId patch_regions=auto requires editable_png"
      }
      $regionOutput = & python $convertScript diff-regions $editablePng $replacementPng 16 8
      if ($LASTEXITCODE -ne 0) { throw "auto patch region detection failed for resource $resourceId" }
      $patchRegions = ($regionOutput | Select-Object -Last 1).Trim()
      if ([string]::IsNullOrWhiteSpace($patchRegions)) {
        Write-Output "resource $resourceId replacement PNG has no detected differences; skipping row"
        continue
      }
      Write-Output "resource $resourceId auto patch regions: $patchRegions"
    }
    & python $convertScript png-to-pbm $replacementPng $pbmPath $threshold $pngMode
    if ($LASTEXITCODE -ne 0) { throw "PNG to PBM conversion failed for resource $resourceId" }
    Write-Output "resource $resourceId uses replacement PNG: $replacementPng ($pngMode)"
    if (-not [string]::IsNullOrWhiteSpace($patchRegions)) {
      $clippedPbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-replacement-clipped.pbm" -f $resourceId)
      $replacementClipFill = if ($invert) { 1 } else { 0 }
      & python $convertScript clip-pbm $pbmPath $clippedPbmPath $patchRegions $replacementClipFill
      if ($LASTEXITCODE -ne 0) { throw "PBM region clip failed for resource $resourceId" }
      $pbmPath = $clippedPbmPath
      Write-Output "resource $resourceId replacement clipped to regions: $patchRegions"
    }
    if (-not [string]::IsNullOrWhiteSpace($customErasePbm)) {
      $erasePbmPath = $customErasePbm
      Write-Output "resource $resourceId uses custom erase PBM: $erasePbmPath"
      if (-not [string]::IsNullOrWhiteSpace($patchRegions)) {
        $clippedErasePbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-erase-clipped.pbm" -f $resourceId)
        & python $convertScript clip-pbm $erasePbmPath $clippedErasePbmPath $patchRegions 0
        if ($LASTEXITCODE -ne 0) { throw "custom erase PBM region clip failed for resource $resourceId" }
        $erasePbmPath = $clippedErasePbmPath
      }
    } elseif ($pngMode -eq "white-on-dark") {
      $erasePbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-erase.pbm" -f $resourceId)
      & python $convertScript png-to-pbm $replacementPng $erasePbmPath $threshold "dark-region"
      if ($LASTEXITCODE -ne 0) { throw "PNG erase mask conversion failed for resource $resourceId" }
      if (-not [string]::IsNullOrWhiteSpace($patchRegions)) {
        $clippedErasePbmPath = Join-Path $WorkDir ("be-hdr-ui-{0}-erase-clipped.pbm" -f $resourceId)
        & python $convertScript clip-pbm $erasePbmPath $clippedErasePbmPath $patchRegions 0
        if ($LASTEXITCODE -ne 0) { throw "erase PBM region clip failed for resource $resourceId" }
        $erasePbmPath = $clippedErasePbmPath
      }
    }
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

  if ($healRegions -in @("auto", "AUTO", "diff", "DIFF")) {
    $healRegions = $patchRegions
  }

  $patchArgs = @($patchScript, "patch", $currentDat, $ExePath, $nextDat, $resourceId, $pbmPath, "--ink-index", $inkIndex, "--bg-index", $bgIndex, "--source-ink-indexes", $sourceInkIndexes)
  if (-not [string]::IsNullOrWhiteSpace($erasePbmPath)) { $patchArgs += @("--erase-pbm", $erasePbmPath) }
  if ($lossyFit) { $patchArgs += "--lossy-fit" }
  if (-not [string]::IsNullOrWhiteSpace($lossyProtectRegions)) { $patchArgs += @("--lossy-protect-regions", $lossyProtectRegions) }
  if (-not [string]::IsNullOrWhiteSpace($healRegions) -and -not [string]::IsNullOrWhiteSpace($healIndexes)) {
    $patchArgs += @("--pre-heal-regions", $healRegions, "--pre-heal-indexes", $healIndexes, "--pre-heal-radius", $healRadius)
  }
  if ($invert) { $patchArgs += "--invert" }
  & node @patchArgs
  if ($LASTEXITCODE -ne 0) { throw "patch failed for resource $resourceId" }
  if (-not [string]::IsNullOrWhiteSpace($healRegions) -and -not [string]::IsNullOrWhiteSpace($healIndexes)) {
    $healArgs = @($healScript, $nextDat, $ExePath, $nextDat, $resourceId, $healRegions, "--indexes", $healIndexes, "--radius", $healRadius)
    if (-not [string]::IsNullOrWhiteSpace($pbmPath)) {
      $healArgs += @("--keep-pbm", $pbmPath, "--keep-value", 0)
    }
    & node @healArgs
    if ($LASTEXITCODE -ne 0) { throw "heal failed for resource $resourceId" }
  }
  if ($lossyFit -and -not [string]::IsNullOrWhiteSpace($lossyProtectRegions) -and -not [string]::IsNullOrWhiteSpace($pbmPath)) {
    $restoreArgs = @($restoreInkScript, $nextDat, $ExePath, $nextDat, $resourceId, $pbmPath, $lossyProtectRegions, "--ink-index", $inkIndex)
    if ($invert) { $restoreArgs += "--invert" }
    & node @restoreArgs
    if ($LASTEXITCODE -ne 0) { throw "replacement ink restore failed for resource $resourceId" }
  }
  $currentDat = $nextDat
  $applied++
}

if ($applied -eq 0) {
  Copy-Item -LiteralPath $currentDat -Destination $OutDat -Force
}
Write-Output "wrote $OutDat ($applied be-hdr UI rows applied)"

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
