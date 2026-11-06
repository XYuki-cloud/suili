$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Bitmap]::new(560, 560)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$ink = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#233B31'))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#74877A'))
$green = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#EAF1E7'))
$line = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#DDE7DC'), 1)
$titleFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 21, [System.Drawing.FontStyle]::Bold)
$font = [System.Drawing.Font]::new('Microsoft YaHei UI', 14)
$small = [System.Drawing.Font]::new('Microsoft YaHei UI', 11)
try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F4F6F2'))
    $graphics.DrawString('随历 · 月历与四周', $titleFont, $ink, 24, 20)
    $weekdays = @('一', '二', '三', '四', '五', '六', '日')
    for ($column = 0; $column -lt 7; $column++) {
        $graphics.DrawString($weekdays[$column], $font, $muted, (39 + $column * 74), 77)
    }
    for ($row = 0; $row -lt 5; $row++) {
        $y = 112 + $row * 75
        $graphics.FillRectangle($green, 22, $y, 516, 24)
        $graphics.DrawString('本周事项', $small, $muted, 28, ($y + 2))
        for ($column = 0; $column -lt 7; $column++) {
            $x = 22 + $column * 74
            $graphics.DrawRectangle($line, $x, ($y + 24), 72, 49)
            $day = $row * 7 + $column + 1
            if ($day -le 31) { $graphics.DrawString([string]$day, $font, $ink, ($x + 8), ($y + 28)) }
        }
    }
    $graphics.DrawString('预览示意 · 添加后显示本地计划', $small, $muted, 24, 515)
    $output = Join-Path $PSScriptRoot '../app/src/main/res/drawable-nodpi/widget_preview_image.png'
    New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
    $image.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Generated widget preview: $($image.Width) x $($image.Height)"
} finally {
    $graphics.Dispose(); $image.Dispose(); $ink.Dispose(); $muted.Dispose(); $green.Dispose(); $line.Dispose()
    $titleFont.Dispose(); $font.Dispose(); $small.Dispose()
}
