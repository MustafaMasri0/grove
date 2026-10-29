# Starts a separate test instance (own settings dir) opened on the given repo,
# e.g. .\scripts\test-run.ps1 -Repo \\wsl.localhost\Ubuntu\home\user\src\example
param([Parameter(Mandatory)][string]$Repo, [string]$Exe = "$PSScriptRoot\..\target\test\debug\grove-test.exe")
Stop-Process -Name grove-test -ErrorAction SilentlyContinue
$cfg = "$PSScriptRoot\..\target\testcfg"
New-Item -ItemType Directory -Force $cfg | Out-Null
$s = @{ repos = @($Repo, (Resolve-Path "$PSScriptRoot\..").Path); lastRepo = $Repo } | ConvertTo-Json -Compress
[IO.File]::WriteAllText("$cfg\settings.json", $s)
$env:WV_CONFIG_DIR = (Resolve-Path $cfg).Path
Start-Process $Exe
