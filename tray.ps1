# tray.ps1 v2 — 控制台最小化到系统托盘（AttachConsole 方式，不依赖窗口标题/类名）
# 通过 TCP 3211 的监听者拿到控制器 pid → AttachConsole → GetConsoleWindow → 隐藏
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W8 {
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@

$SW_HIDE = 0
$SW_RESTORE = 9

# 1. 控制器 pid = TCP 3211 的监听者
$ctrlPid = $null
foreach ($i in 1..20) {
    $c = Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $ctrlPid = $c.OwningProcess; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ctrlPid) { exit 1 }

# 2. AttachConsole → 拿控制台窗口句柄（与标题/类名/可见性无关）
[W8]::FreeConsole() | Out-Null
if (-not [W8]::AttachConsole([uint32]$ctrlPid)) { exit 1 }
$hwnd = [W8]::GetConsoleWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }

# 3. 隐藏窗口
[W8]::ShowWindow($hwnd, $SW_HIDE) | Out-Null

# 4. 托盘图标
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = 'QQ机器人控制器'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miRestore = $menu.Items.Add('恢复窗口')
$miStop    = $menu.Items.Add('停止并退出机器人')
$icon.ContextMenuStrip = $menu

$restore = {
    [W8]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
    [W8]::SetForegroundWindow($hwnd) | Out-Null
}
$icon.add_DoubleClick($restore)
$miRestore.add_Click($restore)

$miStop.add_Click({
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', 3211)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('STOP_AND_QUIT')
        $stream = $client.GetStream()
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $client.Close()
    } catch {}
})

# 5. 控制器窗口消失（quit/X/托盘停止）→ 托盘自动退出
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
    if (-not [W8]::IsWindow($hwnd)) {
        $timer.Stop()
        [System.Windows.Forms.Application]::Exit()
    }
})
$timer.Start()

$appCtx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appCtx)

$icon.Visible = $false
$icon.Dispose()
