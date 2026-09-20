# tray.ps1 — 控制台最小化到系统托盘（计划 §8）
# 隐藏标题为"QQ机器人控制器"的控制台窗口；托盘图标双击恢复；右键菜单可停止并退出
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
'@

$TITLE = 'QQ机器人控制器'
$SW_HIDE = 0
$SW_RESTORE = 9

# 等控制器窗口出现（最长 15s）
$hwnd = [IntPtr]::Zero
foreach ($i in 1..30) {
    $hwnd = [WinApi]::FindWindow('ConsoleWindowClass', $TITLE)
    if ($hwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 500
}
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }

# 隐藏窗口
[WinApi]::ShowWindow($hwnd, $SW_HIDE) | Out-Null

# 托盘图标
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = $TITLE
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miRestore = $menu.Items.Add('恢复窗口')
$miStop    = $menu.Items.Add('停止并退出机器人')
$icon.ContextMenuStrip = $menu

$restore = {
    [WinApi]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
    [WinApi]::SetForegroundWindow($hwnd) | Out-Null
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

# 控制器消失（被 X 关掉等）→ 托盘跟着退出
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
    if (-not [WinApi]::IsWindow($hwnd)) {
        $timer.Stop()
        [System.Windows.Forms.Application]::Exit()
    }
})
$timer.Start()

# 消息循环（无窗口 ApplicationContext）
$icon.add_MouseClick({ param($s, $e) })
$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)

$icon.Visible = $false
$icon.Dispose()
