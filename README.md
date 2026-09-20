# QQ-chat-bot（拟人群友机器人）

QQ 群里的"真人感"群友—— NapCat Shell + OneBot 11 + 纯 Node 直连 LLM API（OpenCode Go）。

> 日常使用、调参、排障看 **操作手册.md**；设计推演与决策记录看 **PLAN.md**。

## 架构

```
QQ 群消息 ──(NapCat / OneBot 11, :3000)──> bot.cjs webhook (:3210)
                                              │
                                              ├─ 缓冲 / 去重 / 触发判定（@必回，其余看活跃度）
                                              ├─ 直连 LLM（OpenCode Go，主 deepseek-v4.1-flash / 备 longcat-2.0）
                                              │    └─ 决策 JSON：skip 或 reply + 多气泡（文字/表情包）
                                              └─ OneBot send_group_msg 拟人节奏发出（等待+分气泡）

桌面 启动QQ机器人.bat → controller.cjs（CLI 控制器，:3211 单实例锁）
                        ├─ start/stop/restart/status/log/err/tray/quit
                        ├─ watchdog.ps1（隐藏）：控制器死亡 2 秒内兜底 stop —— 点 X = stop
                        └─ tray.ps1（隐藏）：窗口收进系统托盘（双击还原，右键停止并退出）
```

- **NapCat Shell**：QQ 协议端（不入库），注入 QQNT，OneBot 11 HTTP `:3000`，WebUI `:6099`
- **bot.cjs**：机器人本体，纯 Node 24 零依赖，隐藏进程。webhook 收事件 → 75 条滚动缓冲 + 滚动摘要 + memory.md 三层上下文 → LLM 决策 → 拟人发送；群图自动收集打标成表情包库；QQ 私聊主控命令（/闭嘴 /说话 /状态 /重载 /人设 /表情）
- **controller.cjs**：桌面 CLI 控制器，单实例互斥（TCP 3211 兼作托盘命令通道）
- **历史**：曾用 dsh ACP 长驻会话方案（`bot-legacy.cjs` 归档），已弃用——现方案成本可控、人设稳定、无工具面

## 行为要点

- **触发**：@/引用 = 必回（每人 30 分钟 10 次节流）；主动插嘴 = 累计 ≥2 条新消息 + 静默 20 秒，模型可自行 skip；发言后随机冷却 5s~60s
- **拟人**：回复前等 1~10 秒；多气泡 0.5~2 秒间隔；单气泡 ≤40 字；近 10 条自查防复读
- **成本护栏**：5h 窗口 $7 候选减半 / $9.5 只回 @；每日 200 次调用上限；账本 `state/ledger.json`
- **表情包**：群图自动下载 → 多模态打标 → 入库（敏感即删/非表情跳过，上限 500 淘汰制），发言可引用

## 启动 / 停止

**启动**：双击桌面 `启动QQ机器人.bat` → 提权 → 控制器输入 `start`（⚠️ 会关闭本机所有 QQ，主号需重登）。

**停止**：控制器 `stop`；**或直接点窗口 X**（看门狗兜底，效果相同）。

**验证**：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/get_login_info   # NapCat 在线
Get-NetTCPConnection -State Listen -LocalPort 3210        # bot webhook 在听
```

## 配置

- `config.json`：全部可调参数（活跃度/拟人节奏/护栏/表情库），改完 QQ 私聊 `/重载` 生效，不用重启
- `persona.md`：人设提示词，同样 `/重载` 热加载
- `secrets.json`：API key（gitignore，绝不入库）

不开机自启，用时双击桌面 bat。

## 日志与状态

- `bot.log` 全量日志；`logs/sent/YYYY-MM-DD.jsonl` 发言存档（7 天自动清）
- `state/status.json` 每 10 秒刷新；`state/context.json` 缓冲+摘要；`state/memory.md` 长期记忆；`state/ledger.json` 账本

## 注意

- 白名单 git：只跟踪代码/文档/脚本；NapCat 二进制、`secrets.json`、`state/`、日志、`memes/` 一律忽略
- 机器人号 IV（2721212523）与本机 NapCat 绑定；**不要在第二台电脑登录该号**（会踢掉 NapCat），手机 QQ 双登无影响
