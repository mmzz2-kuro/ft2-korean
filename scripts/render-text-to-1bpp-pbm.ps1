param(
  [Parameter(Mandatory = $true)][string]$FontPath,
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$Width = 256,
  [int]$Height = 64,
  [int]$FontSize = 24,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$LineHeight = 0,
  [int]$Pad = 0,
  [ValidateRange(0, 255)][int]$Threshold = 64,
  [ValidateRange(0, 3)][int]$Bold = 0,
  [ValidateSet("Single", "AntiAlias")][string]$Mode = "AntiAlias",
  [switch]$TrimToOrigin,
  [ValidateRange(1, 8)][int]$Supersample = 4
)

Add-Type -AssemblyName System.Drawing

$resolvedFont = Resolve-Path -LiteralPath $FontPath
$outDir = Split-Path -Parent $OutPath
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

# The final mask is 1 bit per pixel, but naively point-sampling an
# antialiased render at native resolution before thresholding produces
# jagged, uneven-width strokes (worst on dense glyphs like Hangul). Instead,
# render at Supersample-times the target resolution and box-filter (average)
# each output pixel's block down before thresholding.
$superWidth = $Width * $Supersample
$superHeight = $Height * $Supersample

$bitmap = New-Object System.Drawing.Bitmap $superWidth, $superHeight, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$fontCollection = New-Object System.Drawing.Text.PrivateFontCollection

try {
  $graphics.Clear([System.Drawing.Color]::Black)
  $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
  $graphics.TextRenderingHint = if ($Mode -eq "Single") {
    [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  } else {
    [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  }

  $fontCollection.AddFontFile($resolvedFont.Path)
  $fontFamily = $fontCollection.Families[0]
  $superFontSize = $FontSize * $Supersample
  $font = New-Object System.Drawing.Font $fontFamily, $superFontSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  if ($LineHeight -le 0) {
    $LineHeight = [Math]::Ceiling($FontSize * 1.2)
  }
  $superLineHeight = $LineHeight * $Supersample
  $superX = $X * $Supersample
  $superY = $Y * $Supersample

  try {
    $textLines = ($Text -replace "\\n", "`n") -split "`n"
    for ($lineIndex = 0; $lineIndex -lt $textLines.Length; $lineIndex++) {
      $lineY = $superY + ($lineIndex * $superLineHeight)
      $graphics.DrawString($textLines[$lineIndex], $font, $brush, ([single]$superX), ([single]$lineY))
    }
  } finally {
    $brush.Dispose()
    $font.Dispose()
  }

  # Bulk-read pixel bytes via LockBits instead of GetPixel: GetPixel is a
  # per-call marshaling round trip, far too slow once the canvas is
  # supersampled (e.g. 512x512 becomes 2048x2048 = ~4M samples).
  $lockRect = New-Object System.Drawing.Rectangle 0, 0, $superWidth, $superHeight
  $bmpData = $bitmap.LockBits($lockRect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $bmpData.Stride
  $bytes = New-Object byte[] ($stride * $superHeight)
  [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $bytes, 0, $bytes.Length)
  $bitmap.UnlockBits($bmpData)

  $minX = $Width
  $minY = $Height
  $maxX = -1
  if ($TrimToOrigin) {
    for ($py = 0; $py -lt $Height; $py++) {
      $baseY = $py * $Supersample
      for ($px = 0; $px -lt $Width; $px++) {
        $baseX = $px * $Supersample
        $covered = $false
        for ($sy = 0; $sy -lt $Supersample -and -not $covered; $sy++) {
          $rowOffset = ($baseY + $sy) * $stride
          for ($sx = 0; $sx -lt $Supersample; $sx++) {
            if ($bytes[$rowOffset + ($baseX + $sx) * 4 + 2] -gt 0) { $covered = $true; break }
          }
        }
        if ($covered) {
          if ($px -lt $minX) { $minX = $px }
          if ($py -lt $minY) { $minY = $py }
          if ($px -gt $maxX) { $maxX = $px }
        }
      }
    }
  }
  if ($maxX -lt 0) {
    $minX = 0
    $minY = 0
  }

  # Box-filter each output pixel down from its Supersample x Supersample
  # block of the antialiased render. This is what actually removes the
  # jaggedness that point-sampling produced; Bold below is a separate,
  # deliberate stroke-thickening pass applied after downsampling.
  $sampleCount = $Supersample * $Supersample
  $coverage = New-Object 'int[,]' $Width, $Height
  for ($py = 0; $py -lt $Height; $py++) {
    $sourceY = ($py + $minY - $Pad) * $Supersample
    for ($px = 0; $px -lt $Width; $px++) {
      $sourceX = ($px + $minX - $Pad) * $Supersample
      $sum = 0
      for ($sy = 0; $sy -lt $Supersample; $sy++) {
        $sy2 = $sourceY + $sy
        if ($sy2 -lt 0 -or $sy2 -ge $superHeight) { continue }
        $rowOffset = $sy2 * $stride
        for ($sx = 0; $sx -lt $Supersample; $sx++) {
          $sx2 = $sourceX + $sx
          if ($sx2 -lt 0 -or $sx2 -ge $superWidth) { continue }
          $sum += $bytes[$rowOffset + $sx2 * 4 + 2]
        }
      }
      $coverage[$px, $py] = [int]([Math]::Floor($sum / $sampleCount))
    }
  }

  function Get-CoverageMax {
    param(
      [int[,]]$Coverage,
      [int]$Cx,
      [int]$Cy,
      [int]$Radius,
      [int]$CovWidth,
      [int]$CovHeight
    )

    if ($Radius -le 0) {
      if ($Cx -ge 0 -and $Cy -ge 0 -and $Cx -lt $CovWidth -and $Cy -lt $CovHeight) {
        return $Coverage[$Cx, $Cy]
      }
      return 0
    }

    $maxValue = 0
    for ($dy = -$Radius; $dy -le $Radius; $dy++) {
      $yy = $Cy + $dy
      if ($yy -lt 0 -or $yy -ge $CovHeight) { continue }
      for ($dx = -$Radius; $dx -le $Radius; $dx++) {
        $xx = $Cx + $dx
        if ($xx -lt 0 -or $xx -ge $CovWidth) { continue }
        if ($Coverage[$xx, $yy] -gt $maxValue) { $maxValue = $Coverage[$xx, $yy] }
      }
    }
    return $maxValue
  }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("P1")
  $lines.Add("# SLPS-01903 generated 1bpp UI mask, PBM 1 means ink")
  $lines.Add("$Width $Height")

  for ($py = 0; $py -lt $Height; $py++) {
    $row = New-Object string[] $Width
    for ($px = 0; $px -lt $Width; $px++) {
      $value = Get-CoverageMax $coverage $px $py $Bold $Width $Height
      $row[$px] = if ($value -ge $Threshold) { "1" } else { "0" }
    }
    $lines.Add(($row -join " "))
  }

  [System.IO.File]::WriteAllText($OutPath, (($lines -join "`n") + "`n"), [System.Text.Encoding]::ASCII)
  Write-Output "wrote $OutPath"
} finally {
  $fontCollection.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
