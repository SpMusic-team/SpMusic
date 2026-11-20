param([string]$OutCsv, [int]$RootPid, [int]$Seconds = 120)
# Role-resolved, ownership-filtered sampler in Task Manager's metric (WorkingSetPrivate).
$ErrorActionPreference = 'Continue'
if (Test-Path $OutCsv) { Remove-Item $OutCsv -Force }
'utc,role,mem' | Set-Content $OutCsv
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $perf = @{}
  try {
    Get-CimInstance Win32_PerfRawData_PerfProc_Process -ErrorAction SilentlyContinue | ForEach-Object { $perf[[int]$_.IDProcess] = [int64]$_.WorkingSetPrivate }
  } catch {}
  $all = @()
  try { $all = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('app.exe','msedgewebview2.exe','crashpad_handler.exe') }) } catch {}
  $byId = @{}
  foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
  $lines = @()
  foreach ($p in $all) {
    $cur = [int]$p.ProcessId; $guard = 0
    while ($byId.ContainsKey($cur) -and $guard -lt 12) {
      $par = [int]$byId[$cur].ParentProcessId
      if (-not $byId.ContainsKey($par)) { break }
      $cur = $par; $guard++
    }
    if ($cur -ne $RootPid) { continue }
    $v = $perf[[int]$p.ProcessId]
    if (-not $v) { continue }
    $role = if ($p.Name -eq 'app.exe') { 'app' }
      elseif ($p.Name -eq 'crashpad_handler.exe') { 'crashpad' }
      elseif ($p.CommandLine -match '--type=gpu-process') { 'gpu' }
      elseif ($p.CommandLine -match '--type=renderer') { 'renderer' }
      elseif ($p.CommandLine -match '--type=utility') { 'utility' }
      else { 'browser' }
    $lines += ('{0},{1},{2}' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $role, $v)
  }
  if ($lines.Count -gt 0) { try { $lines | Add-Content $OutCsv } catch {} }
  Start-Sleep -Milliseconds 500
}
'DONE' | Add-Content $OutCsv