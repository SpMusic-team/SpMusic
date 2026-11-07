param([int]$RootProcessId, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$allProcesses = @(Get-CimInstance Win32_Process)
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$ownedIds.Add($RootProcessId)
do {
    $added = $false
    foreach ($item in $allProcesses) {
        if ($ownedIds.Contains([int]$item.ParentProcessId) -and $ownedIds.Add([int]$item.ProcessId)) { $added = $true }
    }
} while ($added)
$targets = @($allProcesses | Where-Object { $ownedIds.Contains([int]$_.ProcessId) } | ForEach-Object {
    $role = if ($_.ProcessId -eq $RootProcessId) { 'rust' } elseif ($_.CommandLine -match '--type=renderer') { 'renderer' } elseif ($_.CommandLine -match '--type=gpu-process') { 'gpu' } else { 'webview-other' }
    [pscustomobject]@{ ProcessId = [int]$_.ProcessId; Role = $role }
})
$rows = [System.Collections.Generic.List[object]]::new()
$timer = [System.Diagnostics.Stopwatch]::StartNew()
Set-Content -LiteralPath (Join-Path $OutputDirectory 'sampler-ready') -Value 'ready'
while ($timer.Elapsed.TotalSeconds -lt 90 -and !(Test-Path -LiteralPath (Join-Path $OutputDirectory 'sampler-stop'))) {
    foreach ($target in $targets) {
        try {
            $processInfo = [System.Diagnostics.Process]::GetProcessById($target.ProcessId)
            $processInfo.Refresh()
            $rows.Add([pscustomobject]@{ Milliseconds = $timer.Elapsed.TotalMilliseconds; ProcessId = $target.ProcessId; Role = $target.Role; WorkingSet = $processInfo.WorkingSet64; PrivateBytes = $processInfo.PrivateMemorySize64 })
            $processInfo.Dispose()
        } catch { }
    }
    Start-Sleep -Milliseconds 500
}
$rows | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'memory.csv') -NoTypeInformation
