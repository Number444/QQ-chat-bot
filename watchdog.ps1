# watchdog.ps1 — 控制器看门狗（计划 §7）
# 场景：用户直接点 X 关控制器窗口（CTRL_CLOSE_EVENT Node 捕获不到）
# 控制器进程死亡 → 若 state/watchdog.disarm 存在则静默退出（主动 stop 或保留机器人）
# 否则执行幂等停止：按 status.json 的 pid 杀 bot（先验证 node.exe+bot.cjs 防 pid 复用误杀），再杀 NapCat/QQ
param([Parameter(Mandatory=$true)][int]$ControllerPid)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statusPath = Join-Path $root 'state\status.json'
$disarmPath = Join-Path $root 'state\watchdog.disarm'

# 等控制器进程死亡
while ($true) {
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $ControllerPid -ErrorAction SilentlyContinue)) { break }
}

# 控制器死了。解除武装标记存在 → 什么都不做
if (Test-Path $disarmPath) { exit 0 }

# 幂等停止 bot
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

# 停 NapCat/QQ（会杀掉所有 QQ，这是 X=stop 的既定语义，计划 §7）
Stop-Process -Name NapCatWinBootMain,QQ,QQEX -Force

# 写停止状态
try {
    [System.IO.File]::WriteAllText($statusPath, '{"state":"stopped","pid":null}', [System.Text.Encoding]::UTF8)
} catch {}
exit 0
