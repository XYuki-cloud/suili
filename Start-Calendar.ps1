param([switch]$Lan, [switch]$Background, [switch]$Open, [ValidateRange(1,65535)][int]$Port = 4317)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not $env:SystemRoot) { $env:SystemRoot = [Environment]::GetFolderPath('Windows') }
if (-not $env:WINDIR) { $env:WINDIR = $env:SystemRoot }
$url = "http://127.0.0.1:$Port"
$runtimeDir = Join-Path $PSScriptRoot '.local'
$lockPath = Join-Path $runtimeDir '.server.lock'
$tokenPath = Join-Path $runtimeDir 'token'
$errorLog = Join-Path $runtimeDir 'server.stderr.log'
$mutex = $null
$ownsMutex = $false

function Read-LocalJson([string]$Address) {
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create($Address)
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.Timeout = 1200
        $request.ReadWriteTimeout = 1200
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        return ($reader.ReadToEnd() | ConvertFrom-Json)
    } catch { return $null }
    finally { if ($reader) { $reader.Dispose() }; if ($response) { $response.Dispose() } }
}

function Test-CalendarReady {
    if (-not (Test-Path -LiteralPath $tokenPath)) { return $false }
    $health = Read-LocalJson "$url/api/health"
    if (-not $health -or $health.ok -ne $true -or $health.schemaVersion -ne 1) { return $false }
    $setup = Read-LocalJson "$url/api/setup"
    $expected = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    # Verify this data directory's instance without printing its pairing secret.
    return ($expected.Length -gt 0 -and $setup -and $setup.token -ceq $expected)
}

function Test-PortInUse {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}

try {
    if ($Open) { $Background = $true }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant()))).Replace('-', '') }
    finally { $sha.Dispose() }
    $mutex = New-Object System.Threading.Mutex($false, "Local\SuiliLauncher_$key")
    try { $ownsMutex = $mutex.WaitOne(20000) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw '另一个启动窗口还在处理，请稍后再双击。' }

    if (Test-CalendarReady) {
        if ($Lan) {
            $lanListeners = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $Port -and -not [Net.IPAddress]::IsLoopback($_.Address) })
            if ($lanListeners.Count -eq 0) { throw '现有随历服务仅允许本机访问，手机无法连接。请先关闭原来的服务，再用桌面快捷方式启动。' }
        }
        Write-Output "随历已经运行，已复用现有服务：$url"
    } else {
        if (Test-PortInUse) { throw "端口 $Port 已被其他服务占用，未结束或修改该进程。" }
        if (Test-Path -LiteralPath $lockPath) {
            $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            $ownerId = 0
            if (-not [int]::TryParse([string]$owner.pid, [ref]$ownerId) -or $ownerId -le 0) { throw "锁文件无法确认，已保留：$lockPath" }
            if (Get-Process -Id $ownerId -ErrorAction SilentlyContinue) { throw "原服务进程 $ownerId 仍存在，但暂时没有响应。请稍后重试；未强制结束进程或删除数据。" }
            # Only remove the known lock after proving its owner is gone and the port is unused.
            Remove-Item -LiteralPath $lockPath
        }
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw '未找到 Node.js。请安装 Node.js 22 或更新版本，然后重新双击快捷方式。' }
        $nodePath = $nodeCommand.Source
        $nodeArgs = @('server/server.mjs', '--port', "$Port")
        if ($Lan) { $nodeArgs += '--lan' }
        if ($Background) {
            $process = Start-Process -FilePath $nodePath -ArgumentList $nodeArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'server.stdout.log') -RedirectStandardError $errorLog -PassThru
            $timer = [Diagnostics.Stopwatch]::StartNew()
            $ready = $false
            while ($timer.Elapsed.TotalSeconds -lt 15) {
                $process.Refresh()
                if ($process.HasExited) { break }
                if (Test-CalendarReady) { $ready = $true; break }
                Start-Sleep -Milliseconds 200
            }
            if (-not $ready) {
                $tail = if (Test-Path -LiteralPath $errorLog) { (Get-Content -LiteralPath $errorLog -Tail 5) -join "`n" } else { '' }
                throw "服务未能就绪。日志：$errorLog`n$tail"
            }
            $process.Id | Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid')
            Write-Output "随历后台服务已启动：$url"
        } else {
            $mutex.ReleaseMutex(); $ownsMutex = $false
            & $nodePath @nodeArgs
            exit $LASTEXITCODE
        }
    }
    if ($Open) { Start-Process -FilePath $url }
} catch {
    $message = "随历启动失败：$($_.Exception.Message)"
    if ($Open) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, '随历', 'OK', 'Error') | Out-Null
    }
    Write-Error $message -ErrorAction Continue
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
