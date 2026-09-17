// QQ bot brain: webhook -> dsh headless -> OneBot reply
// triggers: private msg from master (2337529577) / group @self (2721212523)
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const SELF_ID = 2721212523;
const MASTER_ID = 2337529577;
const ONEBOT = 'http://127.0.0.1:3000';
const PORT = 3210;
const DSH_TIMEOUT = 150000;
const LOG = 'D:\\Agent Space\\NapCatShell\\bot.log';
const HISTORY_FILE = 'D:\\Agent Space\\NapCatShell\\history.json';
const MAX_TURNS = 10; // 每个会话保留最近 10 轮问答，上下文硬性有界

// 滚动会话记忆：key = private:<qq> / group:<群号>，重启不丢
let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history), 'utf8'); } catch (e) { log('history save error: ' + e.message); }
}
function getTurns(key) { return history[key] || []; }
function pushTurn(key, nick, userLine, botLine) {
  const turns = getTurns(key);
  turns.push([nick, userLine, botLine]);
  history[key] = turns.slice(-MAX_TURNS);
  saveHistory();
}

function log(s) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${s}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

function extractText(messageArray) {
  let atMe = false;
  const parts = [];
  for (const seg of messageArray) {
    if (seg.type === 'at' && String(seg.data.qq) === String(SELF_ID)) { atMe = true; continue; }
    if (seg.type === 'at') continue;
    if (seg.type === 'text') parts.push(seg.data.text);
    else if (seg.type === 'image') parts.push('[image]');
    else if (seg.type === 'face') parts.push('[face]');
    else if (seg.type === 'reply') continue;
    else parts.push(`[${seg.type}]`);
  }
  return { text: parts.join('').trim(), atMe };
}

async function askDsh(senderNick, text, scene, turns) {
  const historyText = turns.length
    ? `\n以下是你们最近的对话记录（供你保持上下文连贯，不用复述）：\n` +
      turns.map(([n, u, b]) => `${n}：${u}\n你：${b}`).join('\n') + '\n'
    : '';
  const prompt = `你是艾薇，Four 的 AI 助手（你的身份、记忆与行事准则见全局 AGENTS.md）。你现在通过一个 QQ 机器人小号（昵称 IV）与人对话。场景：${scene}。要求：用简体中文回复；语气干练有温度，像真人聊天；回复要简短（一两句，别写小作文，别用 markdown 列表）；不知道的就直说不知道；直接输出回复正文，不要任何前缀解释。${historyText}对方最新消息如下：\n${senderNick}：${text}`;
  return new Promise((resolve) => {
    const p = spawn('C:\\Program Files\\nodejs\\node.exe', [
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
      '--profile', 'headless', prompt,
    ], { cwd: 'D:\\Agent Space', windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { p.kill(); resolve('（艾薇思考超时了，稍后再试）'); }, DSH_TIMEOUT);
    p.stdout.on('data', (d) => out += d);
    p.stderr.on('data', () => {});
    p.on('close', () => {
      clearTimeout(timer);
      const clean = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        .filter(s => !/^(dsh:|Node\.js|\[)/.test(s)).join(' ').trim();
      resolve(clean || '（艾薇没想好怎么回）');
    });
  });
}

async function sendMsg(body) {
  await fetch(`${ONEBOT}/send_msg`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

let queue = Promise.resolve();
function enqueue(job) { queue = queue.then(job).catch(e => log('job error: ' + e.message)); }

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => raw += d);
  req.on('end', () => {
    res.statusCode = 200; res.end();
    let ev; try { ev = JSON.parse(raw); } catch { return; }
    if (ev.post_type !== 'message') return;
    if (Number(ev.user_id) === SELF_ID) return;

    const { text, atMe } = extractText(ev.message || []);
    const isPrivate = ev.message_type === 'private' && Number(ev.user_id) === MASTER_ID;
    const isGroupAt = ev.message_type === 'group' && atMe;
    if (!isPrivate && !isGroupAt) return;
    if (!text) return;

    const nick = (ev.sender && (ev.sender.card || ev.sender.nickname)) || String(ev.user_id);
    log(`recv ${ev.message_type} from ${nick}(${ev.user_id}): ${text}`);

    enqueue(async () => {
      const scene = isPrivate ? 'Four（你的主人）在私聊你' : `你在 QQ 群里被 ${nick} @了`;
      const key = isPrivate ? `private:${ev.user_id}` : `group:${ev.group_id}`;
      const reply = await askDsh(nick, text, scene, getTurns(key));
      log(`reply: ${reply}`);
      const body = isPrivate
        ? { message_type: 'private', user_id: ev.user_id, message: reply }
        : { message_type: 'group', group_id: ev.group_id, message: reply };
      await sendMsg(body);
      pushTurn(key, nick, text, reply);
    });
  });
}).listen(PORT, '127.0.0.1', () => log(`bot listening on ${PORT}`));
