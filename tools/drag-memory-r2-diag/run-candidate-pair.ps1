<#
  Paired A/B memory comparison for one candidate.

  Runs the same diagnostic block on the baseline arm and the candidate arm, alternating
  order, and reports the registered metrics side by side. It never kills a process it did
  not start: the process guard refuses while any foreign SpMusic exists.

  Usage:
    ./run-candidate-pair.ps1 -Candidate 'CandB' -CandidateExe <path> -BaselineExe <path> -Pairs 2
#>
param(
  [Parameter(Mandatory)][string]$Candidate,
  [Parameter(Mandatory)][string]$CandidateExe,
  [Parameter(Mandatory)][string]$BaselineExe,
  [ValidateSet('fixed','sweep')][string]$Route = 'sweep',
  [int]$StressSeconds = 120,
  [int]$Pairs = 1,
  [int]$Port = 9890
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process-guard.ps1')
$Diag = 'D:\SpMusic-opt0018-r2-diag'
$Root = Join-Path $Diag ('pairs\' + $Candidate)
if (Test-Path -LiteralPath $Root) { throw "pair root already exists: $Root" }
New-Item -ItemType Directory -Force -Path $Root | Out-Null

$armed = @{
  baseline  = $BaselineExe
  candidate = $CandidateExe
}
foreach ($k in $armed.Keys) {
  if (-not (Test-Path -LiteralPath $armed[$k])) { throw "missing $k exe: $($armed[$k])" }
}
# The isolation patch is a MEASUREMENT prerequisite, not a code change: without it an arm
# ignores THUMB_UI_ROOT / THUMB_UI_PLAYLIST, so "open the list" pops an invisible native file
# dialog and the run records `cannot open list`. A whole pair was lost to this once, so it is
# checked up front instead of being rediscovered as a mysterious open-list failure.
function Assert-ArmIsolated {
  param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string]$Name)
  $release = (Resolve-Path $Exe).Path
  $worktree = $release.Substring(0, $release.LastIndexOf('\'))
  $worktree = $worktree.Substring(0, $worktree.LastIndexOf('\'))
  $worktree = $worktree.Substring(0, $worktree.LastIndexOf('\'))
  $worktree = $worktree.Substring(0, $worktree.LastIndexOf('\'))
  $appPaths = Join-Path $worktree 'src-tauri\src\app_paths.rs'
  $libRs = Join-Path $worktree 'src-tauri\src\lib.rs'
  foreach ($file in @($appPaths, $libRs)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "cannot verify isolation for $Name (missing $file)" }
  }
  $hasRoot = Select-String -Path $appPaths -Pattern 'THUMB_UI_ROOT' -Quiet
  $hasPicker = Select-String -Path $libRs -Pattern 'THUMB_UI_PLAYLIST' -Quiet
  if (-not ($hasRoot -and $hasPicker)) {
    throw "$Name is not isolation-patched (root=$hasRoot picker=$hasPicker); apply coverlane-isolation.patch.mjs first"
  }
}
foreach ($k in $armed.Keys) { Assert-ArmIsolated -Exe $armed[$k] -Name $k }
$ownedRoots = @($armed.Values | ForEach-Object { (Resolve-Path $_).Path.Substring(0, (Resolve-Path $_).Path.LastIndexOf('\')) })
$foreign = Assert-NoForeignSpmusic -OwnedRoots $ownedRoots
if (@($foreign).Count -gt 0) { throw 'unreachable' }

$order = @()
for ($i = 1; $i -le $Pairs; $i++) { $order += $(if ($i % 2 -eq 1) { @('baseline','candidate') } else { @('candidate','baseline') }) }

$results = @()
$n = 0
foreach ($armName in $order) {
  $n += 1
  $label = ('{0:00}-{1}' -f $n, $armName)
  Write-Output ("=== $Candidate pair step $n : $armName ===")
  & (Join-Path $PSScriptRoot 'run-r2-diag-block.ps1') -Label $label `
    -Exe $armed[$armName] -Route $Route -StressSeconds $StressSeconds `
    -WarmSeconds 30 -IdleSeconds 20 -RecoverySeconds 60 `
    -SampleMs 50 -DiagSampleMs 250 -LayerSampleMs 500 -Port $Port | Out-Host
  $peak = Get-Content (Join-Path (Join-Path $Diag ('runs\' + $label)) 'H-peak.json') -Raw | ConvertFrom-Json
  $layers = $null
  $layerPath = Join-Path (Join-Path $Diag ('runs\' + $label)) 'H\layers.json'
  if (Test-Path $layerPath) {
    $lj = Get-Content $layerPath -Raw | ConvertFrom-Json
    if ($lj.samples.Count -gt 0) {
      $areas = $lj.samples | ForEach-Object { $_.areaBoundMiB }
      $layers = [ordered]@{
        samples = $lj.samples.Count
        areaMedian = ($areas | Sort-Object)[[int]($areas.Count / 2)]
        areaMax = ($areas | Measure-Object -Maximum).Maximum
        layersMax = ($lj.samples | ForEach-Object { $_.layers } | Measure-Object -Maximum).Maximum
      }
    }
  }
  $results += [pscustomobject]@{
    step = $n
    arm = $armName
    valid = $peak.valid
    reasons = ($peak.reasons -join ';')
    mainMB = [math]::Round($peak.mainIncrementBytes / 1MB, 1)
    wholeMB = [math]::Round($peak.wholeIncrementBytes / 1MB, 1)
    absMB = [math]::Round($peak.absolutePeak.bytes / 1MB, 1)
    rendererMB = [math]::Round($peak.absolutePeak.byRole.renderer / 1MB, 0)
    gpuMB = [math]::Round($peak.absolutePeak.byRole.'gpu-process' / 1MB, 0)
    appMB = [math]::Round($peak.absolutePeak.byRole.app / 1MB, 0)
    quietMB = [math]::Round($peak.quietBytes / 1MB, 0)
    idleMB = [math]::Round($peak.idleBytes / 1MB, 0)
    layerAreaMedianMiB = if ($layers) { $layers.areaMedian } else { $null }
    layerAreaMaxMiB = if ($layers) { $layers.areaMax } else { $null }
    layersMax = if ($layers) { $layers.layersMax } else { $null }
  }
}

$results | Format-Table -AutoSize | Out-String | Write-Output
$summary = [ordered]@{
  candidate = $Candidate
  route = $Route
  pairs = $Pairs
  baselineExeSha = (Get-FileHash -LiteralPath $BaselineExe -Algorithm SHA256).Hash
  candidateExeSha = (Get-FileHash -LiteralPath $CandidateExe -Algorithm SHA256).Hash
  steps = $results
  finishedUtc = [DateTimeOffset]::UtcNow
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Root 'summary.json') -Encoding utf8
Write-Output ("pair summary: " + (Join-Path $Root 'summary.json'))