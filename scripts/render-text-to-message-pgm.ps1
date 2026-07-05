param(
  [Parameter(Mandatory = $true)][string]$FontPath,
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$FontSize = 24,
  [int]$X = 8,
  [int]$Y = 10,
  [int]$LineHeight = 0,
  [int]$Pad = 0,
  [ValidateRange(1, 3)][int]$InkMax = 2,
  [ValidateRange(0, 255)][int]$Threshold = 32,
  [ValidateRange(1, 255)][int]$BrightThreshold = 96,
  [ValidateRange(0, 3)][int]$Bold = 0,
  [ValidateSet("Single", "AntiAlias")][string]$Mode = "AntiAlias",
  [switch]$TrimToOrigin
)

Add-Type -AssemblyName System.Drawing

$resolvedFont = Resolve-Path -LiteralPath $FontPath
$outDir = Split-Path -Parent $OutPath
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$bitmap = New-Object System.Drawing.Bitmap 200, 48, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
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
  $font = New-Object System.Drawing.Font $fontFamily, $FontSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  if ($LineHeight -le 0) {
    $LineHeight = [Math]::Ceiling($FontSize * 1.2)
  }

  try {
    $textLines = ($Text -replace "\\n", "`n") -split "`n"
    for ($lineIndex = 0; $lineIndex -lt $textLines.Length; $lineIndex++) {
      $lineY = $Y + ($lineIndex * $LineHeight)
      $graphics.DrawString($textLines[$lineIndex], $font, $brush, ([single]$X), ([single]$lineY))
    }
  } finally {
    $brush.Dispose()
    $font.Dispose()
  }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("P2")
  $lines.Add("# SLPS-01903 generated dialogue mask")
  $lines.Add("200 48")
  $lines.Add("3")

  $minX = 200
  $minY = 48
  $maxX = -1
  $maxY = -1
  if ($TrimToOrigin) {
    for ($py = 0; $py -lt 48; $py++) {
      for ($px = 0; $px -lt 200; $px++) {
        if ($bitmap.GetPixel($px, $py).R -gt 0) {
          if ($px -lt $minX) { $minX = $px }
          if ($py -lt $minY) { $minY = $py }
          if ($px -gt $maxX) { $maxX = $px }
          if ($py -gt $maxY) { $maxY = $py }
        }
      }
    }
  }
  if ($maxX -lt 0) {
    $minX = 0
    $minY = 0
  }

  function Get-SampleValue {
    param(
      [System.Drawing.Bitmap]$Image,
      [int]$X,
      [int]$Y,
      [int]$Radius
    )

    if ($Radius -le 0) {
      if ($X -ge 0 -and $Y -ge 0 -and $X -lt 200 -and $Y -lt 48) {
        return $Image.GetPixel($X, $Y).R
      }
      return 0
    }

    $maxValue = 0
    for ($dy = -$Radius; $dy -le $Radius; $dy++) {
      $sampleY = $Y + $dy
      if ($sampleY -lt 0 -or $sampleY -ge 48) { continue }
      for ($dx = -$Radius; $dx -le $Radius; $dx++) {
        $sampleX = $X + $dx
        if ($sampleX -lt 0 -or $sampleX -ge 200) { continue }
        $sample = $Image.GetPixel($sampleX, $sampleY).R
        if ($sample -gt $maxValue) { $maxValue = $sample }
      }
    }
    return $maxValue
  }

  function Convert-ToPaletteIndex {
    param(
      [int]$Value,
      [int]$MaxIndex,
      [int]$MinInkThreshold,
      [int]$BrightInkThreshold
    )

    if ($Value -lt $MinInkThreshold) { return 0 }
    if ($MaxIndex -le 1) { return 1 }
    if ($MaxIndex -eq 2) {
      if ($Value -ge $BrightInkThreshold) { return 2 }
      return 1
    }

    if ($Value -ge 192) { return 3 }
    if ($Value -ge $BrightInkThreshold) { return 2 }
    return 1
  }

  for ($py = 0; $py -lt 48; $py++) {
    $row = New-Object string[] 200
    for ($px = 0; $px -lt 200; $px++) {
      $sourceX = $px + $minX - $Pad
      $sourceY = $py + $minY - $Pad
      $value = Get-SampleValue $bitmap $sourceX $sourceY $Bold
      $index = Convert-ToPaletteIndex $value $InkMax $Threshold $BrightThreshold
      $row[$px] = [string]$index
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
