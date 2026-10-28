# watchdog.ps1 — SnowLuma 控制器看门狗
# 控制器进程死亡后，若未 disarm，则只停止 bot 与 SnowLuma，绝不关闭 QQ。
param([Parameter(Mandatory=$true)][int]$ControllerPid)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statusPath = Join-Path $root 'state\status.json'
$disarmPath = Join-Path $root 'state\watchdog.disarm'
$snowNode = Join-Path (Split-Path -Parent $root) 'SnowLuma\runtime\node-v24.22.1-win-x64\node.exe'
$snowEntry = Join-Path (Split-Path -Parent $root) 'SnowLuma\index.mjs'

while ($true) {
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $ControllerPid -ErrorAction SilentlyContinue)) { break }
}

if (Test-Path $disarmPath) { exit 0 }

try {
    $st = Get-Content $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $botPid = $st.pid
    if ($botPid) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$botPid"
        if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -like '*bot.cjs*') {
            Stop-Process -Id $botPid -Force
        }
    }
} catch {}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.ExecutablePath -eq $snowNode -and $_.CommandLine -like "*$snowEntry*"
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
}

try {
    [System.IO.File]::WriteAllText($statusPath, '{"state":"stopped","pid":null}', [System.Text.Encoding]::UTF8)
} catch {}
exit 0
