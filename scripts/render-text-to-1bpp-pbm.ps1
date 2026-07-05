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
  [switch]$TrimToOrigin
)

Add-Type -AssemblyName System.Drawing

$resolvedFont = Resolve-Path -LiteralPath $FontPath
$outDir = Split-Path -Parent $OutPath
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$bitmap = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
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

  $minX = $Width
  $minY = $Height
  $maxX = -1
  if ($TrimToOrigin) {
    for ($py = 0; $py -lt $Height; $py++) {
      for ($px = 0; $px -lt $Width; $px++) {
        if ($bitmap.GetPixel($px, $py).R -gt 0) {
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

  function Get-SampleValue {
    param(
      [System.Drawing.Bitmap]$Image,
      [int]$SampleX,
      [int]$SampleY,
      [int]$Radius,
      [int]$ImageWidth,
      [int]$ImageHeight
    )

    if ($Radius -le 0) {
      if ($SampleX -ge 0 -and $SampleY -ge 0 -and $SampleX -lt $ImageWidth -and $SampleY -lt $ImageHeight) {
        return $Image.GetPixel($SampleX, $SampleY).R
      }
      return 0
    }

    $maxValue = 0
    for ($dy = -$Radius; $dy -le $Radius; $dy++) {
      $sy = $SampleY + $dy
      if ($sy -lt 0 -or $sy -ge $ImageHeight) { continue }
      for ($dx = -$Radius; $dx -le $Radius; $dx++) {
        $sx = $SampleX + $dx
        if ($sx -lt 0 -or $sx -ge $ImageWidth) { continue }
        $sample = $Image.GetPixel($sx, $sy).R
        if ($sample -gt $maxValue) { $maxValue = $sample }
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
      $sourceX = $px + $minX - $Pad
      $sourceY = $py + $minY - $Pad
      $value = Get-SampleValue $bitmap $sourceX $sourceY $Bold $Width $Height
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
