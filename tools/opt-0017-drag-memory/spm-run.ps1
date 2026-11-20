<#
  OPT-0017 一次完整运行编排：护栏 → 启动隔离实例 → 采样 → 驱动 → 收尾 → 复算。

  §1 要求标准包沿用生产应用数据路径，在专用账号或快照 VM 中运行；本脚本用每次专用的
  隔离根（APPDATA/LOCALAPPDATA/WEBVIEW2_USER_DATA_FOLDER 全部指向根内）达成同等效果，
  并在启动前后对真实用户目录做元数据快照，用差异证明未污染用户数据。

  用法：
    ./spm-run.ps1 -Arm A -Exe 'D:\...\app.exe' -Root 'D:\spm-opt0017-runs\A-G1' -Protocol window
  产出：<Root>\evidence\{launch.json,memory-*.csv,memory-*.ticks.csv,gestures.jsonl,probe.jsonl,drive.json,summary.json}

  采样与驱动并行：采样器按 PID 归属整棵树，驱动只发输入与读探针，两者不共享状态。
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Arm = 'A',
  [ValidateSet('smoke', 'window', 'regression')][string]$Protocol = 'window',
  [int]$Port = 9401,
  [int]$IntervalMs = 50,
  [string]$Playwright = 'C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  [switch]$SkipAnalysis
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\process-guard.ps1')
. (Join-Path $PSScriptRoot 'lib\directory-snapshot.ps1')

$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $Root)) { New-Item -ItemType Directory -Force -Path $Root | Out-Null }
[void](Assert-NoForeignSpmusic -OwnedRoots @($Root))

$evidence = Join-Path $Root 'evidence'
$memoryCsv = Join-Path $evidence 'memory-sweep-G.csv'
$launch = $null
$sampler = $null
$driveExit = $null
$startedAt = Get-Date

try {
  Write-Host "[1/5] 启动隔离实例 ..."
  $launchJson = & (Join-Path $PSScriptRoot 'spm-launch.ps1') -Exe $Exe -Root $Root -Arm $Arm -Port $Port
  $launch = ($launchJson | Select-Object -Last 1) | ConvertFrom-Json
  Write-Host ("      pid={0} sha256={1} webview2={2} window={3} maximized={4}" -f $launch.rootPid, $launch.exeSha256.Substring(0, 12), $launch.webview2.browser, $launch.window.clientSize, $launch.window.maximized)

  Write-Host "[2/5] 开始内存采样（$IntervalMs ms，任务管理器口径）..."
  $sampler = Start-Process -FilePath 'pwsh' -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-File', (Join-Path $PSScriptRoot 'spm-sample.ps1'),
    '-RootPid', [string]$launch.rootPid, '-OutCsv', $memoryCsv,
    '-IntervalMs', [string]$IntervalMs, '-DurationSeconds', '1800',
    '-StopFile', (Join-Path $evidence 'sampler.stop')
  )
  $readyFile = [System.IO.Path]::ChangeExtension($memoryCsv, '.ticks.csv')
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $readyFile)) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path -LiteralPath $readyFile)) { throw 'sampler did not produce tick CSV within 20 s' }

  Write-Host "[3/5] 驱动真实拖动（协议 $Protocol）..."
  $env:SPMUSIC_PLAYWRIGHT = $Playwright
  & node (Join-Path $PSScriptRoot 'spm-drive.mjs') --cdp "http://127.0.0.1:$Port" --out $evidence --protocol $Protocol
  $driveExit = $LASTEXITCODE
  Write-Host "      驱动退出码 $driveExit"

  Write-Host "[4/5] 停止采样并收尾 ..."
  Set-Content -LiteralPath (Join-Path $evidence 'sampler.stop') -Value 'stop'
  if ($sampler -and -not $sampler.HasExited) { $sampler.WaitForExit(30000) | Out-Null }
} finally {
  Set-Content -LiteralPath (Join-Path $evidence 'sampler.stop') -Value 'stop' -ErrorAction SilentlyContinue
  if ($sampler -and -not $sampler.HasExited) { try { $sampler.Kill() } catch { } }
  # 只停止本次 spawn 的根 PID：路径与创建时间双重核验，不符即抛错而不是"尽力而为"。
  if ($launch) {
    $spawned = [datetime]::Parse($launch.spawnedAtUtc).ToUniversalTime()
    $disposition = Stop-OwnedProcess -ProcessId $launch.rootPid -ExpectedPathPrefix $Root -ExpectedStartUtc $spawned
    Write-Host "      根进程 $($launch.rootPid): $disposition"
  }
  # 泄漏对照：真实用户目录前后元数据必须一致，差异写入 evidence 供人工解释。
  if ($launch) {
    try {
      $afterSnapshots = Get-RealUserSnapshots
      $comparison = @(Compare-RealUserSnapshots -Before $launch.realUserDirsBefore -After $afterSnapshots)
      $comparison | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence 'real-user-dirs.json') -Encoding utf8
      foreach ($row in $comparison) {
        Write-Host ("      真实目录 {0}: unchanged={1} files {2}->{3} bytes {4}->{5}" -f $row.root, $row.unchanged, $row.before.files, $row.after.files, $row.before.bytes, $row.after.bytes)
      }
    } catch {
      Write-Warning ("真实用户目录对照失败：{0}" -f $_.Exception.Message)
    }
  }
}

Write-Host "[5/5] 复算 ..."
if (-not $SkipAnalysis) {
  & node (Join-Path $PSScriptRoot 'spm-analyze.mjs') --run $Root
}
Write-Host ("完成：{0}（耗时 {1:N1} 分钟）" -f $Root, ((Get-Date) - $startedAt).TotalMinutes)
if ($driveExit -ne 0) { exit $driveExit }
