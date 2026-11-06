param([string]$JavaHome = '')
$ErrorActionPreference = 'Stop'
$androidRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $androidRoot 'tools/Resolve-JavaHome.ps1')
$JavaHome = Resolve-CalendarJavaHome -JavaHome $JavaHome
$classes = Join-Path $androidRoot 'build/multiple-period-tests'
$jsonJar = Join-Path $androidRoot 'build/test-deps/json-20240303.jar'
if (-not (Test-Path -LiteralPath $jsonJar)) { throw 'Run android/test-webdav.ps1 first to install the checked host JSON dependency.' }
if ((Get-FileHash -LiteralPath $jsonJar -Algorithm SHA256).Hash -ne '3CF6CD6892E32E2B4C1C39E0F52F5248A2F5B37646FDFBB79A66B46B618414ED') { throw 'JSON-java host test dependency checksum mismatch.' }
New-Item -ItemType Directory -Force $classes | Out-Null
$source = Join-Path $androidRoot 'app/src/main/java/app/flexible/calendar'
& "$JavaHome/bin/javac.exe" -encoding UTF-8 -cp $jsonJar -d $classes "$source/Core.java" "$source/JsonCodec.java" "$PSScriptRoot/MultiplePeriodsTest.java" "$PSScriptRoot/ProtocolRoundtrip.java"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$JavaHome/bin/java.exe" '-Dfile.encoding=UTF-8' -cp "$classes;$jsonJar" app.flexible.calendar.MultiplePeriodsTest "$PSScriptRoot/fixtures/multiple-periods.json"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node "$PSScriptRoot/multiple-periods-roundtrip.mjs" "$JavaHome/bin/java.exe" "$classes;$jsonJar"
exit $LASTEXITCODE
