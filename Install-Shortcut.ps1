param([string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
$systemDirectory = [Environment]::GetFolderPath('System')
$powershellPath = Join-Path $systemDirectory 'WindowsPowerShell\v1.0\powershell.exe'
$launcherPath = Join-Path $PSScriptRoot 'Start-Calendar.ps1'
if (-not (Test-Path -LiteralPath $DesktopDirectory -PathType Container)) { throw '未找到桌面目录。' }
if (-not (Test-Path -LiteralPath $powershellPath)) { throw '未找到 Windows PowerShell。' }
$shell = New-Object -ComObject WScript.Shell
try {
    foreach ($directory in @($DesktopDirectory, $PSScriptRoot)) {
        $linkPath = Join-Path $directory '随历.lnk'
        if (Test-Path -LiteralPath $linkPath) {
            $existing = $shell.CreateShortcut($linkPath)
            if ($existing.TargetPath -ne $powershellPath -or $existing.Arguments -notlike ('*' + $launcherPath + '*')) {
                throw "已有同名快捷方式且不属于本项目，已保留：$linkPath"
            }
        }
        $link = $shell.CreateShortcut($linkPath)
        $link.TargetPath = $powershellPath
        $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '" -Lan -Background -Open'
        $link.WorkingDirectory = $PSScriptRoot
        $link.Description = '随历：一键启动本地服务并打开日历'
        $link.WindowStyle = 7
        $link.Save()
        Write-Output $linkPath
    }
} finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
