# Per-role memory sampler for the coverlane harness.
#
# NEW file under tools/thumbnail-benchmark/. It does not replace sample-ui.ps1
# (which stays untouched and is still used by the author's ui-pairs.mjs); it adds
# the reporting shape plan section 4 asks for:
#
#   * main process / renderer / GPU / other are sampled SEPARATELY, because a
#     working-set number for "the app" hides which process grew;
#   * both working set and private bytes are recorded, so the basis is explicit;
#   * a fixed 1 s interval and a caller-chosen duration support the 10 minute
#     window the plan requires;
#   * every sample is appended immediately, so an interrupted run still leaves a
#     usable partial curve.
param(
    [Parameter(Mandatory = $true)][int]$RootProcessId,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [int]$IntervalMs = 1000,
    [int]$DurationSeconds = 620,
    [string]$Label = 'run'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}
$csvPath = Join-Path $OutputDirectory ("memory-{0}.csv" -f $Label)

function Get-OwnedTargets {
    param([int]$RootId)
    $all = @(Get-CimInstance Win32_Process)
    $owned = [System.Collections.Generic.HashSet[int]]::new()
    [void]$owned.Add($RootId)
    do {
        $added = $false
        foreach ($item in $all) {
            if ($owned.Contains([int]$item.ParentProcessId) -and $owned.Add([int]$item.ProcessId)) { $added = $true }
        }
    } while ($added)
    $rows = @()
    foreach ($item in $all) {
        if (-not $owned.Contains([int]$item.ProcessId)) { continue }
        $commandLine = [string]$item.CommandLine
        $role = if ([int]$item.ProcessId -eq $RootId) {
            'main-rust'
        } elseif ($commandLine -match '--type=renderer') {
            'renderer'
        } elseif ($commandLine -match '--type=gpu-process') {
            'gpu'
        } elseif ($commandLine -match '--type=utility') {
            'utility'
        } else {
            'webview-other'
        }
        $rows += [pscustomobject]@{ ProcessId = [int]$item.ProcessId; Role = $role }
    }
    return $rows
}

# Resolve the process tree once; WebView2 child processes are created during
# startup and generally stay for the life of the session.
$targets = @(Get-OwnedTargets -RootId $RootProcessId)
$timer = [System.Diagnostics.Stopwatch]::StartNew()
Set-Content -LiteralPath (Join-Path $OutputDirectory ("sampler-ready-{0}" -f $Label)) -Value 'ready'
$header = 'Milliseconds,ElapsedSeconds,ProcessId,Role,WorkingSetBytes,PrivateBytes'
Set-Content -LiteralPath $csvPath -Value $header

$stopFile = Join-Path $OutputDirectory ("sampler-stop-{0}" -f $Label)
while ($timer.Elapsed.TotalSeconds -lt $DurationSeconds -and -not (Test-Path -LiteralPath $stopFile)) {
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($target in $targets) {
        try {
            $info = [System.Diagnostics.Process]::GetProcessById($target.ProcessId)
            $info.Refresh()
            $workingSet = $info.WorkingSet64
            $privateBytes = $info.PrivateMemorySize64
            $info.Dispose()
            $lines.Add(('{0},{1},{2},{3},{4},{5}' -f `
                [int]$timer.Elapsed.TotalMilliseconds, `
                [math]::Round($timer.Elapsed.TotalSeconds, 3), `
                $target.ProcessId, $target.Role, $workingSet, $privateBytes))
        } catch {
            # A process that exited is recorded as such rather than silently skipped.
            $lines.Add(('{0},{1},{2},{3},exited,exited' -f `
                [int]$timer.Elapsed.TotalMilliseconds, `
                [math]::Round($timer.Elapsed.TotalSeconds, 3), `
                $target.ProcessId, $target.Role))
        }
    }
    Add-Content -LiteralPath $csvPath -Value $lines
    Start-Sleep -Milliseconds $IntervalMs
}
Set-Content -LiteralPath (Join-Path $OutputDirectory ("sampler-done-{0}" -f $Label)) -Value ([string]$timer.Elapsed.TotalSeconds)
