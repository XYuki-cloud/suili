# Shared by build and host tests; do not assume a drive letter or a user's SDK layout.
function Resolve-CalendarJavaHome {
    param([string]$JavaHome = '')
    $candidate = if ($JavaHome) { $JavaHome } elseif ($env:JAVA_HOME) { $env:JAVA_HOME } else { '' }
    if ($candidate) {
        if (-not (Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $candidate 'bin/javac.exe') -PathType Leaf)) {
            throw 'The selected Java home must contain bin/java.exe and bin/javac.exe. Set JAVA_HOME or pass -JavaHome with a JDK directory.'
        }
        return (Get-Item -LiteralPath $candidate).FullName
    }
    foreach ($programDirectory in @($env:ProgramW6432, $env:ProgramFiles, [Environment]::GetFolderPath('ProgramFiles')) | Select-Object -Unique) {
        if (-not $programDirectory) { continue }
        $studioJava = Join-Path $programDirectory 'Android/Android Studio/jbr'
        if ((Test-Path -LiteralPath (Join-Path $studioJava 'bin/java.exe') -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $studioJava 'bin/javac.exe') -PathType Leaf)) { return $studioJava }
    }
    $compiler = Get-Command javac.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($compiler) {
        $pathJava = Split-Path -Parent (Split-Path -Parent $compiler.Source)
        if (Test-Path -LiteralPath (Join-Path $pathJava 'bin/java.exe') -PathType Leaf) { return $pathJava }
    }
    throw 'No JDK found. Set JAVA_HOME, pass -JavaHome, or install Android Studio with its bundled JBR.'
}

# Some launchers omit Windows environment variables. Fill only missing values from Windows.
$calendarWindowsDirectory = [Environment]::GetFolderPath('Windows')
if ($calendarWindowsDirectory) {
    if (-not $env:SystemRoot) { $env:SystemRoot = $calendarWindowsDirectory }
    if (-not $env:WINDIR) { $env:WINDIR = $calendarWindowsDirectory }
    if (-not $env:ComSpec) { $env:ComSpec = Join-Path ([Environment]::GetFolderPath('System')) 'cmd.exe' }
}
