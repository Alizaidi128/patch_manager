Add-Type -AssemblyName System.Drawing

$svgPath  = "$PSScriptRoot\icon.svg"
$icoPath  = "$PSScriptRoot\icon.ico"
$pngPath  = "$PSScriptRoot\icon.png"
$trayPath = "$PSScriptRoot\tray-icon.png"

# --- Render SVG → PNG via IE COM object (built-in Windows) ---
# Use .NET WebBrowser control approach: draw via Chromium isn't available here,
# so we use the Inkscape-free approach: load SVG as XML and draw shapes manually.
# Instead, use the simpler approach: convert via MSXML + GDI+

# Best available approach on plain Windows: use System.Windows.Forms.WebBrowser
# But that needs STA thread. Use a simpler method: write an HTML file and use
# CutePDF... Actually, let's use the most reliable built-in: PowerShell + .NET bitmap

# We'll create the icon programmatically using GDI+ drawing
Add-Type -AssemblyName System.Windows.Forms

function New-PatchManagerBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $s = $size / 256.0  # scale factor

    # Background rounded rect gradient
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        [System.Drawing.Point]::new(0,0),
        [System.Drawing.Point]::new($size,$size),
        [System.Drawing.Color]::FromArgb(255,26,111,212),
        [System.Drawing.Color]::FromArgb(255,13,79,160)
    )
    $radius = [int](48 * $s)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $radius*2, $radius*2, 180, 90)
    $path.AddArc($size - $radius*2, 0, $radius*2, $radius*2, 270, 90)
    $path.AddArc($size - $radius*2, $size - $radius*2, $radius*2, $radius*2, 0, 90)
    $path.AddArc(0, $size - $radius*2, $radius*2, $radius*2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $brush.Dispose()

    # Envelope body (white semi-transparent rect)
    $envX = [int](38*$s); $envY = [int](80*$s)
    $envW = [int](180*$s); $envH = [int](120*$s)
    $envBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40,255,255,255))
    $g.FillRectangle($envBrush, $envX, $envY, $envW, $envH)
    $envBrush.Dispose()

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [int](10*$s))
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawRectangle($pen, $envX, $envY, $envW, $envH)

    # Envelope V flap
    $pts = @(
        [System.Drawing.Point]::new($envX, $envY),
        [System.Drawing.Point]::new([int](128*$s), [int](148*$s)),
        [System.Drawing.Point]::new($envX + $envW, $envY)
    )
    $g.DrawLines($pen, $pts)
    $pen.Dispose()

    # Gear badge circle (dark bg)
    $gx = [int](182*$s); $gy = [int](182*$s); $gr = [int](40*$s)
    $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,13,79,160))
    $g.FillEllipse($darkBrush, $gx-$gr, $gy-$gr, $gr*2, $gr*2)
    $darkBrush.Dispose()

    # Gear teeth (8 rectangles rotated)
    $toothBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $toothW = [int](12*$s); $toothH = [int](16*$s)
    $angles = 0,45,90,135,180,225,270,315
    foreach ($angle in $angles) {
        $rad = $angle * [Math]::PI / 180
        $tx  = $gx + [int](($gr - $toothH/2) * [Math]::Sin($rad)) - $toothW/2
        $ty  = $gy - [int](($gr - $toothH/2) * [Math]::Cos($rad)) - $toothW/2
        $g.TranslateTransform($tx + $toothW/2, $ty + $toothW/2)
        $g.RotateTransform($angle)
        $g.FillRectangle($toothBrush, -$toothW/2, -$toothW/2, $toothW, $toothH)
        $g.ResetTransform()
    }
    $toothBrush.Dispose()

    # Gear center hole
    $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,13,79,160))
    $hr = [int](14*$s)
    $g.FillEllipse($holeBrush, $gx-$hr, $gy-$hr, $hr*2, $hr*2)
    $holeBrush.Dispose()
    $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,26,111,212))
    $ir = [int](8*$s)
    $g.FillEllipse($innerBrush, $gx-$ir, $gy-$ir, $ir*2, $ir*2)
    $innerBrush.Dispose()

    $g.Dispose()
    return $bmp
}

# Generate sizes for ICO: 16, 32, 48, 64, 128, 256
$sizes = @(256, 128, 64, 48, 32, 16)
$bitmaps = $sizes | ForEach-Object { New-PatchManagerBitmap $_ }

# Save 256px PNG for display
$bitmaps[0].Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Saved $pngPath"

# Save 32px PNG as tray icon
$bitmaps[4].Save($trayPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Saved $trayPath"

# Build ICO file manually (ICO format)
$ms = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($ms)

# ICO header
$writer.Write([uint16]0)       # reserved
$writer.Write([uint16]1)       # type: ICO
$writer.Write([uint16]$sizes.Count)  # image count

# Collect PNG bytes for each size
$pngBytesArr = @()
foreach ($bmp in $bitmaps) {
    $pngMs = New-Object System.IO.MemoryStream
    $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesArr += ,($pngMs.ToArray())
    $pngMs.Dispose()
}

# Directory entries (each 16 bytes)
$offset = 6 + ($sizes.Count * 16)
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]
    $bdata = $pngBytesArr[$i]
    $writer.Write([byte]$(if($sz -ge 256){0}else{$sz}))  # width  (0=256)
    $writer.Write([byte]$(if($sz -ge 256){0}else{$sz}))  # height (0=256)
    $writer.Write([byte]0)    # color count
    $writer.Write([byte]0)    # reserved
    $writer.Write([uint16]1)  # color planes
    $writer.Write([uint16]32) # bits per pixel
    $writer.Write([uint32]$bdata.Length)
    $writer.Write([uint32]$offset)
    $offset += $bdata.Length
}

# Image data
foreach ($bdata in $pngBytesArr) {
    $writer.Write($bdata)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$ms.Dispose()
$writer.Dispose()

Write-Host "Saved $icoPath"

# Clean up bitmaps
$bitmaps | ForEach-Object { $_.Dispose() }
Write-Host "Done."
