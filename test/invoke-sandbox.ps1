param(
    [Parameter(Mandatory = $true)]
    [string]$SandboxRoot
)

$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$resolvedSandbox = [IO.Path]::GetFullPath($SandboxRoot)
if (-not (Test-Path -LiteralPath $resolvedSandbox -PathType Container)) {
    throw "Sandbox root does not exist: $resolvedSandbox"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedSandbox ".codex") -PathType Container)) {
    throw "Sandbox does not look isolated (missing .codex): $resolvedSandbox"
}

$env:HOME = $resolvedSandbox
$env:USERPROFILE = $resolvedSandbox
$env:XDG_CONFIG_HOME = Join-Path $resolvedSandbox ".config"
$env:XDG_CACHE_HOME = Join-Path $resolvedSandbox ".cache"

$magpie = "D:\Apps\magpie\magpie.exe"
if (-not (Test-Path -LiteralPath $magpie -PathType Leaf)) {
    throw "Magpie executable not found: $magpie"
}

& $magpie plugin add $pluginRoot
if ($LASTEXITCODE -ne 0) { throw "magpie plugin add failed: $LASTEXITCODE" }
$env:MAGPIE_EXE = $magpie
node (Join-Path $pluginRoot "scripts/plugin-status.mjs")
if ($LASTEXITCODE -ne 0) { throw "plugin status projection failed: $LASTEXITCODE" }
