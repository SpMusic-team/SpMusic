<#
  OPT-0017 §4 采样器：按进程树逐角色采集三口径内存。

  口径（§1）：主判定 = 任务管理器「内存」列 = WorkingSetPrivate。
    三口径同时记录：
      working_set_private  任务管理器「内存」列（主判定）
      working_set          WorkingSet64，含共享映射页（诊断用）
      private_bytes        PrivateUsage / PrivateMemorySize64（诊断用）

  与 OPT-0018 tm-sampler.ps1 的关键区别：本脚本**记录每次采样的实际耗时与间隔**，
  因为 §4 把「p95 间隔 ≤100 ms、最大 ≤250 ms」写成了首轮有效线；达不到时必须能证明
  达不到，而不是静默降级。

  输出 CSV 列（§5 的原始行要求超集）：
    monoMs,utcMs,pid,name,role,private_working_set,working_set,private_bytes,intervalMs,tickIndex
  时序单独写 <OutCsv 同名>.ticks.csv：tickIndex,monoMs,intervalMs,processCount

  用法：
    ./spm-sample.ps1 -RootPid 1234 -OutCsv runs\A\evidence\memory-sweep-G.csv -IntervalMs 50 -DurationSeconds 300
#>param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$OutCsv,
  [ValidateRange(10, 60000)][int]$IntervalMs = 50,
  [ValidateRange(1, 86400)][int]$DurationSeconds = 120,
  [ValidateSet('Auto', 'Native', 'Cim')][string]$PrivateWorkingSetSource = 'Auto',
  [string]$StopFile
)
$ErrorActionPreference = 'Stop'

# ---- 原生读取：一次 OpenProcess + GetProcessMemoryInfo(EX2) 拿全部三口径 ------
if (-not ('SpmMemory' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class SpmMemory
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessEntry
    {
        public uint Size, Usage, Id;
        public UIntPtr DefaultHeap;
        public uint ModuleId, ThreadCount, ParentId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MemoryCounters
    {
        public uint Size, PageFaultCount;
        public UIntPtr PeakWorkingSet, WorkingSet, QuotaPeakPaged, QuotaPaged,
            QuotaPeakNonPaged, QuotaNonPaged, PagefileUsage, PeakPagefileUsage,
            PrivateUsage, PrivateWorkingSet;
        public ulong SharedCommit;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(SafeFileHandle snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, bool inherit, int id);
    [DllImport("psapi.dll", SetLastError = true)]
    private static extern bool GetProcessMemoryInfo(SafeProcessHandle process, ref MemoryCounters counters, uint size);

    public static ProcessEntry[] Snapshot()
    {
        const uint SnapshotProcesses = 0x00000002;
        const int NoMoreFiles = 18;
        var entries = new List<ProcessEntry>();
        using (var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0))
        {
            if (snapshot.IsInvalid) throw new Win32Exception();
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (!Process32First(snapshot, ref entry)) throw new Win32Exception();
            do { entries.Add(entry); } while (Process32Next(snapshot, ref entry));
            var error = Marshal.GetLastWin32Error();
            if (error != NoMoreFiles) throw new Win32Exception(error);
        }
        return entries.ToArray();
    }

    public static bool TryMemory(int id, out MemoryCounters counters)
    {
        const uint QueryLimitedInformation = 0x1000;
        counters = new MemoryCounters { Size = (uint)Marshal.SizeOf(typeof(MemoryCounters)) };
        using (var process = OpenProcess(QueryLimitedInformation, false, id))
        {
            return !process.IsInvalid && GetProcessMemoryInfo(process, ref counters, counters.Size);
        }
    }
}
'@
}

$outDir = Split-Path -Parent $OutCsv
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$tickCsv = [System.IO.Path]::ChangeExtension($OutCsv, '.ticks.csv')

$root = Get-Process -Id $RootPid -ErrorAction Stop
$rootStartUtc = $root.StartTime.ToUniversalTime()

# 原生可用性探测
$probe = [SpmMemory+MemoryCounters]::new()
$supportsNative = $PrivateWorkingSetSource -ne 'Cim' -and
  [SpmMemory]::TryMemory($PID, [ref]$probe) -and $probe.PrivateWorkingSet.ToUInt64() -gt 0
if (-not $supportsNative -and $PrivateWorkingSetSource -eq 'Native') { throw 'GetProcessMemoryInfo EX2 unavailable' }
$source = if ($supportsNative) { 'GetProcessMemoryInfo EX2' } else { 'CIM WorkingSetPrivate' }
Write-Verbose "Private working set source: $source"

$roleMap = @{}
$writer = [System.IO.StreamWriter]::new($OutCsv, $false)
$writer.AutoFlush = $true
$tickWriter = [System.IO.StreamWriter]::new($tickCsv, $false)
$tickWriter.AutoFlush = $true
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$tickIndex = 0
$lastTickMs = 0.0
# 列名必须与写入值一致：第 9 列是本次 tick 与上次的间隔，第 10 列是 tick 序号。
$header = 'monoMs,utcMs,pid,name,role,private_working_set,working_set,private_bytes,intervalMs,tickIndex'
try {
  $writer.WriteLine($header)
  $tickWriter.WriteLine('tickIndex,monoMs,intervalMs,tickCostMs,processCount')
  while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
    if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
    if ($root.HasExited) { break }
    $tickStartedMs = $clock.Elapsed.TotalMilliseconds
    $processes = @{}
    foreach ($entry in [SpmMemory]::Snapshot()) { $processes[[int]$entry.Id] = $entry }
    $rootEntry = $processes[$RootPid]
    if ($null -eq $rootEntry) { break }

    # 归属：根进程 + 其全部后代（WebView2 子进程的父链通向根进程）
    $owned = @()
    foreach ($entry in $processes.Values) {
      if ([int]$entry.Id -eq $RootPid) { $owned += $entry; continue }
      $current = $entry
      for ($depth = 0; $depth -lt 32; $depth++) {
        $parentKey = [int]$current.ParentId
        if ($parentKey -eq $RootPid) { $owned += $entry; break }
        if ($parentKey -eq [int]$current.Id) { break }
        if (-not $processes.ContainsKey($parentKey)) { break }
        $current = $processes[$parentKey]
      }
    }
    $liveIds = @{}
    foreach ($entry in $owned) { $liveIds[[int]$entry.Id] = $true }
    foreach ($tracked in @($roleMap.Keys)) { if (-not $liveIds.ContainsKey($tracked)) { $roleMap.Remove($tracked) } }

    # 角色：只对新出现的 WebView2 子进程查一次命令行
    $unknown = @($owned | Where-Object { $_.Id -ne $RootPid -and -not $roleMap.ContainsKey([int]$_.Id) })
    if ($unknown.Count -gt 0) {
      $filter = ($unknown | ForEach-Object { 'ProcessId = {0}' -f $_.Id }) -join ' OR '
      foreach ($proc in Get-CimInstance Win32_Process -Filter $filter -Property 'ProcessId', 'CommandLine' -ErrorAction SilentlyContinue) {
        if ($null -eq $proc.CommandLine) { continue }
        $roleMap[[int]$proc.ProcessId] = switch -Regex ($proc.CommandLine) {
          '--type=gpu-process' { 'gpu'; break }
          '--type=renderer' { 'renderer'; break }
          '--type=utility' { 'utility'; break }
          default { 'browser' }
        }
      }
    }

    $utcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $monoMs = [int][math]::Round($tickStartedMs)
    # 注意：PowerShell 变量名大小写不敏感，局部名不得与参数 $IntervalMs 冲突。
    $gapMs = if ($tickIndex -eq 0) { 0 } else { [int][math]::Round($tickStartedMs - $lastTickMs) }
    $perf = @{}
    if (-not $supportsNative) {
      foreach ($proc in Get-CimInstance Win32_PerfRawData_PerfProc_Process -ErrorAction SilentlyContinue) {
        $perf[[int]$proc.IDProcess] = [uint64]$proc.WorkingSetPrivate
      }
    }
    $lines = foreach ($entry in $owned) {
      $id = [int]$entry.Id
      $role = if ($id -eq $RootPid) { 'app' } else { if ($roleMap.ContainsKey($id)) { $roleMap[$id] } else { 'unknown' } }
      $pws = $ws = $pb = 0
      if ($supportsNative) {
        if ([SpmMemory]::TryMemory($id, [ref]$probe)) {
          $pws = $probe.PrivateWorkingSet.ToUInt64()
          $ws = $probe.WorkingSet.ToUInt64()
          $pb = $probe.PrivateUsage.ToUInt64()
        }
      } else {
        if ($perf.ContainsKey($id)) { $pws = $perf[$id] }
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc) { $ws = $proc.WorkingSet64; $pb = $proc.PrivateMemorySize64 }
      }
      '{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}' -f $monoMs, $utcMs, $id,
        [IO.Path]::GetFileNameWithoutExtension($entry.Name), $role, $pws, $ws, $pb, $gapMs, $tickIndex
    }
    if ($lines) { $writer.WriteLine(($lines -join [Environment]::NewLine)) }
    $tickCostMs = [int][math]::Round($clock.Elapsed.TotalMilliseconds - $tickStartedMs)
    $tickWriter.WriteLine(('{0},{1},{2},{3},{4}' -f $tickIndex, $monoMs, $gapMs, $tickCostMs, $owned.Count))
    $tickIndex++
    $lastTickMs = $tickStartedMs
    $wait = [int][math]::Floor($IntervalMs - ($clock.Elapsed.TotalMilliseconds - $tickStartedMs))
    if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
  }
}
finally {
  $writer.Dispose(); $tickWriter.Dispose(); $root.Dispose()
  [pscustomobject]@{
    outCsv = $OutCsv; ticksCsv = $tickCsv; ticks = $tickIndex
    intervalMs = $IntervalMs; source = $source
    rootPid = $RootPid; rootStartUtc = $rootStartUtc.ToString('o')
  } | ConvertTo-Json -Compress
}
