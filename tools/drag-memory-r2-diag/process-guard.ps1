
# ---------------------------------------------------------------------------
# 安全护栏：绝不按进程名杀进程，绝不碰用户自己启动的 SpMusic。
#
# 背景：OPT-0018 诊断期间曾用 `Get-Process app | Where StartTime -lt ... | Stop-Process`
# 清理残留实例。那个写法是错的——用户可能同时用 `npm run tauri dev`（debug 分支）或
# 已安装的 Release 包启动自己的 SpMusic，进程名同样匹配，会被一起杀掉。
#
# 本脚本的规则：
#   1. 启动前先探测：只要已经存在**不属于本次实验目录**的 SpMusic 进程，直接拒绝运行，
#      不碰它、不杀它，把决定权交回给用户。
#   2. 收尾只按 PID：本次 spawn 出来的 PID 写进 manifest，退出时只处理这些 PID。
#   3. 全脚本不出现任何按镜像名匹配的 Stop-Process / taskkill。
# ---------------------------------------------------------------------------
function Get-SpmusicProcesses {
  # 匹配"看起来是 SpMusic 的进程"：镜像名或可执行文件路径命中。
  # 只用于**探测并拒绝**，从不用于终止。
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('app.exe', 'spmusic.exe', 'SpMusic.exe') -or
      ($_.ExecutablePath -and $_.ExecutablePath -match 'SpMusic.*[\\/](src-tauri[\\/]target[\\/]|target-release)')
    } |
    ForEach-Object {
      [pscustomobject]@{
        Pid = $_.ProcessId
        Name = $_.Name
        Path = $_.ExecutablePath
        StartedUtc = try { $_.CreationDate.ToUniversalTime() } catch { $null }
      }
    }
}

function Assert-NoForeignSpmusic {
  param([Parameter(Mandatory)][string[]]$OwnedRoots)
  $found = @(Get-SpmusicProcesses)
  if ($found.Count -eq 0) { return @() }
  $foreign = @($found | Where-Object {
    $path = $_.Path
    if (-not $path) { return $true }
    -not ($OwnedRoots | Where-Object { $path.StartsWith($_, 'OrdinalIgnoreCase') })
  })
  if ($foreign.Count -gt 0) {
    $list = ($foreign | ForEach-Object { "pid=$($_.Pid) $($_.Name) $($_.Path)" }) -join '; '
    throw ("另一个 SpMusic 正在运行，已放弃测量以免干扰它： " + $list +
      "  ——请先关闭它再运行，本脚本不会替你关闭。")
  }
  return $foreign
}
