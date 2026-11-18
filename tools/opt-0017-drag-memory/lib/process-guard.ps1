# ---------------------------------------------------------------------------
# 进程护栏（从 tools/drag-memory-r2-diag/process-guard.ps1 派生，规则不变）：
#   1. 启动前探测：只要存在**不属于本次实验根**的 SpMusic 进程，立即拒绝运行。
#      不碰它、不杀它，把决定权交回用户。
#   2. 收尾只按 PID：本次 spawn 出来的 PID 写入 manifest，退出时只处理这些 PID，
#      且停止前复核可执行文件路径仍在本实验根内、创建时间与登记一致。
#   3. 全脚本不出现任何按镜像名匹配的 Stop-Process / taskkill。
#
# OPT-0017 §1 要求每个参测臂使用隔离根；本文件是该要求的执行点。
# ---------------------------------------------------------------------------
function Get-SpmusicProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('app.exe', 'spmusic.exe', 'SpMusic.exe') -or
      ($_.ExecutablePath -and $_.ExecutablePath -match 'SpMusic')
    } |
    ForEach-Object {
      [pscustomobject]@{
        Pid       = [int]$_.ProcessId
        Name      = $_.Name
        Path      = $_.ExecutablePath
        StartedUtc = try { $_.CreationDate.ToUniversalTime() } catch { $null }
      }
    }
}

function Assert-NoForeignSpmusic {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$OwnedRoots,
    [string[]]$AllowPids = @()
  )
  $found = @(Get-SpmusicProcesses)
  if ($found.Count -eq 0) { return @() }
  $foreign = @($found | Where-Object {
    if ($AllowPids -contains $_.Pid) { return $false }
    $path = $_.Path
    if (-not $path) { return $true }
    -not ($OwnedRoots | Where-Object { $path.StartsWith($_, 'OrdinalIgnoreCase') })
  })
  if ($foreign.Count -gt 0) {
    $list = ($foreign | ForEach-Object { "pid=$($_.Pid) $($_.Name) $($_.Path)" }) -join '; '
    throw ("另一个 SpMusic 正在运行，已放弃测量以免干扰它： " + $list +
      "  ——请先关闭它再运行，本脚本不会替你关闭。")
  }
  return @()
}

# 只用于停止本脚本自己 spawn 的进程；任何身份不符的输入都拒绝而不是"尽力而为"。
function Stop-OwnedProcess {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedPathPrefix,
    [Parameter(Mandatory = $true)][datetime]$ExpectedStartUtc
  )
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return 'already-exited' }
  if (-not $proc.ExecutablePath -or -not $proc.ExecutablePath.StartsWith($ExpectedPathPrefix, 'OrdinalIgnoreCase')) {
    throw "refusing to stop pid=$ProcessId : executable path is not inside $ExpectedPathPrefix"
  }
  $started = try { $proc.CreationDate.ToUniversalTime() } catch { $null }
  if ($null -eq $started -or [math]::Abs(($started - $ExpectedStartUtc).TotalSeconds) -gt 5) {
    throw "refusing to stop pid=$ProcessId : creation time does not match the recorded spawn"
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  return 'stopped'
}
