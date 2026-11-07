[CmdletBinding()]
param(
    [string]$TestFile,
    [string]$BunPath = $(if ($env:MAGPIE_BUN) { $env:MAGPIE_BUN } else { 'D:/Codex/.cache/magpie/bun/1.4.4/magpie-bun.exe' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $project
try {

if ($TestFile) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $project $TestFile))
    if (-not $targetPath.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Target must stay inside the project.'
    }
    if ([IO.Path]::GetExtension($targetPath) -ne '.mjs' -or [IO.Path]::GetFileName($targetPath) -notlike '*.test.mjs') {
        throw 'TestFile must be a project .test.mjs file.'
    }
    node --check $targetPath
    node --test --test-force-exit $targetPath
}
else {
    $sources = @(Get-ChildItem -LiteralPath $project -File -Filter '*.mjs') +
        @(Get-ChildItem -LiteralPath (Join-Path $project 'lib') -File -Filter '*.mjs') +
        @(Get-ChildItem -LiteralPath (Join-Path $project 'panel') -File | Where-Object { $_.Extension -in @('.js', '.mjs') }) +
        @(Get-ChildItem -LiteralPath (Join-Path $project 'scripts') -File -Filter '*.mjs') +
        @(Get-ChildItem -LiteralPath (Join-Path $project 'test') -File -Filter '*.mjs')
    foreach ($source in $sources) { node --check $source.FullName }
    $tests = @(Get-ChildItem -LiteralPath (Join-Path $project 'test') -File -Filter '*.test.mjs')
    node --test --test-force-exit @($tests.FullName)
    if (-not (Test-Path -LiteralPath $BunPath -PathType Leaf)) { throw "Bun runtime not found: $BunPath" }
    & $BunPath 'test/smoke.mjs'
    & 'D:/Codex/.codex/skills/okf-frontmatter/scripts/run.ps1' --repo $project lint --ci
}
}
finally { Pop-Location }
