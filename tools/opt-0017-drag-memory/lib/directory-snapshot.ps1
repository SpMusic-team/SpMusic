# 真实用户目录的只读元数据快照，用于证明隔离运行没有污染用户数据。
#
# 只读：Get-ChildItem + 文件属性，不打开、不修改、不删除任何用户文件。
# 快照包含 entries/files/bytes 与「路径|长度|最后写入时间」排序串的 SHA-256；
# 这不排除同尺寸同时间戳的内容改写（与 sp-022 记录的限制一致），但足以发现
# 新增、删除、改名与常规写入。
function Get-DirectorySnapshot {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ path = $Path; exists = $false; entries = 0; files = 0; bytes = 0; metaSha256 = $null }
  }
  $items = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue)
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  $bytes = [int64]0
  foreach ($file in $files) { try { $bytes += [int64]$file.Length } catch { } }
  $lines = foreach ($item in $items) {
    $length = if ($item.PSIsContainer) { -1 } else { try { [int64]$item.Length } catch { -2 } }
    $ticks = try { $item.LastWriteTimeUtc.Ticks } catch { 0 }
    "$($item.FullName)|$length|$ticks"
  }
  $joined = (($lines | Sort-Object) -join "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($joined)))).Replace('-', '')
  } finally { $sha.Dispose() }
  [pscustomobject]@{ path = $Path; exists = $true; entries = $items.Count; files = $files.Count; bytes = $bytes; metaSha256 = $hash }
}

# 真实用户目录成对快照：默认位置来自 ProjectDirs::from("app","SpMusic","SpMusic")。
function Get-RealUserSnapshots {
  [pscustomobject]@{
    roaming = Get-DirectorySnapshot -Path (Join-Path $env:APPDATA 'SpMusic')
    local   = Get-DirectorySnapshot -Path (Join-Path $env:LOCALAPPDATA 'SpMusic')
  }
}

# 前后比对：任何一项变化都需要人工解释后才能声称"未污染"。
function Compare-RealUserSnapshots {
  param([Parameter(Mandatory = $true)]$Before, [Parameter(Mandatory = $true)]$After)
  foreach ($name in @('roaming', 'local')) {
    $b = $Before.$name; $a = $After.$name
    [pscustomobject]@{
      root      = $name
      path      = $a.path
      unchanged = ($b.metaSha256 -eq $a.metaSha256)
      before    = [pscustomobject]@{ entries = $b.entries; files = $b.files; bytes = $b.bytes; metaSha256 = $b.metaSha256 }
      after     = [pscustomobject]@{ entries = $a.entries; files = $a.files; bytes = $a.bytes; metaSha256 = $a.metaSha256 }
    }
  }
}
