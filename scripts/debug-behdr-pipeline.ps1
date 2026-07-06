param(
  [Parameter(Mandatory = $true)][string]$DatPath,
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$TranslationTsv,
  [Parameter(Mandatory = $true)][int]$ResourceId,
  [Parameter(Mandatory = $true)][string]$OutDir
)

# Runs the exact same steps as apply-behdr-ui-translation.ps1 for a single
# resource row, but stops after every sub-step to dump a numbered, human-viewable
# PNG of whatever that step produced -- so each stage can be checked by eye
# instead of trusting the pipeline end-to-end. Nothing here changes behavior;
# it's a read-only trace of the same commands the real apply script runs.

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
  if ($lines.Count -le 1) { return @() }
  $headers = $lines[0] -split "`t", -1
  $rows = @()
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
$patchScript = Join-Path $scriptDir "be-hdr-ui-tile-tool.js"
$healScript = Join-Path $scriptDir "heal-behdr-index-holes.js"
$copyScript = Join-Path $scriptDir "copy-behdr-region-offset.js"
$convertScript = Join-Path $scriptDir "convert-pbm-image.py"
$colorizeScript = Join-Path $scriptDir "colorize-behdr-pgm.py"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stagesDir = Join-Path $OutDir "04-patch-stages"
New-Item -ItemType Directory -Force -Path $stagesDir | Out-Null

function Colorize-Pgm {
  param([string]$PgmPath, [string]$PngPath, [int]$Scale = 1)
  if (-not (Test-Path -LiteralPath $PgmPath)) {
    Write-Warning "expected PGM not found: $PgmPath"
    return
  }
  & python $colorizeScript $PgmPath $PngPath $Scale
  if ($LASTEXITCODE -ne 0) { throw "colorize failed for $PgmPath" }
}

function Colorize-Dat {
  param([string]$DatFile, [string]$Label, [int]$Scale = 1)
  $rawDir = Join-Path $OutDir "raw-tmp"
  & node $patchScript dump-raw $DatFile $ExePath $rawDir $ResourceId
  if ($LASTEXITCODE -ne 0) { throw "dump-raw failed for $Label" }
  $pgm = Join-Path $rawDir "be-hdr-ui-$ResourceId-raw.pgm"
  Colorize-Pgm -PgmPath $pgm -PngPath (Join-Path $OutDir "$Label.png") -Scale $Scale
}

$rows = Read-Tsv $TranslationTsv
$row = $rows | Where-Object { [int]$_.resource_id -eq $ResourceId } | Select-Object -First 1
if (-not $row) { throw "resource $ResourceId not found in $TranslationTsv" }

Write-Output "=== resource ${ResourceId}: dumping step-by-step trace into $OutDir ==="

# ---- fields (mirrors apply-behdr-ui-translation.ps1) ----
$replacementPng = [string]$row.replacement_png
$editablePng = [string]$row.editable_png
$customErasePbm = [string]$row.erase_pbm
$threshold = Get-IntField $row "threshold" 64
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
$healFromIndexes = [string]$row.heal_from_indexes
$healRegions2 = [string]$row.heal_regions_2
$healIndexes2 = [string]$row.heal_indexes_2
$healRadius2 = Get-IntField $row "heal_radius_2" 32
$healFromIndexes2 = [string]$row.heal_from_indexes_2
$healRegions3 = [string]$row.heal_regions_3
$healIndexes3 = [string]$row.heal_indexes_3
$healRadius3 = Get-IntField $row "heal_radius_3" 32
$healFromIndexes3 = [string]$row.heal_from_indexes_3
$copyRegions = [string]$row.copy_regions
$copyDy = Get-IntField $row "copy_dy" 0
$copyRegions2 = [string]$row.copy_regions_2
$copyDy2 = Get-IntField $row "copy_dy_2" 0
$copyRegions3 = [string]$row.copy_regions_3
$copyDy3 = Get-IntField $row "copy_dy_3" 0
$referenceFamily = [string]$row.reference_family

# ---- 00: copy source inputs as-is ----
Copy-Item -LiteralPath $editablePng -Destination (Join-Path $OutDir "00-source-editable.png") -Force
Copy-Item -LiteralPath $replacementPng -Destination (Join-Path $OutDir "00-source-replacement-edit.png") -Force
if (-not [string]::IsNullOrWhiteSpace($customErasePbm)) {
  & python $convertScript pbm-to-png $customErasePbm (Join-Path $OutDir "00-source-erase-mask.png")
  if ($LASTEXITCODE -ne 0) { throw "erase mask pbm-to-png failed" }
}

# ---- 01: auto patch-region detection + visual overlay ----
if ($patchRegions -in @("auto", "AUTO", "diff", "DIFF")) {
  $regionOutput = & python $convertScript diff-regions $editablePng $replacementPng 16 8
  if ($LASTEXITCODE -ne 0) { throw "diff-regions failed" }
  $patchRegions = ($regionOutput | Select-Object -Last 1).Trim()
}
Set-Content -LiteralPath (Join-Path $OutDir "01-patch-regions.txt") -Value $patchRegions
if (-not [string]::IsNullOrWhiteSpace($patchRegions)) {
  & python $convertScript draw-regions $editablePng (Join-Path $OutDir "01-patch-regions-overlay.png") $patchRegions
  if ($LASTEXITCODE -ne 0) { throw "draw-regions failed" }
}
Write-Output "01: patch regions -> $(Join-Path $OutDir '01-patch-regions.txt')"

# ---- 02: replacement PNG -> PBM, then clip to patch regions ----
$pngMode = [string]$row.replacement_mode
if ([string]::IsNullOrWhiteSpace($pngMode)) { $pngMode = if ($invert) { "white-on-dark" } else { "black-on-white" } }
$replPbmRaw = Join-Path $OutDir "02a-replacement-unclipped.pbm"
& python $convertScript png-to-pbm $replacementPng $replPbmRaw $threshold $pngMode
if ($LASTEXITCODE -ne 0) { throw "png-to-pbm failed" }
& python $convertScript pbm-to-png $replPbmRaw (Join-Path $OutDir "02a-replacement-unclipped.png")
if ($LASTEXITCODE -ne 0) { throw "pbm-to-png failed" }

$replacementClipFill = if ($invert) { 1 } else { 0 }
$pbmPath = Join-Path $OutDir "02b-replacement-clipped.pbm"
& python $convertScript clip-pbm $replPbmRaw $pbmPath $patchRegions $replacementClipFill
if ($LASTEXITCODE -ne 0) { throw "clip-pbm failed" }
& python $convertScript pbm-to-png $pbmPath (Join-Path $OutDir "02b-replacement-clipped.png")
if ($LASTEXITCODE -ne 0) { throw "pbm-to-png failed" }
Write-Output "02: replacement pbm (unclipped/clipped) -> 02a-*.png / 02b-*.png"

# ---- 03: erase mask clipped to patch regions ----
$erasePbmPath = ""
if (-not [string]::IsNullOrWhiteSpace($customErasePbm)) {
  $erasePbmPath = Join-Path $OutDir "03-erase-clipped.pbm"
  & python $convertScript clip-pbm $customErasePbm $erasePbmPath $patchRegions 0
  if ($LASTEXITCODE -ne 0) { throw "erase clip-pbm failed" }
  & python $convertScript pbm-to-png $erasePbmPath (Join-Path $OutDir "03-erase-clipped.png")
  if ($LASTEXITCODE -ne 0) { throw "pbm-to-png failed" }
  Write-Output "03: clipped erase mask -> 03-erase-clipped.png"
}

# ---- 04: be-hdr-ui-tile-tool.js patch, with internal stage dumps ----
if ($healRegions -in @("auto", "AUTO", "diff", "DIFF")) { $healRegions = $patchRegions }
$stageDat = Join-Path $OutDir "04-after-patch.DAT"
$patchArgs = @($patchScript, "patch", $DatPath, $ExePath, $stageDat, $ResourceId, $pbmPath, "--ink-index", $inkIndex, "--bg-index", $bgIndex, "--source-ink-indexes", $sourceInkIndexes, "--debug-dump-dir", $stagesDir)
if (-not [string]::IsNullOrWhiteSpace($erasePbmPath)) { $patchArgs += @("--erase-pbm", $erasePbmPath) }
if ($lossyFit) { $patchArgs += "--lossy-fit" }
if (-not [string]::IsNullOrWhiteSpace($lossyProtectRegions)) { $patchArgs += @("--lossy-protect-regions", $lossyProtectRegions) }
if (-not [string]::IsNullOrWhiteSpace($healRegions) -and -not [string]::IsNullOrWhiteSpace($healIndexes)) {
  $patchArgs += @("--pre-heal-regions", $healRegions, "--pre-heal-indexes", $healIndexes, "--pre-heal-radius", $healRadius)
  if (-not [string]::IsNullOrWhiteSpace($healFromIndexes)) { $patchArgs += @("--pre-heal-from-indexes", $healFromIndexes) }
}
if (-not [string]::IsNullOrWhiteSpace($healRegions2) -and -not [string]::IsNullOrWhiteSpace($healIndexes2)) {
  $patchArgs += @("--pre-heal-regions-2", $healRegions2, "--pre-heal-indexes-2", $healIndexes2, "--pre-heal-radius-2", $healRadius2)
  if (-not [string]::IsNullOrWhiteSpace($healFromIndexes2)) { $patchArgs += @("--pre-heal-from-indexes-2", $healFromIndexes2) }
}
if (-not [string]::IsNullOrWhiteSpace($healRegions3) -and -not [string]::IsNullOrWhiteSpace($healIndexes3)) {
  $patchArgs += @("--pre-heal-regions-3", $healRegions3, "--pre-heal-indexes-3", $healIndexes3, "--pre-heal-radius-3", $healRadius3)
  if (-not [string]::IsNullOrWhiteSpace($healFromIndexes3)) { $patchArgs += @("--pre-heal-from-indexes-3", $healFromIndexes3) }
}
if (-not [string]::IsNullOrWhiteSpace($referenceFamily)) {
  $patchArgs += @("--reference-dat", $DatPath, "--reference-family", $referenceFamily)
}
if ($invert) { $patchArgs += "--invert" }
& node @patchArgs
if ($LASTEXITCODE -ne 0) { throw "patch failed" }

foreach ($stage in @("04-1-after-unpack", "04-2-after-erase", "04-3-after-ink-draw", "04-4-after-pass1", "04-5-after-pass2", "04-6-after-pass3", "04-7-after-reference-heal")) {
  $pgm = Join-Path $stagesDir "$stage-$ResourceId.pgm"
  Colorize-Pgm -PgmPath $pgm -PngPath (Join-Path $OutDir "$stage.png")
}
Colorize-Dat -DatFile $stageDat -Label "04-8-after-tile-pack"
Write-Output "04: patch() internal stages -> 04-1..04-8 *.png"

# ---- 05/06/07: post-patch broad re-heal passes (reuses pass 1/2/3 settings on the packed DAT) ----
$currentDat = $stageDat
if (-not [string]::IsNullOrWhiteSpace($healRegions) -and -not [string]::IsNullOrWhiteSpace($healIndexes)) {
  $nextDat = Join-Path $OutDir "05-after-post-heal-pass1.DAT"
  $healArgs = @($healScript, $currentDat, $ExePath, $nextDat, $ResourceId, $healRegions, "--indexes", $healIndexes, "--radius", $healRadius)
  if (-not [string]::IsNullOrWhiteSpace($pbmPath)) { $healArgs += @("--keep-pbm", $pbmPath, "--keep-value", 0) }
  & node @healArgs
  if ($LASTEXITCODE -ne 0) { throw "post-heal pass 1 failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "05-after-post-heal-pass1"
  Write-Output "05: post-patch broad heal (pass 1 settings) -> 05-after-post-heal-pass1.png"
}
if (-not [string]::IsNullOrWhiteSpace($healRegions2) -and -not [string]::IsNullOrWhiteSpace($healIndexes2)) {
  $nextDat = Join-Path $OutDir "06-after-post-heal-pass2.DAT"
  $healArgs2 = @($healScript, $currentDat, $ExePath, $nextDat, $ResourceId, $healRegions2, "--indexes", $healIndexes2, "--radius", $healRadius2)
  if (-not [string]::IsNullOrWhiteSpace($healFromIndexes2)) { $healArgs2 += @("--from-indexes", $healFromIndexes2) }
  & node @healArgs2
  if ($LASTEXITCODE -ne 0) { throw "post-heal pass 2 failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "06-after-post-heal-pass2"
  Write-Output "06: post-patch re-heal (pass 2 settings) -> 06-after-post-heal-pass2.png"
}
if (-not [string]::IsNullOrWhiteSpace($healRegions3) -and -not [string]::IsNullOrWhiteSpace($healIndexes3)) {
  $nextDat = Join-Path $OutDir "07-after-post-heal-pass3.DAT"
  $healArgs3 = @($healScript, $currentDat, $ExePath, $nextDat, $ResourceId, $healRegions3, "--indexes", $healIndexes3, "--radius", $healRadius3)
  if (-not [string]::IsNullOrWhiteSpace($healFromIndexes3)) { $healArgs3 += @("--from-indexes", $healFromIndexes3) }
  & node @healArgs3
  if ($LASTEXITCODE -ne 0) { throw "post-heal pass 3 failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "07-after-post-heal-pass3"
  Write-Output "07: post-patch re-heal (pass 3 settings) -> 07-after-post-heal-pass3.png"
}

# ---- 08/09: divider/border-trim region copies ----
if (-not [string]::IsNullOrWhiteSpace($copyRegions) -and $copyDy -ne 0) {
  $nextDat = Join-Path $OutDir "08-after-copy-regions.DAT"
  & node $copyScript $currentDat $ExePath $nextDat $ResourceId $copyRegions "--dy" $copyDy
  if ($LASTEXITCODE -ne 0) { throw "copy_regions failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "08-after-copy-regions"
  Write-Output "08: copy_regions (dy=$copyDy) -> 08-after-copy-regions.png"
}
if (-not [string]::IsNullOrWhiteSpace($copyRegions2) -and $copyDy2 -ne 0) {
  $nextDat = Join-Path $OutDir "09a-after-copy-regions-2.DAT"
  & node $copyScript $currentDat $ExePath $nextDat $ResourceId $copyRegions2 "--dy" $copyDy2
  if ($LASTEXITCODE -ne 0) { throw "copy_regions_2 failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "09a-after-copy-regions-2"
  Write-Output "09a: copy_regions_2 (dy=$copyDy2) -> 09a-after-copy-regions-2.png"
}
if (-not [string]::IsNullOrWhiteSpace($copyRegions3) -and $copyDy3 -ne 0) {
  $nextDat = Join-Path $OutDir "09b-after-copy-regions-3.DAT"
  & node $copyScript $currentDat $ExePath $nextDat $ResourceId $copyRegions3 "--dy" $copyDy3
  if ($LASTEXITCODE -ne 0) { throw "copy_regions_3 failed" }
  $currentDat = $nextDat
  Colorize-Dat -DatFile $currentDat -Label "09b-after-copy-regions-3"
  Write-Output "09b: copy_regions_3 (dy=$copyDy3) -> 09b-after-copy-regions-3.png"
}

Copy-Item -LiteralPath $currentDat -Destination (Join-Path $OutDir "10-final.DAT") -Force
Colorize-Dat -DatFile (Join-Path $OutDir "10-final.DAT") -Label "10-final"

$legend = @"
Color legend used in every *.png in this folder (NOT the real in-game CLUT colors --
this toolchain doesn't decode the PS1 palette, so this is a debug view of pixel
*identity*, not final rendered color):
  black   = index 0 (unused/off-canvas)
  white   = index 1 or 2 (text ink)
  green   = index 3 (erase remnant / stray unfixed pixel -- should NOT appear inside
            a glow row; if it does, that spot was erased but never healed)
  blue    = index 4 (normal unselected background)
  red     = index 224-232 (animated glow-gradient family)
  orange  = index 5,6,7,8,9,14,18,24,68 (border/frame decorative trim marker)
  gray    = anything else / unexpected index
"@
Set-Content -LiteralPath (Join-Path $OutDir "LEGEND.txt") -Value $legend

Write-Output "=== done: $OutDir ==="
