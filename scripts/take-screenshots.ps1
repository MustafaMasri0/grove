# Retakes the README screenshots in docs/images, in the light and dark themes,
# from a fresh demo repository (scripts/make-screenshot-demo.sh) opened in a
# separate test instance. Build the test instance first, as for test-run.ps1.
#   .\scripts\take-screenshots.ps1
param([string]$Exe = "$PSScriptRoot\..\target\test\debug\grove-test.exe", [string]$Bash = "C:\Program Files\Git\bin\bash.exe")
$ErrorActionPreference = "Stop"
$work = Join-Path $env:TEMP "grove-screenshots"
$root = "$work\demo"
$cfg = "$work\config"
$images = (Resolve-Path "$PSScriptRoot\..\docs").Path + "\images"
New-Item -ItemType Directory -Force $images | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WvShotPos { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f); }
"@

function Take([string]$Theme, [string]$Name, [string]$Worktree, [hashtable]$Env, [hashtable]$Settings, [switch]$Activity) {
  Stop-Process -Name grove-test -ErrorAction SilentlyContinue
  Start-Sleep 1
  # A fresh repository for every shot, since -Activity changes it.
  if (Test-Path $root) { Remove-Item -Recurse -Force $root }
  & $Bash "$PSScriptRoot/make-screenshot-demo.sh" ($root -replace '\\', '/') 2>&1 | Out-Null
  $repo = "$root\example-app"

  if (Test-Path $cfg) { Remove-Item -Recurse -Force $cfg }
  New-Item -ItemType Directory -Force $cfg | Out-Null
  $s = @{ repos = @($repo); lastRepo = $repo; theme = $Theme }
  foreach ($k in $Settings.Keys) { $s[$k] = $Settings[$k] }
  if ($Worktree) { $s.lastWorktree = @{ $repo = ("$root/worktrees/$Worktree" -replace '\\', '/') } }
  [IO.File]::WriteAllText("$cfg\settings.json", ($s | ConvertTo-Json -Compress))

  Get-ChildItem env:WV_* | ForEach-Object { Remove-Item "env:$($_.Name)" }
  $env:WV_CONFIG_DIR = $cfg
  $env:WV_TITLE = "Grove"
  $env:WEBVIEW2_USER_DATA_FOLDER = "$work\webview2"
  foreach ($k in $Env.Keys) { Set-Item "env:$k" $Env[$k] }
  Start-Process $Exe
  Start-Sleep 3
  $p = Get-Process grove-test | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
  [WvShotPos]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 40, 40, 1296, 768, 0x0044) | Out-Null
  Start-Sleep 7

  if ($Activity) {
    # Something for the Activity feed and the Changing state to show.
    $g = @('-c', 'user.name=Agent Example', '-c', 'user.email=agent@example.com', '-c', 'commit.gpgsign=false')
    git -C "$root\worktrees\fix-retry" add -A
    git -C "$root\worktrees\fix-retry" @g commit -q -m "Test the retry loop"
    Start-Sleep 2
    Add-Content "$root\worktrees\docs\docs\architecture.md" "`n- ``src/api/cache.ts``: keeps forecasts for ten minutes."
    Start-Sleep 2
    Add-Content "$root\worktrees\units\src\lib\format.ts" "`nexport function formatUnit(unit: string): string {`n  return unit === `"celsius`" ? `"°C`" : `"°F`";`n}"
    Start-Sleep 2
  }

  $raw = "$work\raw.png"
  & "$PSScriptRoot\shot.ps1" -Proc grove-test -Out $raw | Out-Null
  # Trim the invisible resize border, which PrintWindow captures as black.
  $src = [Drawing.Bitmap]::FromFile($raw)
  $dst = $src.Clone((New-Object Drawing.Rectangle 8, 0, ($src.Width - 16), ($src.Height - 8)), $src.PixelFormat)
  $src.Dispose()
  $dst.Save("$images\$Name-$Theme.png", [Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  "saved docs\images\$Name-$Theme.png"
}

foreach ($theme in "light", "dark") {
  Take $theme overview "" @{ WV_WORKTREES = "1" } @{} -Activity
  Take $theme diff fix-retry @{ WV_LEFT_TAB = "changes"; WV_OPEN_DIFFS = "1" } @{ railCollapsed = $true; leftWidth = 250 }
  Take $theme history cache @{ WV_LEFT_TAB = "history"; WV_OPEN_FILE = "src/api/client.ts"; WV_BLAME = "1" } @{ railCollapsed = $true; leftWidth = 330 }
}
Stop-Process -Name grove-test -ErrorAction SilentlyContinue
