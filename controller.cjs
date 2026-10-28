'use strict';
/* SnowLuma + bot.cjs CLI 控制器
 * 交互：node controller.cjs；单次：node controller.cjs <command> [args]
 * start/stop/restart 管理 SnowLuma 与 bot；model/mute/unmute 只重启 bot。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');

const ROOT = __dirname;
const BOT = path.join(ROOT, 'bot.cjs');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const CTX_PATH = path.join(ROOT, 'state', 'context.json');
const STATUS_PATH = path.join(ROOT, 'state', 'status.json');
const DISARM_PATH = path.join(ROOT, 'state', 'watchdog.disarm');
const LOG_PATH = path.join(ROOT, 'bot.log');
const WATCHDOG = path.join(ROOT, 'watchdog.ps1');
const TRAY = path.join(ROOT, 'tray.ps1');
const SNOWLUMA_ROOT = path.resolve(ROOT, '..', 'SnowLuma');
const SNOWLUMA_ENTRY = path.join(SNOWLUMA_ROOT, 'index.mjs');
const SNOWLUMA_NODE = path.join(SNOWLUMA_ROOT, 'runtime', 'node-v24.22.1-win-x64', 'node.exe');
const QQ_EXE = 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe';
const WEBUI_URL = 'http://127.0.0.1:5099/';
const MUTEX_PORT = 3211;
const ARGS = process.argv.slice(2);
const AUTO_START = ARGS.includes('--start');
const INTERACTIVE = ARGS.length === 0 || AUTO_START;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1), 'utf8');
}
function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    }).trim();
  } catch { return ''; }
}
function spawnDetached(file, args, cwd, extraEnv = {}) {
  const child = spawn(file, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}
function requireAdmin() {
  const isAdmin = ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
  if (isAdmin !== 'True') {
    throw new Error('此操作需要管理员权限。请双击“启动QQ机器人.bat”并接受 UAC，或从管理员终端运行。');
  }
}
function ensureQQ() {
  const count = ps(`@(Get-Process -Name QQ -ErrorAction SilentlyContinue).Count`);
  if (count === '0') {
    if (!fs.existsSync(QQ_EXE)) throw new Error(`未找到 QQ：${QQ_EXE}`);
    const pid = spawnDetached(QQ_EXE, [], path.dirname(QQ_EXE));
    console.log(`[启动] QQ 已启动（PID ${pid}）；默认账号由 QQ 决定，随后将按 botQQ 硬校验`);
  } else {
    console.log('[启动] 检测到 QQ 主进程，不重复启动');
  }
}
function nodeProcesses() {
  const out = ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
  if (!out) return [];
  try {
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : [rows];
  } catch { return []; }
}
function snowlumaProcesses() {
  return nodeProcesses().filter(p => p.ExecutablePath
    && p.ExecutablePath.toLowerCase() === SNOWLUMA_NODE.toLowerCase()
    && String(p.CommandLine || '').toLowerCase().includes(SNOWLUMA_ENTRY.toLowerCase()));
}
function botProcesses() {
  return nodeProcesses().filter(p => {
    const cmd = String(p.CommandLine || '').toLowerCase();
    return cmd.includes(BOT.toLowerCase());
  });
}
function botRunning() { return botProcesses().length > 0; }
function snowlumaRunning() { return snowlumaProcesses().length > 0; }
async function waitForGone(getRows, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!getRows().length) return true;
    await sleep(250);
  }
  return !getRows().length;
}
function stopRows(rows) {
  const errors = [];
  for (const row of rows) {
    try { process.kill(row.ProcessId); }
    catch (error) { if (error.code !== 'ESRCH') errors.push(`${row.ProcessId}: ${error.message}`); }
  }
  if (errors.length) throw new Error(`停止进程失败：${errors.join('；')}`);
}
async function stopBot() {
  stopRows(botProcesses());
  if (!await waitForGone(botProcesses)) throw new Error('bot.cjs 未能在 5 秒内停止');
  writeJSON(STATUS_PATH, { state: 'stopped', pid: null });
}
async function stopSnowluma() {
  stopRows(snowlumaProcesses());
  if (!await waitForGone(snowlumaProcesses)) throw new Error('SnowLuma 未能在 5 秒内停止');
}
function startSnowluma() {
  if (snowlumaRunning()) return null;
  if (!fs.existsSync(SNOWLUMA_NODE) || !fs.existsSync(SNOWLUMA_ENTRY)) {
    throw new Error(`SnowLuma 文件不完整：${SNOWLUMA_ROOT}`);
  }
  return spawnDetached(SNOWLUMA_NODE, [SNOWLUMA_ENTRY], SNOWLUMA_ROOT, {
    SNOWLUMA_HOOK_AUTOLOAD: '1',
    SNOWLUMA_TELEMETRY: '0',
  });
}
function startBot() {
  if (botRunning()) return null;
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  return spawnDetached(process.execPath, [BOT], ROOT);
}
function currentConfig() {
  const cfg = readJSON(CONFIG_PATH);
  if (!cfg) throw new Error('无法读取 config.json');
  return cfg;
}
function currentContext() {
  return readJSON(CTX_PATH, {
    buffer: [], summary: '', sinceSummary: 0, recentOwn: [], sentIds: [], recentImages: [], muted: true,
  });
}
async function onebot(api, payload = {}, timeoutMs = 5000) {
  const cfg = currentConfig();
  const accessToken = readJSON(path.join(ROOT, 'secrets.json'), {}).onebotAccessToken || '';
  const base = cfg.onebot.http.replace(/\/+$/, '');
  const res = await fetch(`${base}/${api}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(json.message || `retcode=${json.retcode}`);
  return json.data;
}
async function waitForOneBot(seconds = 60) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try { return await onebot('get_login_info'); } catch { await sleep(3000); }
  }
  return null;
}
function armWatchdog() {
  if (!INTERACTIVE) return;
  try { fs.unlinkSync(DISARM_PATH); } catch {}
  const rootPattern = WATCHDOG.replace(/'/g, "''");
  const count = ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${rootPattern}*' }).Count`);
  if (count !== '' && count !== '0') return;
  spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', WATCHDOG, '-ControllerPid', String(process.pid)], ROOT);
}
function disarmWatchdog() {
  writeJSON(DISARM_PATH, { disarmedAt: new Date().toISOString() });
}
function availableModels(cfg = currentConfig()) {
  return [...new Set([cfg.llm.primary, cfg.llm.fallback, ...Object.keys(cfg.llm.models || {})])];
}
function currentModel() {
  const cfg = currentConfig();
  return currentContext().modelOverride || cfg.llm.primary;
}
function findModel(name) {
  const models = availableModels();
  const exact = models.find(m => m === name) || models.find(m => m.toLowerCase() === String(name).toLowerCase());
  if (exact) return exact;
  const hits = models.filter(m => m.toLowerCase().includes(String(name).toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}
async function restartBotWithContext(update) {
  const wasRunning = botRunning();
  if (wasRunning) {
    requireAdmin();
    await stopBot();
  }
  const ctx = { ...currentContext(), ...update };
  writeJSON(CTX_PATH, ctx);
  if (wasRunning) startBot();
  return ctx;
}

async function cmdStart() {
  requireAdmin();
  ensureQQ();
  const snowPid = startSnowluma();
  if (snowPid) console.log(`[启动] SnowLuma 已启动（PID ${snowPid}），WebUI: ${WEBUI_URL}`);
  else console.log('[启动] SnowLuma 已在运行');
  console.log('[校验] 等待 IV 的 OneBot 上线，账号不匹配时不会启动 bot');
  const info = await waitForOneBot(60);
  const expectedQQ = String(currentConfig().botQQ);
  if (!info) {
    await stopBot();
    throw new Error(`60 秒内未检测到 IV (${expectedQQ})。请确认 IV 已登录并在 WebUI「进程注入」加载：${WEBUI_URL}`);
  }
  if (String(info.user_id) !== expectedQQ) {
    await stopBot();
    throw new Error(`账号校验失败：OneBot 当前为 ${info.nickname} (${info.user_id})，目标应为 ${expectedQQ}。bot 未启动。`);
  }
  const botPid = startBot();
  console.log(botPid ? `[启动] bot.cjs 已启动（PID ${botPid}）` : '[启动] bot.cjs 已在运行');
  armWatchdog();
  console.log(`[在线] ${info.nickname} (${info.user_id})，OneBot ${currentConfig().onebot.http}`);
  console.log(`[状态] 模型 ${currentModel()}，${currentContext().muted ? 'muted（不会发言）' : '已解除闭嘴'}`);
}
async function cmdStop() {
  requireAdmin();
  disarmWatchdog();
  await stopBot();
  await stopSnowluma();
  console.log('[停止] bot.cjs 与 SnowLuma 已停止；QQ 未关闭，Hook 保留在 QQ 进程中。');
}
async function cmdRestart() {
  await cmdStop();
  await sleep(1500);
  await cmdStart();
}
async function cmdStatus() {
  const st = readJSON(STATUS_PATH, {});
  console.log('──────── 状态 ────────');
  console.log(`SnowLuma:   ${snowlumaRunning() ? '运行中' : '未运行'}`);
  console.log(`bot.cjs:    ${botRunning() ? `运行中 (pid ${st.pid || '?'})` : '未运行'}`);
  console.log(`模型:       ${st.model || currentModel()}`);
  console.log(`模式:       ${st.muted ? 'muted（不会发言）' : '已解除闭嘴'}`);
  console.log(`缓冲:       ${st.bufferLen ?? '—'} 条 | 表情库: ${st.memes ?? '—'} 个`);
  console.log(`今日调用:   ${st.todayCalls ?? '—'} 次 | 5h: $${(st.window5hUSD ?? 0).toFixed(4)}`);
  console.log(`最近群消息: ${st.lastMsgAt ? new Date(st.lastMsgAt).toLocaleString('zh-CN', { hour12: false }) : '—'}`);
  console.log(`最近发言:   ${st.lastSentAt ? new Date(st.lastSentAt).toLocaleString('zh-CN', { hour12: false }) : '—'}`);
  if (st.note) console.log(`最近错误:   ${st.note}`);
  try {
    const info = await onebot('get_login_info', {}, 3000);
    console.log(`OneBot:     在线 — ${info.nickname} (${info.user_id})`);
  } catch { console.log(`OneBot:     无响应（${currentConfig().onebot.http}）`); }
  console.log(`WebUI:      ${WEBUI_URL}`);
  console.log('──────────────────────');
}
async function cmdModel(args) {
  if (!args.length) {
    const current = currentModel();
    console.log(`当前模型: ${current}`);
    console.log(`可用模型: ${availableModels().join(' / ')}`);
    console.log('切换: model <模型ID>（只重启 bot，不动 SnowLuma/QQ）');
    return;
  }
  const requested = args.join(' ');
  const model = findModel(requested);
  if (!model) throw new Error(`模型不存在或匹配不唯一：${requested}；可用：${availableModels().join(' / ')}`);
  await restartBotWithContext({ modelOverride: model });
  console.log(`[模型] 已切换为 ${model}，bot 已按新配置运行；SnowLuma/QQ 未重启。`);
}
async function cmdMute(muted) {
  await restartBotWithContext({ muted });
  console.log(muted ? '[模式] 已闭嘴，只接收和处理上下文，不主动发言。' : '[模式] 已恢复发言；请留意目标群消息。');
}
function tailLog(errorsOnly) {
  let lines;
  try { lines = fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { console.log('(bot.log 不存在)'); return; }
  if (errorsOnly) lines = lines.filter(line => line.includes('[WARN]') || line.includes('[ERROR]'));
  console.log(lines.slice(-30).join('\n') || '(空)');
}
function cmdTray() {
  if (!INTERACTIVE) { console.log('tray 仅在交互式控制器中可用'); return; }
  spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Sta', '-File', TRAY], ROOT);
  console.log('[托盘] 控制器将收进系统托盘，双击恢复，右键可停止并退出。');
}

const COMMANDS = {
  start: cmdStart,
  stop: cmdStop,
  restart: cmdRestart,
  status: cmdStatus,
  model: cmdModel,
  mute: () => cmdMute(true),
  unmute: () => cmdMute(false),
  log: () => tailLog(false),
  err: () => tailLog(true),
  tray: cmdTray,
  help: () => console.log('命令: start 启动 | stop 停止 | restart 重启 | status 状态 | model [模型ID] 模型 | mute 闭嘴 | unmute 恢复 | log 日志 | err 错误 | tray 托盘 | quit 退出'),
};
let rl;
function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim().toLowerCase())));
}
async function cmdQuit() {
  if (botRunning() || snowlumaRunning()) {
    const answer = await ask('[退出] 服务仍在运行。停止后退出？(y=停止 / n=保留 / c=取消) ');
    if (answer === 'y') await cmdStop();
    else if (answer === 'n') disarmWatchdog();
    else { console.log('[退出] 已取消'); return; }
  }
  process.exit(0);
}
COMMANDS.quit = cmdQuit;

async function interactiveMain() {
  process.title = 'QQ机器人控制器';
  const mutex = require('net').createServer();
  mutex.on('connection', socket => {
    let data = '';
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', async () => {
      if (data.trim() === 'STOP_AND_QUIT') {
        try { socket.end('bye'); } catch {}
        await cmdStop();
        process.exit(0);
      } else { try { socket.end('unknown'); } catch {} }
    });
  });
  mutex.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error('已有交互式控制器在运行（端口 3211 被占用）。');
      process.exit(1);
    }
  });
  await new Promise(resolve => mutex.listen(MUTEX_PORT, '127.0.0.1', resolve));
  armWatchdog();
  console.log('QQ 机器人控制器（SnowLuma）');
  console.log('输入 help 查看命令；点 X = stop（不会关闭 QQ）。\n');
  if (AUTO_START) await cmdStart();
  else if (botRunning() || snowlumaRunning()) await cmdStatus();
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'bot> ' });
  rl.prompt();
  rl.on('line', async line => {
    const [command, ...args] = line.trim().split(/\s+/);
    try {
      if (COMMANDS[command]) await COMMANDS[command](args);
      else if (command) console.log(`未知命令 "${command}"，输入 help 查看`);
    } catch (error) { console.log(`[错误] ${error.message}`); }
    rl.prompt();
  });
  rl.on('SIGINT', async () => { console.log('\n(Ctrl+C → 退出流程)'); await cmdQuit(); });
  rl.on('close', () => process.exit(0));
}
async function main() {
  if (INTERACTIVE) return interactiveMain();
  const [command, ...args] = process.argv.slice(2);
  if (!COMMANDS[command] || command === 'quit') throw new Error(`未知命令：${command || '(空)'}；可用：${Object.keys(COMMANDS).filter(c => c !== 'quit').join(' / ')}`);
  await COMMANDS[command](args);
}
main().catch(error => {
  console.error(`[错误] ${error.message}`);
  process.exitCode = 1;
});
