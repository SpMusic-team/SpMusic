# Process-tree private working set in bytes, matching the Task Manager metric.
param(
  [Parameter(Mandatory)][string]$OutCsv,
  [Parameter(Mandatory)][int]$RootPid,
  [ValidateRange(1, 60000)][int]$IntervalMs = 100,
  [ValidateRange(1, 86400)][int]$DurationSeconds = 120,
  [ValidateSet('Auto', 'Native', 'Cim')][string]$PrivateWorkingSetSource = 'Auto'
)
$ErrorActionPreference = 'Stop'

if (-not ('SpMusicMemorySampler' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class SpMusicMemorySampler
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessEntry
    {
        public uint Size, Usage, Id;
        public UIntPtr DefaultHeap;
        public uint ModuleId, ThreadCount, ParentId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string Name;
    }

    // PROCESS_MEMORY_COUNTERS_EX2 (psapi.h) keeps all three counters in one read.
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
    private static extern bool GetProcessMemoryInfo(SafeProcessHandle process,
        ref MemoryCounters counters, uint size);

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

function Test-Descendant($entry, $processes) {
  $current = $entry
  for ($depth = 0; $depth -lt $processes.Count; $depth++) {
    if ($current.ParentId -eq $RootPid) { return $true }
    if ($current.ParentId -eq $current.Id) { break }
    $current = $processes[[int]$current.ParentId]
    if ($null -eq $current) { break }
  }
  return $false
}

$native = [SpMusicMemorySampler+MemoryCounters]::new()
$supportsNative = $PrivateWorkingSetSource -ne 'Cim' -and
  [SpMusicMemorySampler]::TryMemory($PID, [ref]$native) -and
  $native.PrivateWorkingSet.ToUInt64() -gt 0
if (-not $supportsNative -and $PrivateWorkingSetSource -eq 'Native') {
  throw 'GetProcessMemoryInfo EX2 unavailable'
}
$source = if ($supportsNative) { 'GetProcessMemoryInfo EX2' } else { 'CIM WorkingSetPrivate' }
Write-Verbose "Private working set source: $source"

$roleMap = @{}
$root = Get-Process -Id $RootPid
$writer = [System.IO.StreamWriter]::new($OutCsv, $false)
$writer.AutoFlush = $true
$runClock = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $writer.WriteLine('utc_ms,pid,name,role,private_working_set,working_set,private_bytes')
  while ($runClock.Elapsed.TotalSeconds -lt $DurationSeconds -and -not $root.HasExited) {
    $tickStart = $runClock.Elapsed.TotalMilliseconds
    $processes = @{}
    foreach ($entry in [SpMusicMemorySampler]::Snapshot()) { $processes[[int]$entry.Id] = $entry }
    $rootEntry = $processes[$RootPid]
    if ($null -eq $rootEntry) { break }
    $owned = @($rootEntry)
    $owned += @($processes.Values | Where-Object {
      $_.Id -ne $RootPid -and $_.Name -in @('msedgewebview2.exe', 'crashpad_handler.exe') -and
      (Test-Descendant $_ $processes)
    })
    $liveOwnedIds = @{}
    foreach ($entry in $owned) { $liveOwnedIds[[int]$entry.Id] = $true }
    foreach ($tracked in @($roleMap.Keys)) {
      if (-not $liveOwnedIds.ContainsKey($tracked)) { $roleMap.Remove($tracked) }
    }
    $newWebViews = @($owned | Where-Object {
      $_.Id -ne $RootPid -and $_.Name -eq 'msedgewebview2.exe' -and
      -not $roleMap.ContainsKey([int]$_.Id)
    })
    if ($newWebViews.Count -gt 0) {
      $filter = ($newWebViews | ForEach-Object { 'ProcessId = {0}' -f $_.Id }) -join ' OR '
      foreach ($proc in Get-CimInstance Win32_Process -Filter $filter -Property 'ProcessId','CommandLine' -ErrorAction SilentlyContinue) {
        if ($null -eq $proc.CommandLine) { continue }
        $roleMap[[int]$proc.ProcessId] = switch -Regex ($proc.CommandLine) {
          '--type=gpu-process' { 'gpu'; break }
          '--type=renderer'    { 'renderer'; break }
          '--type=utility'     { 'utility'; break }
          default              { 'browser' }
        }
      }
    }

    $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $perf = @{}
    if (-not $supportsNative) {
      foreach ($proc in Get-CimInstance Win32_PerfRawData_PerfProc_Process -ErrorAction SilentlyContinue) {
        $perf[[int]$proc.IDProcess] = [uint64]$proc.WorkingSetPrivate
      }
    }
    $lines = foreach ($entry in $owned) {
      $id = [int]$entry.Id
      $role = if ($id -eq $RootPid) { 'app' }
        elseif ($entry.Name -eq 'crashpad_handler.exe') { 'crashpad' }
        elseif ($roleMap.ContainsKey($id)) { $roleMap[$id] }
        else { 'unknown' }
      $privateWorkingSet = $workingSet = $privateBytes = 0
      if ($supportsNative) {
        if ([SpMusicMemorySampler]::TryMemory($id, [ref]$native)) {
          $privateWorkingSet = $native.PrivateWorkingSet.ToUInt64()
          $workingSet = $native.WorkingSet.ToUInt64()
          $privateBytes = $native.PrivateUsage.ToUInt64()
        }
      } else {
        if ($perf.ContainsKey($id)) { $privateWorkingSet = $perf[$id] }
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc) {
          $workingSet = $proc.WorkingSet64
          $privateBytes = $proc.PrivateMemorySize64
        }
      }
      '{0},{1},{2},{3},{4},{5},{6}' -f $at, $id, [IO.Path]::GetFileNameWithoutExtension($entry.Name), $role,
        $privateWorkingSet, $workingSet, $privateBytes
    }
    $writer.WriteLine($lines -join [Environment]::NewLine)
    $wait = [int][math]::Floor($IntervalMs - ($runClock.Elapsed.TotalMilliseconds - $tickStart))
    if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
  }
}
finally {
  $writer.Dispose()
  $root.Dispose()
}
