param([string]$JavaHome = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools/Resolve-JavaHome.ps1')
$JavaHome = Resolve-CalendarJavaHome -JavaHome $JavaHome
$out = Join-Path $PSScriptRoot 'build/widget-tests'
New-Item -ItemType Directory -Path $out -Force | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -d $out (Join-Path $PSScriptRoot 'app/src/main/java/app/flexible/calendar/WidgetPinStatus.java') (Join-Path $PSScriptRoot 'app/src/main/java/app/flexible/calendar/WidgetLayoutPolicy.java') (Join-Path $PSScriptRoot 'tests/WidgetPinStatusTest.java') (Join-Path $PSScriptRoot 'tests/WidgetLayoutPolicyTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Widget pin state test compilation failed' }
& (Join-Path $JavaHome 'bin/java.exe') -cp $out app.flexible.calendar.WidgetPinStatusTest
if ($LASTEXITCODE -ne 0) { throw 'Widget pin state tests failed' }
& (Join-Path $JavaHome 'bin/java.exe') -cp $out app.flexible.calendar.WidgetLayoutPolicyTest
if ($LASTEXITCODE -ne 0) { throw 'Widget layout policy tests failed' }
