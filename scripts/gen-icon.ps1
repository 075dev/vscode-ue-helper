# scripts/gen-icon.ps1 —— 生成 128×128 深蓝渐变 + UE 金字图标的 PNG
Add-Type -AssemblyName System.Drawing

$size = 128
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'

# 1. 背景: 深蓝渐变
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 30, 60, 110),
    [System.Drawing.Color]::FromArgb(255, 10, 25, 50),
    45.0
)
$g.FillRectangle($bgBrush, $rect)

# 2. 内边框（高亮描边）
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 240, 200, 80)), 2
$g.DrawRectangle($borderPen, 4, 4, ($size - 8), ($size - 8))

# 3. UE 金色字
$font = New-Object System.Drawing.Font('Segoe UI', 56, [System.Drawing.FontStyle]::Bold)
$fgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 200, 80))
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment     = 'Center'
$fmt.LineAlignment = 'Center'
$g.DrawString('UE', $font, $fgBrush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $fmt)

# 4. 底部小字 "Helper"
$smallFont = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$smallBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 200, 220, 255))
$smallFmt = New-Object System.Drawing.StringFormat
$smallFmt.Alignment     = 'Center'
$smallFmt.LineAlignment = 'Center'
$g.DrawString('HELPER', $smallFont, $smallBrush, (New-Object System.Drawing.RectangleF 0, 96, $size, 24), $smallFmt)

$out = "$PSScriptRoot\..\resources\icon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# 输出验证信息
$info = Get-Item $out
Write-Host "Generated: $($info.FullName)"
Write-Host "Size: $($info.Length) bytes"
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($info.FullName)
Write-Host "Width: $($img.Width), Height: $($img.Height), Format: $($img.RawFormat)"
$img.Dispose()