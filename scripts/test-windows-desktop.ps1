param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string]$ExpectedVersion = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Executable = (Resolve-Path $Executable).Path
$TestHome = Join-Path ([System.IO.Path]::GetTempPath()) ('TokenDash smoke 用户 ' + [Guid]::NewGuid().ToString('N'))
$OldHome = $env:HOME
$OldProfile = $env:USERPROFILE
$OldNode = $env:TOKENDASH_NODE
$AppProcess = $null
try {
    New-Item -ItemType Directory -Path $TestHome | Out-Null
    $env:USERPROFILE = $TestHome
    # Deliberately disagree: Windows must follow USERPROFILE like Node does.
    $env:HOME = Join-Path $TestHome 'different-shell-home'
    # Exercise the normal GUI runtime discovery rather than an explicit override.
    Remove-Item Env:TOKENDASH_NODE -ErrorAction SilentlyContinue
    $AppProcess = Start-Process -FilePath $Executable -PassThru
    $Deadline = [DateTime]::UtcNow.AddSeconds(60)
    $PortFile = Join-Path $TestHome '.tokendash/daemon.port'
    $Ready = $false
    $LastFailure = "Waiting for daemon port file: $PortFile"
    while ([DateTime]::UtcNow -lt $Deadline) {
        $AppProcess.Refresh()
        if ($AppProcess.HasExited) { throw "Desktop exited with $($AppProcess.ExitCode) before readiness." }
        if (Test-Path $PortFile) {
            $DaemonPort = [int](Get-Content $PortFile -Raw).Trim()
            try {
                $Info = Invoke-RestMethod "http://127.0.0.1:$DaemonPort/api/app-info" -TimeoutSec 3
                if ($Info.packageName -ne '@zhangferry-dev/tokendash') { throw 'Unexpected daemon identity.' }
                if ($ExpectedVersion -and $Info.version -ne $ExpectedVersion) { throw "Version mismatch: $($Info.version)" }
                $Dashboard = Invoke-WebRequest "http://127.0.0.1:$DaemonPort/" -UseBasicParsing -TimeoutSec 3
                $Panel = Invoke-WebRequest "http://127.0.0.1:$DaemonPort/menubar.html" -UseBasicParsing -TimeoutSec 3
                if ($Dashboard.Content -notmatch '<html' -or $Panel.Content -notmatch '<html') { throw 'Missing packaged frontend.' }
                $Daily = Invoke-RestMethod "http://127.0.0.1:$DaemonPort/api/daily?agent=codex" -TimeoutSec 15
                if ($null -eq $Daily.daily) { throw 'Unexpected daily API response.' }
                $Ready = $true
                break
            } catch {
                $LastFailure = $_.Exception.Message
                Start-Sleep -Milliseconds 500
            }
        } else { Start-Sleep -Milliseconds 500 }
    }
    if (!$Ready) {
        foreach ($LogName in @('desktop-status.log', 'daemon.log')) {
            $LogPath = Join-Path $TestHome ".tokendash/$LogName"
            if (Test-Path $LogPath) { Write-Host "${LogName}: $(Get-Content $LogPath -Raw)" }
        }
        $DaemonScript = Join-Path (Split-Path -Parent $Executable) 'server/dist/daemon.cjs'
        Write-Host "Installed daemon script exists: $(Test-Path $DaemonScript); path: $DaemonScript"
        Write-Host "Node on PATH: $((Get-Command node.exe).Source)"
        throw "Installed desktop readiness failed within 60 seconds. Last failure: $LastFailure"
    }
    if (Test-Path (Join-Path $env:HOME '.tokendash/daemon.port')) { throw 'Desktop used shell HOME instead of USERPROFILE.' }
    Write-Host "Windows desktop smoke passed: version $($Info.version), daemon port $DaemonPort, Unicode/spaces profile, dashboard, panel and API."
} finally {
    if ($null -ne $AppProcess) {
        Start-Process -FilePath taskkill.exe -ArgumentList @("/PID", "$($AppProcess.Id)", "/T", "/F") -Wait -WindowStyle Hidden
    }
    $env:HOME = $OldHome
    $env:USERPROFILE = $OldProfile
    $env:TOKENDASH_NODE = $OldNode
    if (Test-Path $TestHome) { Remove-Item $TestHome -Recurse -Force }
}
