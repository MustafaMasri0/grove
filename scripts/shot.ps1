# Captures the Grove window to a PNG (used to check the UI during development).
param([string]$Out = "$PSScriptRoot\..\target\shot.png", [string]$Proc = "grove", [uint32]$Flags = 2)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WvWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[WvWin]::SetProcessDPIAware() | Out-Null
$p = Get-Process $Proc -ErrorAction Stop | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
$h = $p.MainWindowHandle
$r = New-Object WvWin+RECT
[WvWin]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[WvWin]::PrintWindow($h, $hdc, $Flags) | Out-Null
$g.ReleaseHdc($hdc)
$bmp.Save((Resolve-Path -LiteralPath (Split-Path $Out)).Path + "\" + (Split-Path $Out -Leaf))
"saved $Out ($($r.R - $r.L)x$($r.B - $r.T))"
