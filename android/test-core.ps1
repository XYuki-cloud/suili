param([string]$JavaHome = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools/Resolve-JavaHome.ps1')
$JavaHome = Resolve-CalendarJavaHome -JavaHome $JavaHome
$classes = Join-Path $PSScriptRoot 'build\core-tests'
New-Item -ItemType Directory -Force $classes | Out-Null
& "$JavaHome\bin\javac.exe" -encoding UTF-8 -d $classes "$PSScriptRoot\app\src\main\java\app\flexible\calendar\Core.java" "$PSScriptRoot\app\src\main\java\app\flexible\calendar\PlannerAssets.java" "$PSScriptRoot\tests\CoreTest.java" "$PSScriptRoot\tests\PlannerAssetsTest.java"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$JavaHome\bin\java.exe" -cp $classes app.flexible.calendar.CoreTest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$JavaHome\bin\java.exe" -cp $classes app.flexible.calendar.PlannerAssetsTest
exit $LASTEXITCODE
