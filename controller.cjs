'use strict';
/* controller.cjs — QQ 机器人 CLI 控制器（计划 §6）
 * 命令: start / stop / restart / status / log / err / tray / help / quit
 * 单实例: TCP 3211 互斥锁；点 X 关闭 = stop（由 watchdog.ps1 兜底）
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');

const ROOT = __dirname;
const BOT = path.join(ROOT, 'bot.cjs');
const WATCHDOG = path.join(ROOT, 'watchdog.ps1');
const TRAY = path.join(ROOT, 'tray.ps1');
const STATUS_PATH = path.join(ROOT, 'state', 'status.json');
const DISARM_PATH = path.join(ROOT, 'state', 'watchdog.disarm');
const LOG_PATH = path.join(ROOT, 'bot.log');
const MUTEX_PORT = 3211;

process.title = 'QQ机器人控制器';

// ---------- 工具 ----------
function ps(script) {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return ''; }
}
function spawnHidden(file, args) {
  const p = spawn('powershell', ['-NoProfile', '-Command',
    `Start-Process -FilePath '${file}' -ArgumentList ${args} -WorkingDirectory '${ROOT}' -WindowStyle Hidden`],
    { stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
}
function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')); } catch { return null; }
}

// pid 复用防护：杀前必须验证是 node.exe 且命令行含 bot.cjs（计划 v1.4 修订⑤）
function botProcess() {
  const st = readStatus();
  if (!st || !st.pid) return null;
  const out = ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${st.pid}" | Select-Object -ExpandProperty CommandLine)`);
  const name = ps(`(Get-Process -Id ${st.pid} -ErrorAction SilentlyContinue).ProcessName`);
  if (name === 'node' && out.includes('bot.cjs')) return st.pid;
  return null;
}
function napcatRunning() {
  return ps(`(Get-Process NapCatWinBootMain -ErrorAction SilentlyContinue).ProcessName`) === 'NapCatWinBootMain';
}
function watchdogRunning() {
  // 注意排除查询者自身：这条 powershell 的命令行里就含着 "watchdog.ps1" 字样
  return ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*\\watchdog.ps1*' }).Count`);
}
function armWatchdog() {
  try { fs.unlinkSync(DISARM_PATH); } catch {}
  if (watchdogRunning() !== '0' && watchdogRunning() !== '') return; // 已有看门狗
  spawnHidden('powershell', `'-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','"${WATCHDOG}"','-ControllerPid','${process.pid}'`);
  console.log('[看门狗] 已武装（控制器窗口被直接关闭时将自动停止机器人）');
}
function disarmWatchdog() {
  try { fs.writeFileSync(DISARM_PATH, new Date().toISOString(), 'utf8'); } catch {}
}
function killNapCat() {
  ps(`Stop-Process -Name NapCatWinBootMain,QQ,QQEX -Force -ErrorAction SilentlyContinue`);
}

// ---------- 命令 ----------
async function cmdStart() {
  if (botProcess()) { console.log('[启动] 机器人已在运行（bot.cjs 存活）'); armWatchdog(); return; }
  const ans = await ask('[启动] 注入需要先关闭所有 QQ 进程（包括你的主号 QQ），继续？(y/n) ');
  if (ans !== 'y') { console.log('[启动] 已取消'); return; }

  console.log('[启动] 清理残留 QQ/NapCat 进程...');
  killNapCat();
  await new Promise(r => setTimeout(r, 2000));

  console.log('[启动] 拉起 NapCat（隐藏窗口）...');
  spawnHidden('cmd', `'/c','launcher-user.bat'`);

  console.log('[启动] 拉起 bot.cjs（隐藏进程）...');
  spawnHidden(process.execPath, `'"${BOT}"'`);

  armWatchdog();

  console.log('[启动] 等待 NapCat 上线（最长 60s）...');
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await fetch('http://127.0.0.1:3000/get_login_info', { signal: AbortSignal.timeout(5000) });
      const j = await res.json();
      if (j.status === 'ok') {
        console.log(`[启动] NapCat 已上线：${j.data.nickname} (${j.data.user_id})`);
        console.log('[启动] 完成。输入 status 查看状态，tray 最小化到托盘。');
        return;
      }
    } catch {}
  }
  console.log('[启动] 警告：60s 内 NapCat 未响应，可能还在登录。稍后用 status 复查。');
}

async function cmdStop() {
  disarmWatchdog(); // 主动停止后，控制器再退出时看门狗无需动手
  const pid = botProcess();
  if (pid) {
    ps(`Stop-Process -Id ${pid} -Force`);
    console.log(`[停止] bot.cjs (pid ${pid}) 已终止`);
  } else {
    console.log('[停止] bot.cjs 未在运行');
  }
  if (napcatRunning()) {
    killNapCat();
    console.log('[停止] NapCat/QQ 进程已终止（所有 QQ 账号均已下线）');
  }
  try { fs.writeFileSync(STATUS_PATH, JSON.stringify({ state: 'stopped', pid: null }), 'utf8'); } catch {}
  console.log('[停止] 完成');
}

async function cmdRestart() {
  await cmdStop();
  await new Promise(r => setTimeout(r, 2000));
  await cmdStart();
}

async function cmdStatus() {
  const st = readStatus();
  const botAlive = !!botProcess();
  const napcat = napcatRunning();
  console.log('──────── 状态 ────────');
  console.log(`bot 进程:   ${botAlive ? `运行中 (pid ${st.pid})` : '未运行'}`);
  console.log(`NapCat:     ${napcat ? '运行中' : '未运行'}`);
  if (botAlive && st) {
    const ago = ts => ts ? `${Math.round((Date.now() - ts) / 1000)}s 前` : '—';
    console.log(`模式:       ${st.muted ? '已闭嘴' : ['正常', '候选减半(预算)', '仅@必回(护栏)'][st.guard || 0]}`);
    console.log(`模型:       ${st.model}`);
    console.log(`缓冲:       ${st.bufferLen ?? '—'}/75 条 | 表情库: ${st.memes ?? 0} 个`);
    console.log(`今日:       ${st.todayCalls ?? 0} 次调用 / $${(st.todayUSD ?? 0).toFixed(4)}`);
    console.log(`5h窗口:     $${(st.window5hUSD ?? 0).toFixed(4)} | 本月: $${(st.monthUSD ?? 0).toFixed(4)}`);
    console.log(`最近群消息: ${ago(st.lastMsgAt)} | 最近发言: ${ago(st.lastSentAt)}`);
    if (st.note) console.log(`最近错误:   ${st.note}`);
  }
  try {
    const res = await fetch('http://127.0.0.1:3000/get_login_info', { signal: AbortSignal.timeout(3000) });
    const j = await res.json();
    if (j.status === 'ok') console.log(`OneBot:     在线 — ${j.data.nickname} (${j.data.user_id})`);
  } catch { console.log('OneBot:     无响应'); }
  console.log('──────────────────────');
}

function tailLog(filter) {
  let lines;
  try { lines = fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { console.log('(bot.log 不存在)'); return; }
  if (filter) lines = lines.filter(l => l.includes('[WARN]') || l.includes('[ERROR]'));
  const n = filter ? 20 : 30;
  console.log(lines.slice(-n).join('\n') || '(空)');
}

function cmdTray() {
  if (!fs.existsSync(TRAY)) { console.log('[托盘] tray.ps1 不存在'); return; }
  spawnHidden('powershell', `'-NoProfile','-ExecutionPolicy','Bypass','-Sta','-File','"${TRAY}"'`);
  console.log('[托盘] 3 秒后台控制台将隐藏到系统托盘，双击托盘图标恢复，右键菜单可停止并退出');
}

async function cmdQuit() {
  const pid = botProcess();
  if (pid || napcatRunning()) {
    const ans = await ask('[退出] 机器人仍在运行。停止它再退出？(y=停止并退出 / n=保留机器人退出 / c=取消) ');
    if (ans === 'y') { await cmdStop(); }
    else if (ans === 'n') { disarmWatchdog(); console.log('[退出] 机器人保留运行（看门狗已解除，不会被误杀）'); }
    else { console.log('[退出] 已取消'); return; }
  }
  console.log('[退出] 再见');
  process.exit(0);
}

// ---------- 主循环 ----------
let rl;
function ask(q) {
  return new Promise(res => {
    rl.question(q, a => res(a.trim().toLowerCase()));
  });
}

const COMMANDS = {
  start: cmdStart, stop: cmdStop, restart: cmdRestart, status: cmdStatus,
  log: () => tailLog(false), err: () => tailLog(true), tray: cmdTray, quit: cmdQuit,
  help: () => console.log('命令: start 启动 | stop 停止 | restart 重启 | status 状态 | log 最近日志 | err 最近报错 | tray 最小化到托盘 | quit 退出'),
};

async function main() {
  // 1. 单实例互斥锁（兼作托盘命令通道：托盘右键"停止并退出"会发来 STOP_AND_QUIT）
  const mutex = net.createServer();
  mutex.on('connection', sock => {
    let d = '';
    sock.on('data', c => d += c);
    sock.on('end', async () => {
      if (d.trim() === 'STOP_AND_QUIT') {
        try { sock.end('bye'); } catch {}
        console.log('\n[托盘] 收到"停止并退出"指令');
        await cmdStop();
        process.exit(0);
      } else { try { sock.end('unknown'); } catch {} }
    });
  });
  mutex.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log('已有另一个控制器在运行（端口 3211 被占用）。请先关闭它。');
      process.exit(1);
    }
  });
  await new Promise(res => mutex.listen(MUTEX_PORT, '127.0.0.1', res));

  // 2. 管理员自检（NapCat 注入/杀 QQ 需要），不足则提权重启自己
  if (ps('net session >$null 2>&1; if ($?) { "admin" }') !== 'admin') {
    console.log('需要管理员权限，正在请求提权...');
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Start-Process -FilePath '${process.execPath}' -ArgumentList '"${path.join(ROOT, 'controller.cjs')}"' -WorkingDirectory '${ROOT}' -Verb RunAs`], { timeout: 20000 });
    } catch { console.log('提权被取消，退出。'); }
    process.exit(0);
  }

  console.log('╔══════════════════════════════╗');
  console.log('║      QQ 机器人控制器 v1.0      ║');
  console.log('╚══════════════════════════════╝');
  console.log('输入 help 查看命令。直接关闭本窗口 = stop（看门狗兜底）。\n');

  // 3. 启动时发现机器人已在跑 → 武装看门狗（v1.4 修订④：X 语义跨会话保持）
  if (botProcess() || napcatRunning()) {
    console.log('[检测] 发现机器人/NapCat 正在运行（上次保留的），已接管。');
    armWatchdog();
  }

  rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'bot> ' });
  rl.prompt();
  rl.on('line', async line => {
    const cmd = line.trim().toLowerCase();
    try {
      if (COMMANDS[cmd]) await COMMANDS[cmd]();
      else if (cmd) console.log(`未知命令 "${cmd}"，输入 help 查看`);
    } catch (e) { console.log(`[错误] ${e.message}`); }
    rl.prompt();
  });
  rl.on('SIGINT', async () => { console.log('\n(Ctrl+C → 走退出流程)'); await cmdQuit(); });
  rl.on('close', () => process.exit(0)); // stdin EOF（管道测试等场景）
}

main();
