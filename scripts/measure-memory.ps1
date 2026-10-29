# Sums the memory of a running Grove: the app process, every
# WebView2 process it started, and wsl.exe helper launchers. Reports both
# private working set (what Task Manager's "Memory" column shows) and the
# plain working set. The helper inside the WSL VM is reported separately.
param([string]$Proc = "grove")

$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$app = $all | Where-Object { $_.Name -eq "$Proc.exe" } | Select-Object -First 1
if (-not $app) { throw "$Proc is not running" }

$ids = New-Object System.Collections.Generic.HashSet[int]
[void]$ids.Add([int]$app.ProcessId)
do {
  $added = $false
  foreach ($p in $all) {
    if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true }
  }
} while ($added)

$rows = foreach ($id in $ids) {
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=$id" -ErrorAction SilentlyContinue
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) {
    [pscustomobject]@{
      Name = $p.ProcessName
      Id = $id
      PrivateWS_MB = [math]::Round(($perf.WorkingSetPrivate) / 1MB, 1)
      WS_MB = [math]::Round($p.WorkingSet64 / 1MB, 1)
    }
  }
}
$rows | Sort-Object PrivateWS_MB -Descending | Format-Table -AutoSize | Out-String
"TOTAL private working set: {0:N1} MB" -f (($rows | Measure-Object PrivateWS_MB -Sum).Sum)
"TOTAL working set:         {0:N1} MB" -f (($rows | Measure-Object WS_MB -Sum).Sum)
