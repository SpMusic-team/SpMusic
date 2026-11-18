<#
  R2 A-route diagnostic block.

  One arm, one route, one memory window: this is the shared "A diagnostic" R2 section 4
  asks for before any of B/C/D is implemented. It runs the same stress/settle protocol
  as the R1 memory blocks (so the numbers are comparable), and additionally installs the
  read-only R2 probe so the three decision numbers come out of the same run:

    B -> off-screen mounted cover population, unique URLs, source pixel area
    C -> temporary predecode in-flight peak and duration distribution
    D -> same-URL overlap count and the duplicated running time

  Everything the probe observes is written to <runroot>\<label>\r2diag*.json; nothing in
  the application is modified by it.
#>
param(
  [Parameter(Mandatory)][string]$Label,
  [Parameter(Mandatory)][string]$Exe,
  [string]$RunRoot,
  [ValidateSet('fixed','sweep')][string]$Route = 'sweep',
  [int]$StressSeconds = 120,
  [int]$WarmSeconds = 30,
  [int]$IdleSeconds = 16,
  [int]$RecoverySeconds = 60,
  [int]$SampleMs = 50,
  [int]$Port = 9880,
  [int]$DiagSampleMs = 250,
  [int]$LayerSampleMs = 500
)
$ErrorActionPreference = 'Stop'
# Process-safety guard: never kill by image name, never touch a SpMusic this script did
# not start. Refuses to run while any foreign SpMusic instance exists.
. (Join-Path $PSScriptRoot 'process-guard.ps1')
$Diag = 'D:\SpMusic-opt0018-r2-diag'
$Kit  = 'D:\_work\SpMusic-drag-memory-r1-kit'
$Base = 'D:\SpMusic-opt0018-r1'
$Playlist = Join-Path $Base 'inputs\list.m3u8'
$Expected = Join-Path $Base 'inputs\expected-t2-with-first-variant.json'
$Sampler  = Join-Path $Base 'tools\memory-tree-r1.ps1'
$Runner   = Join-Path $Base 'tools\memory-drag-r1.mjs'
foreach ($p in @($Playlist, $Expected, $Sampler, $Runner, $Exe)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing $p" }
}
# Refuse to measure while the user has their own SpMusic open, and refuse for the same
# reason if any process looks like one of our own arms that outlived an earlier run:
# silently killing it would be the mistake this guard exists to prevent.
$ownedRoots = @((Resolve-Path $Exe).Path.Substring(0, (Resolve-Path $Exe).Path.LastIndexOf('\')))
$foreign = Assert-NoForeignSpmusic -OwnedRoots $ownedRoots
if (@($foreign).Count -gt 0) { throw 'unreachable: guard should have thrown' }
if (-not $RunRoot) { $RunRoot = Join-Path $Diag ('runs\' + $Label) }
if (Test-Path -LiteralPath $RunRoot) { throw "run directory already exists: $RunRoot" }
New-Item -ItemType Directory -Force -Path $RunRoot | Out-Null

# Refuse to measure while a compiler or another node is consuming CPU: R1 section 2.9
# showed these numbers are extremely sensitive to host load.
function Assert-QuietHost {
  $names = 'cargo', 'rustc', 'msbuild', 'link', 'cl'
  $first = @(Get-Process -Name $names -ErrorAction SilentlyContinue |
    Select-Object @{n='Name';e={$_.ProcessName}}, Id, @{n='Cpu';e={$_.TotalProcessorTime.TotalSeconds}})
  if ($first.Count -eq 0) { return }
  Start-Sleep -Milliseconds 750
  $busy = @()
  foreach ($entry in $first) {
    $now = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if (-not $now) { continue }
    if (($now.TotalProcessorTime.TotalSeconds - $entry.Cpu) -gt 0.15) { $busy += "$($entry.Name)#$($entry.Id)" }
  }
  if ($busy.Count -gt 0) { throw ("refusing to measure with build activity: " + ($busy -join ',')) }
}
Assert-QuietHost

$cache = Join-Path $env:LOCALAPPDATA ('spmusic-r2diag-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $cache | Out-Null

$stages = @('G', 'H')
$results = @()
foreach ($stage in $stages) {
  if ($stage -eq 'H') {
    $profile = Join-Path $cache 'webview'
    if (-not (Test-Path -LiteralPath $profile)) { throw 'H needs the prepared G profile' }
    $moved = Join-Path $cache 'webview-preparation'
    if (Test-Path -LiteralPath $moved) { throw 'webview-preparation already exists' }
    Rename-Item -LiteralPath $profile -NewName 'webview-preparation'
  }
  $out = Join-Path $RunRoot $stage
  $warm = if ($stage -eq 'H') { $WarmSeconds } else { 0 }
  $prep = if ($stage -eq 'H') { 'prepared' } else { 'virgin' }
  Assert-QuietHost
  $args = @(
    $Runner,
    '--exe', $Exe,
    '--playlist', $Playlist,
    '--expected', $Expected,
    '--out', $out,
    '--cache-root', $cache,
    '--port', "$Port",
    '--label', $stage,
    '--scenario', $stage,
    '--declared-preparation', $prep,
    '--allow-maximized',
    '--inset-margin', '0',
    '--fraction', '1',
    '--steps', '1',
    '--route', $Route,
    '--stress-seconds', "$StressSeconds",
    '--warm-seconds', "$warm",
    '--idle-seconds', "$IdleSeconds",
    '--recovery-seconds', "$RecoverySeconds",
    '--sample-ms', "$SampleMs",
    '--r2-diag',
    '--r2-diag-sample-ms', "$DiagSampleMs",
    '--layer-probe',
    '--layer-probe-sample-ms', "$LayerSampleMs"
  )
  Push-Location $Kit
  try {
    & node @args 2>&1 | Out-File -FilePath (Join-Path $RunRoot "stage-$stage.log") -Encoding utf8
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  if ($code -ne 0) { throw "stage $stage failed with exit $code; see $RunRoot\stage-$stage.log" }
  $record = Join-Path $out "$stage.json"
  if (-not (Test-Path -LiteralPath $record)) { throw "stage $stage produced no record" }
  & node (Join-Path $Kit 'analyze-drag-peak.mjs') $out $stage | Set-Content -LiteralPath (Join-Path $RunRoot "$stage-peak.json") -Encoding utf8
  $peakCode = $LASTEXITCODE
  $results += [pscustomobject]@{ stage = $stage; peakExit = $peakCode }
  Write-Output "stage $stage recorded (peak exit $peakCode)"
}
[ordered]@{
  label = $Label
  exe = (Get-FileHash -LiteralPath $Exe -Algorithm SHA256).Hash
  exePath = $Exe
  route = $Route
  stressSeconds = $StressSeconds
  warmSeconds = $WarmSeconds
  idleSeconds = $IdleSeconds
  recoverySeconds = $RecoverySeconds
  sampleMs = $SampleMs
  diagSampleMs = $DiagSampleMs
  cacheRoot = $cache
  stages = $results
  finishedUtc = [DateTimeOffset]::UtcNow
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $RunRoot 'manifest.json') -Encoding utf8
Write-Output ("diagnostic block done: " + $RunRoot)
