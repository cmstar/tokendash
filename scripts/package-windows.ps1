$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows 10/11 x64; NSIS installs per user and provisions WebView2 if absent.
# Node.js 20.10+ is discovered at runtime, consistently with the Linux desktop.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$GenDir = Join-Path $RepoRoot 'src-tauri/gen/server'
Push-Location $RepoRoot
try {
    $AppVersion = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    Write-Host '==> Building dashboard and daemon...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard/daemon build failed.' }
    if (!(Test-Path 'dist/daemon.cjs') -or !(Test-Path 'dist/client/menubar.html')) {
        throw 'Missing daemon.cjs or menubar.html after build.'
    }

    Write-Host '==> Staging locked production dependencies...'
    & node 'scripts/stage-server.mjs' $GenDir
    if ($LASTEXITCODE -ne 0) { throw 'Daemon staging failed.' }

    Write-Host '==> Building Windows x64 NSIS installer...'
    # Use a file for the version override: Windows PowerShell native argument
    # quoting otherwise strips JSON string quotes before npx receives them.
    $VersionConfig = Join-Path $RepoRoot 'src-tauri/gen/windows-version.json'
    $VersionJson = @{ version = $AppVersion } | ConvertTo-Json
    [System.IO.File]::WriteAllText($VersionConfig, $VersionJson, [System.Text.UTF8Encoding]::new($false))
    & npx.cmd tauri build --target x86_64-pc-windows-msvc --config 'src-tauri/tauri.windows.conf.json' --config $VersionConfig --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
} finally {
    Pop-Location
}
