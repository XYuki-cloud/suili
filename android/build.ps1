param([string]$JavaHome = '', [string]$Gradle = '', [switch]$Online)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools/Resolve-JavaHome.ps1')
$env:JAVA_HOME = Resolve-CalendarJavaHome -JavaHome $JavaHome
if (-not $Gradle) {
    $Gradle = Join-Path $PSScriptRoot 'gradlew.bat'
}
if (-not (Test-Path -LiteralPath $Gradle -PathType Leaf)) { throw 'Gradle wrapper is missing. Pass -Gradle path\to\gradle.bat.' }
$Gradle = (Get-Item -LiteralPath $Gradle).FullName
Push-Location $PSScriptRoot
try {
    $gradleArguments = @('--no-daemon', ':app:assembleDebug')
    if (-not $Online) { $gradleArguments = @('--offline') + $gradleArguments }
    & $Gradle @gradleArguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
