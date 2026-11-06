param([string]$JavaHome = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools/Resolve-JavaHome.ps1')
$JavaHome = Resolve-CalendarJavaHome -JavaHome $JavaHome
$classes = Join-Path $PSScriptRoot 'build\webdav-tests'
$jsonJar = Join-Path $PSScriptRoot 'build\test-deps\json-20240303.jar'
# JSON-java is a host-test-only dependency, never packaged in the application.
if (-not (Test-Path -LiteralPath $jsonJar)) {
    New-Item -ItemType Directory -Force (Split-Path $jsonJar) | Out-Null
    & curl.exe -fL 'https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar' -o $jsonJar
    if ($LASTEXITCODE -ne 0) { throw 'Download the JSON-java host test dependency from Maven Central, then retry.' }
}
if ((Get-FileHash -LiteralPath $jsonJar -Algorithm SHA256).Hash -ne '3CF6CD6892E32E2B4C1C39E0F52F5248A2F5B37646FDFBB79A66B46B618414ED') { throw 'JSON-java host test dependency checksum mismatch.' }
New-Item -ItemType Directory -Force $classes | Out-Null
$source = Join-Path $PSScriptRoot 'app\src\main\java\app\flexible\calendar'
& "$JavaHome\bin\javac.exe" '-J-Dfile.encoding=UTF-8' -encoding UTF-8 -cp $jsonJar -d $classes "$source\Core.java" "$source\JsonCodec.java" "$source\SyncTransport.java" "$source\WebDavTransport.java" "$source\HttpSyncTransport.java" "$PSScriptRoot\tests\WebDavTransportTest.java"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$JavaHome\bin\java.exe" -cp "$classes;$jsonJar" app.flexible.calendar.WebDavTransportTest
exit $LASTEXITCODE
