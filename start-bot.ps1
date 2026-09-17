# QQ 机器人一键启动（前置检查：dsh-app + dsh web 服务均在线才放行）
$ErrorActionPreference = 'SilentlyContinue'

function Fail($msg) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'QQ 机器人启动失败', 'OK', 'Error') | Out-Null
    exit 1
}

# 1. 检查 dsh-app 桌面壳进程
if (-not (Get-Process dsh-app)) {
    Fail "未检测到 dsh-app 进程。`n请先启动桌面上的 dsh-app.exe"
}

# 2. 检查 dsh web 服务
try {
    $r = Invoke-WebRequest 'http://127.0.0.1:3080' -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ne 200) { throw }
} catch {
    Fail "dsh web 服务（127.0.0.1:3080）无响应。`n请确认 dsh 已启动后再运行本脚本"
}

# 3. 提权（NapCat 注入 QQNT 需要管理员）
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pri = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pri.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "D:\Agent Space\NapCatShell\start-bot.ps1"' -Verb RunAs
    exit 0
}

# 4. 启动 NapCat + bot 大脑
Start-Process cmd -ArgumentList '/c launcher-user.bat' -WorkingDirectory 'D:\Agent Space\NapCatShell'
Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList '"D:\Agent Space\NapCatShell\bot.cjs"' -WorkingDirectory 'D:\Agent Space\NapCatShell' -WindowStyle Hidden

# 5. 等待并验证（NapCat 自动登录 + bot 端口）
$ok = $false
foreach ($i in 1..12) {
    Start-Sleep 5
    try {
        $login = Invoke-RestMethod 'http://127.0.0.1:3000/get_login_info' -TimeoutSec 5
        if ($login.status -eq 'ok') { $ok = $true; break }
    } catch {}
}
$botOk = (Get-NetTCPConnection -State Listen -LocalPort 3210) -ne $null

Add-Type -AssemblyName PresentationFramework
if ($ok -and $botOk) {
    [System.Windows.MessageBox]::Show("NapCat 已上线：$($login.data.nickname) ($($login.data.user_id))`nbot 大脑监听正常（:3210）`n`nQQ 机器人启动完成 ✨", 'QQ 机器人', 'OK', 'Information') | Out-Null
} else {
    [System.Windows.MessageBox]::Show("启动异常：NapCat 在线=$ok，bot 监听=$botOk`n请查看 NapCat 控制台窗口排查", 'QQ 机器人', 'OK', 'Warning') | Out-Null
    exit 1
}
