# Records the README's demo, docs/images/overview.gif: the Worktrees overview of a
# fresh demo repository (scripts/make-screenshot-demo.sh) while made-up agents
# commit and edit in its worktrees, until two of them change the same file.
# Build the test instance first, as for test-run.ps1. Needs ffmpeg on PATH.
#   .\scripts\record-demo.ps1
param(
  [string]$Exe = "$PSScriptRoot\..\target\test\debug\grove-test.exe",
  [string]$Bash = "C:\Program Files\Git\bin\bash.exe",
  [int]$Seconds = 18,
  [int]$Width = 1440,
  [int]$Height = 720,
  [double]$Zoom = 1.25
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw "ffmpeg is not on PATH" }
$work = Join-Path $env:TEMP "grove-demo"
$root = "$work\demo"
$cfg = "$work\config"
$frames = "$work\frames"
$out = (Resolve-Path "$PSScriptRoot\..\docs\images").Path + "\overview.gif"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WvDemo {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  public struct RECT { public int L, T, R, B; }
}
"@
[WvDemo]::SetProcessDPIAware() | Out-Null

function Shot([IntPtr]$h, [string]$path) {
  $r = New-Object WvDemo+RECT
  [WvDemo]::GetWindowRect($h, [ref]$r) | Out-Null
  $bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [WvDemo]::PrintWindow($h, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
}

Stop-Process -Name grove-test -ErrorAction SilentlyContinue
Start-Sleep 1
foreach ($d in $root, $cfg, $frames) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
& $Bash "$PSScriptRoot/make-screenshot-demo.sh" ($root -replace '\\', '/') 2>&1 | Out-Null
$repo = "$root\example-app"
New-Item -ItemType Directory -Force $cfg, $frames | Out-Null
[IO.File]::WriteAllText("$cfg\settings.json", (@{ repos = @($repo); lastRepo = $repo; theme = "dark"; zoom = $Zoom } | ConvertTo-Json -Compress))

Get-ChildItem env:WV_* | ForEach-Object { Remove-Item "env:$($_.Name)" }
$env:WV_CONFIG_DIR = $cfg
$env:WV_TITLE = "Grove"
$env:WV_WORKTREES = "1"
$env:WEBVIEW2_USER_DATA_FOLDER = "$work\webview2"
Start-Process $Exe
Start-Sleep 3
$h = (Get-Process grove-test | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).MainWindowHandle
[WvDemo]::SetWindowPos($h, [IntPtr]::Zero, 40, 40, $Width, $Height, 0x0044) | Out-Null
Start-Sleep 7

# What the agents do, at seconds into the recording. The last edit makes README.md a possible conflict.
$wt = "$root\worktrees"
$who = @('-c', 'user.name=Agent Example', '-c', 'user.email=agent@example.com', '-c', 'commit.gpgsign=false')
$steps = @(
  @{ at = 2; run = { git -C "$wt\fix-retry" add -A; git -C "$wt\fix-retry" @who commit -q -m "Test the retry loop" } },
  @{ at = 5; run = { Add-Content "$wt\docs\docs\architecture.md" "`n- ``src/api/cache.ts``: keeps forecasts for ten minutes." } },
  @{ at = 8; run = { Add-Content "$wt\units\src\lib\format.ts" "`nexport function formatUnit(unit: string): string {`n  return unit === `"celsius`" ? `"C`" : `"F`";`n}" } },
  @{ at = 11; run = { Add-Content "$wt\units\README.md" "`nUse the toggle at the top right to switch between Celsius and Fahrenheit." } },
  @{ at = 14; run = { Add-Content "$wt\cache\src\api\cache.ts" "`nexport const TEN_MINUTES = 10 * 60 * 1000;"; git -C "$wt\cache" add -A; git -C "$wt\cache" @who commit -q -m "Name the cache lifetime" } }
)

$clock = [Diagnostics.Stopwatch]::StartNew()
$next = 0
$taken = @()
while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
  if ($next -lt $steps.Count -and $clock.Elapsed.TotalSeconds -ge $steps[$next].at) {
    & $steps[$next].run 2>&1 | Out-Null
    $next++
  }
  $ms = [int]$clock.Elapsed.TotalMilliseconds
  $file = "{0}\{1:D6}.bmp" -f $frames, $ms
  Shot $h $file
  $taken += @{ file = $file; ms = $ms }
  $wait = 100 - ([int]$clock.Elapsed.TotalMilliseconds - $ms)
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}
Stop-Process -Name grove-test -ErrorAction SilentlyContinue

# Frames as captured, each shown until the next; the last one held for three seconds.
$list = "ffconcat version 1.0`n"
for ($i = 0; $i -lt $taken.Count; $i++) {
  $d = if ($i + 1 -lt $taken.Count) { ($taken[$i + 1].ms - $taken[$i].ms) / 1000 } else { 3 }
  $list += "file '$($taken[$i].file -replace '\\', '/')'`nduration $d`n"
}
$list += "file '$($taken[-1].file -replace '\\', '/')'`n"
[IO.File]::WriteAllText("$work\frames.txt", $list)
# Trims PrintWindow's invisible resize border; one palette and no dithering keep the text crisp.
$filter = "crop=iw-16:ih-8:8:0,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$work\frames.txt" -vf $filter -fps_mode vfr $out
"saved docs\images\overview.gif ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
