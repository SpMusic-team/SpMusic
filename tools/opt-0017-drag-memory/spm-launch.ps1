<#
  OPT-0017 §1 隔离启动器：把参测臂放进每次专用的根，并证明它确实落在里面。

  做四件事：
    1. 护栏：存在外部 SpMusic 就拒绝运行（lib/process-guard.ps1）。
    2. 隔离：APPDATA / LOCALAPPDATA / WEBVIEW2_USER_DATA_FOLDER 全部指向本次根，
       使 config/data/cache/webview 四个目录都落在根内（AppPaths 走
       directories::ProjectDirs::from("app","SpMusic","SpMusic")）。
    3. 取证身份：exe 的 SHA-256、文件大小、WebView2 运行时版本、CDP 页面 URL、
       WebView2 子进程及其 --user-data-dir，全部回读校验，不符即拒绝。
    4. 泄漏对照：真实用户目录（%APPDATA%\SpMusic、%LOCALAPPDATA%\SpMusic）
       在启动前后的文件数/字节数/元数据 SHA 快照，供事后证明未污染。

  用法：
    ./spm-launch.ps1 -Exe 'C:\path\app.exe' -Root 'D:\spm-opt0017-runs\A' -Arm A -Port 9401
  输出：stdout 末行是 JSON（launch.json 同内容），供 spm-drive.mjs 与 spm-sample.ps1 使用。
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Arm = 'A',
  [int]$Port = 9401,
  [switch]$Maximize,
  [ValidateRange(10, 300)][int]$ReadyTimeoutSeconds = 90
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\process-guard.ps1')
. (Join-Path $PSScriptRoot 'lib\directory-snapshot.ps1')

$Exe = (Resolve-Path -LiteralPath $Exe).Path
if (-not (Test-Path -LiteralPath $Root)) { New-Item -ItemType Directory -Force -Path $Root | Out-Null }
$Root = (Resolve-Path -LiteralPath $Root).Path
if ($Maximize) { } # 默认总是最大化：§0 与 §4 的窗口条件必须成立，见下方验证

# ---- 1. 护栏 -------------------------------------------------------------
$ownedRoots = @($Root)
[void](Assert-NoForeignSpmusic -OwnedRoots $ownedRoots)

# ---- 4a. 真实用户目录启动前快照（只读） -----------------------------------
$before = Get-RealUserSnapshots

# ---- 2. 隔离 -------------------------------------------------------------
$appData = Join-Path $Root 'appdata'
$localAppData = Join-Path $Root 'localappdata'
$webview = Join-Path $Root 'webview2'
$evidence = Join-Path $Root 'evidence'
foreach ($dir in @($appData, $localAppData, $webview, $evidence)) {
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

$env:APPDATA = $appData
$env:LOCALAPPDATA = $localAppData
$env:WEBVIEW2_USER_DATA_FOLDER = $webview
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "port $Port is already listening before launch; choose a free port"
}

$exeBytes = (Get-Item -LiteralPath $Exe).Length
$exeSha = (Get-FileHash -LiteralPath $Exe -Algorithm SHA256).Hash
$spawnedAt = (Get-Date).ToUniversalTime()
$process = Start-Process -FilePath $Exe -PassThru -WorkingDirectory (Split-Path -Parent $Exe)
$rootPid = $process.Id

# ---- 3a. 等 CDP 就绪 ------------------------------------------------------
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$version = $null
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) { throw "app exited during startup with code $($process.ExitCode) (pid=$rootPid)" }
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -ErrorAction Stop
    if ($version) { break }
  } catch { Start-Sleep -Milliseconds 200 }
}
if (-not $version) { throw "CDP endpoint on port $Port did not become ready within $ReadyTimeoutSeconds s" }

$targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5)
$pageTarget = @($targets | Where-Object { $_.type -eq 'page' })
$appTarget = @($pageTarget | Where-Object { $_.url -like 'http://tauri.localhost/*' })
if ($appTarget.Count -ne 1) {
  $seen = ($pageTarget | ForEach-Object { $_.url }) -join '; '
  throw "expected exactly one http://tauri.localhost/ page, saw $($pageTarget.Count) pages: $seen"
}

# ---- 3b. WebView2 子进程与 profile 校验 -----------------------------------
Start-Sleep -Milliseconds 700
$wvChildren = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and ($_.CommandLine -like '*--user-data-dir=*') } |
  ForEach-Object {
    $match = [regex]::Match($_.CommandLine, '--user-data-dir="?([^"\s]+)"?')
    [pscustomobject]@{ pid = [int]$_.ProcessId; userDataDir = if ($match.Success) { $match.Groups[1].Value } else { $null } }
  })
$insideProfile = @($wvChildren | Where-Object { $_.userDataDir -and $_.userDataDir.StartsWith($webview, 'OrdinalIgnoreCase') })
if ($insideProfile.Count -eq 0) {
  throw ("no WebView2 browser process uses the isolated profile $webview ; observed: " +
    (($wvChildren | ForEach-Object { "$($_.pid)=$($_.userDataDir)" }) -join '; '))
}
$appDirs = @{}
foreach ($pair in @(@('config', (Join-Path $appData 'SpMusic\SpMusic\config')), @('data', (Join-Path $appData 'SpMusic\SpMusic\data')), @('cache', (Join-Path $localAppData 'SpMusic\SpMusic\cache')), @('webview', $webview))) {
  $appDirs[$pair[0]] = [pscustomobject]@{ path = $pair[1]; exists = (Test-Path -LiteralPath $pair[1]) }
}

# ---- 3c. 最大化（OS 级 + 回读验证） ---------------------------------------
if (-not ('SpmWindow' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SpmWindow {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

    // MainWindowHandle 对 WebView2 宿主不可靠；按 PID 枚举可见顶层窗口，取面积最大者。
    public static IntPtr FindMainWindow(uint targetPid) {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows(delegate(IntPtr handle, IntPtr lParam) {
            uint pid;
            GetWindowThreadProcessId(handle, out pid);
            if (pid != targetPid || !IsWindowVisible(handle)) return true;
            RECT rect;
            if (!GetWindowRect(handle, out rect)) return true;
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width > 400 && height > 300 && (long)width * height > bestArea) { best = handle; bestArea = (long)width * height; }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
'@
}
$handle = [IntPtr]::Zero
for ($attempt = 0; $attempt -lt 40 -and $handle -eq [IntPtr]::Zero; $attempt++) {
  $handle = [SpmWindow]::FindMainWindow([uint32]$rootPid)
  if ($handle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($handle -eq [IntPtr]::Zero) { throw "no visible top-level window for pid $rootPid; cannot maximize" }
# SW_MAXIMIZE = 3，与 tools/drag-memory-r2-diag/maximize-window.ps1 已验证的做法一致。
[void][SpmWindow]::ShowWindow($handle, 3)
Start-Sleep -Milliseconds 1200
$windowRect = New-Object SpmWindow+RECT
$clientRect = New-Object SpmWindow+RECT
[void][SpmWindow]::GetWindowRect($handle, [ref]$windowRect)
[void][SpmWindow]::GetClientRect($handle, [ref]$clientRect)
$winWidth = $windowRect.Right - $windowRect.Left
$winHeight = $windowRect.Bottom - $windowRect.Top
$clientWidth = $clientRect.Right
$clientHeight = $clientRect.Bottom
# 判据：窗口矩形宽度达到工作区宽度量级（基线用 ≥2400 判定 2560 宽的屏幕）。
$screenWidth = (Get-CimInstance Win32_VideoController | Select-Object -First 1).CurrentHorizontalResolution
$requiredWidth = if ($screenWidth) { [int]([math]::Round($screenWidth * 0.93)) } else { 2400 }
if ($winWidth -lt $requiredWidth) {
  throw "window did not maximize: window=$($winWidth)x$($winHeight) client=$($clientWidth)x$($clientHeight) required>=$requiredWidth"
}
$parts = @("$($winWidth)x$($winHeight)", "$($clientWidth)x$($clientHeight)", 'maximized')
$zoom = 'maximized'

# ---- 4b. 真实用户目录启动后快照（收尾时再采一次并比对） -------------------
$launch = [pscustomobject]@{
  arm              = $Arm
  exe              = $Exe
  exeBytes         = $exeBytes
  exeSha256        = $exeSha
  spawnedAtUtc     = $spawnedAt.ToString('o')
  rootPid          = $rootPid
  port             = $Port
  root             = $Root
  paths            = [pscustomobject]@{ appdata = $appData; localappdata = $localAppData; webview2 = $webview; evidence = $evidence }
  appDirs          = [pscustomobject]$appDirs
  webview2         = [pscustomobject]@{ browser = $version.Browser; protocolVersion = $version.'Protocol-Version'; userDataFolder = $insideProfile[0].userDataDir; childPids = @($wvChildren | ForEach-Object { $_.pid }) }
  page             = [pscustomobject]@{ url = $appTarget[0].url; id = $appTarget[0].id; title = $appTarget[0].title }
  window           = [pscustomobject]@{ windowSize = $parts[0]; clientSize = $parts[1]; maximized = $zoom }
  realUserDirsBefore = $before
  host             = [pscustomobject]@{ os = (Get-CimInstance Win32_OperatingSystem).Caption; build = [System.Environment]::OSVersion.Version.ToString(); ps = $PSVersionTable.PSVersion.ToString(); node = (node --version 2>$null) }
}
$launch | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'launch.json') -Encoding utf8
$launch | ConvertTo-Json -Depth 8 -Compress
