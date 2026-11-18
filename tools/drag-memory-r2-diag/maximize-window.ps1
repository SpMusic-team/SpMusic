# Maximize the app's real top-level window and prove the result.
#
# The Tauri window API is ACL-restricted from the page, and the launch path leaves the
# window at its configured 1120x720. This maximizes at the OS level and then MEASURES
# GetWindowRect + client size, so a run cannot silently proceed in a small window.
param(
  [Parameter(Mandatory)][int]$TargetProcessId,
  [Parameter(Mandatory)][string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinMax {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
}
'@

$SW_MAXIMIZE = 3
$candidates = New-Object System.Collections.ArrayList
$callback = [WinMax+EnumProc]{
  param($hWnd, $lParam)
  $wpid = [uint32]0
  [void][WinMax]::GetWindowThreadProcessId($hWnd, [ref]$wpid)
  if ($wpid -ne $TargetProcessId) { return $true }
  if (-not [WinMax]::IsWindowVisible($hWnd)) { return $true }
  $r = New-Object WinMax+RECT
  [void][WinMax]::GetWindowRect($hWnd, [ref]$r)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -gt 400 -and $hh -gt 300) { [void]$candidates.Add([pscustomobject]@{ Handle = $hWnd; Width = $w; Height = $hh }) }
  return $true
}
[void][WinMax]::EnumWindows($callback, [IntPtr]::Zero)
if ($candidates.Count -eq 0) { throw "no visible top-level window for pid $TargetProcessId" }
$target = $candidates | Sort-Object { $_.Width * $_.Height } -Descending | Select-Object -First 1

[void][WinMax]::ShowWindow($target.Handle, $SW_MAXIMIZE)
Start-Sleep -Milliseconds 1200

$rect = New-Object WinMax+RECT
[void][WinMax]::GetWindowRect($target.Handle, [ref]$rect)
$client = New-Object WinMax+RECT
[void][WinMax]::GetClientRect($target.Handle, [ref]$client)
$origin = New-Object WinMax+POINT
[void][WinMax]::ClientToScreen($target.Handle, [ref]$origin)

$report = [ordered]@{
  processId = $TargetProcessId
  handle = $target.Handle.ToInt64()
  windowRect = @{ left = $rect.Left; top = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
  clientRect = @{ width = $client.Right; height = $client.Bottom }
  clientOriginScreen = @{ x = $origin.X; y = $origin.Y }
  maximized = (($rect.Right - $rect.Left) -ge 2400);
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding utf8
$report | ConvertTo-Json -Depth 5 | Write-Output