param(
  [Parameter(Mandatory = $true)][string]$TranslationTsv,
  [Parameter(Mandatory = $true)][string]$FontPath,
  [Parameter(Mandatory = $true)][string]$WorkDir,
  [ValidateSet("Single", "AntiAlias")][string]$Mode = "AntiAlias",
  [switch]$TrimToOrigin,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
function U([string]$v) { if ($null -eq $v) { return "" }; $m=[string][char]0xE000; return $v.Replace("\\",$m).Replace("\n","`n").Replace("\t","`t").Replace($m,"\") }
function I($row,[string]$name,[int]$default) { $v=$row.$name; if ([string]::IsNullOrWhiteSpace($v)){return $default}; return [int]$v }
$scriptDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$render=Join-Path $scriptDir "render-text-to-1bpp-pbm.ps1"
$convert=Join-Path $scriptDir "ui-1bpp-png-tool.py"
$rows=Import-Csv -LiteralPath $TranslationTsv -Delimiter "`t" -Encoding UTF8
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$count=0
foreach($row in $rows){
  $text=U ([string]$row.ko_text); if([string]::IsNullOrWhiteSpace($text)){continue}
  $id=[int]$row.resource_id; $w=I $row "width" 256; $h=I $row "height" 64
  $pbm=Join-Path $WorkDir ("ui-mask-{0}-ko-rendered.pbm" -f $id)
  $png=U ([string]$row.replacement_png); if([string]::IsNullOrWhiteSpace($png)){$png=Join-Path $WorkDir ("ui-mask-{0}-ko-edit.png" -f $id)}
  if((Test-Path -LiteralPath $png) -and -not $Force){Write-Output "skip existing edited PNG: $png"; continue}
  $args=@("-ExecutionPolicy","Bypass","-File",$render,"-FontPath",$FontPath,"-Text",$text,"-OutPath",$pbm,"-Width",$w,"-Height",$h,"-FontSize",(I $row "font_size" 24),"-X",0,"-Y",0,"-LineHeight",(I $row "line_height" 24),"-Pad",(I $row "pad" 1),"-Threshold",(I $row "threshold" 64),"-Bold",(I $row "bold" 0),"-Mode",$Mode)
  if($TrimToOrigin){$args+="-TrimToOrigin"}; & powershell @args; if($LASTEXITCODE -ne 0){throw "render failed for $id"}
  & python $convert pbm-to-png $pbm $png; if($LASTEXITCODE -ne 0){throw "PNG conversion failed for $id"}; $count++
}
Write-Output "wrote $count editable PNG files"
